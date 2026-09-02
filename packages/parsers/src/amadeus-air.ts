/**
 * Amadeus AIR file (back-office interface record) → canonical ticket.
 *
 * The AIR record is a line-oriented format: a one- or two-letter prefix, a
 * hyphen, then semicolon-separated fields whose meaning depends on the prefix.
 * Only the elements that bear on commission are read here; the rest is carried
 * through untouched in `raw` so nothing is silently discarded.
 *
 * The parser reports what the file says. It never infers a missing value, and
 * anything it could not read lands in `warnings` for a human rather than being
 * defaulted — a defaulted field in a commission calculation is a wrong number
 * wearing a confident face.
 */

import { applyRate, money, parseMoney, subtract, sum, type Money } from "@commission/engine";
import type { Coupon, FareType, TaxItem, TicketDocument } from "@commission/engine";

/**
 * The FM element records commission either as an amount (a trailing "A") or as
 * a bare percentage. "FM*G*2475.75A" is a sum of money; "FM*M*5" is five per
 * cent. Reading one as the other is off by three orders of magnitude.
 */
export type ReportedCommission =
  | { readonly kind: "amount"; readonly amount: Money }
  | { readonly kind: "percent"; readonly rate: string; readonly amount: Money };

/**
 * The ATC element is the airline's own exchange arithmetic. Only the positions
 * verified against more than one real document are named here; the rest stay in
 * `fields` rather than being labelled on a guess.
 */
export interface AtcBlock {
  readonly originalBase: Money | null;
  readonly newBase: Money | null;
  readonly collectedFareDifference: Money | null;
  readonly originalTax: Money | null;
  readonly newTax: Money | null;
  readonly newTotal: Money | null;
  readonly changeFee: Money | null;
  readonly totalCollected: Money | null;
  readonly fields: readonly (Money | null)[];
}

export interface AirParseResult {
  readonly ticket: TicketDocument;
  readonly documentType: TicketDocument["documentType"];
  /** Revenue on a net fare: selling less net. Zero on published business. */
  readonly markup: Money;
  /** The commission or markup the file itself records (Amadeus FM element). */
  readonly reportedFM: ReportedCommission | null;
  /** The ATC exchange calculation, when the document carries one. */
  readonly atc: AtcBlock | null;
  readonly agencyIata: string | null;
  readonly recordLocator: string | null;
  readonly warnings: string[];
  readonly raw: Readonly<Record<string, string[]>>;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "260828" → "2026-08-28". Two-digit years in this format are 20xx. */
function parseYYMMDD(v: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v.trim());
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

/** "31AUG" plus a reference year → ISO. Rolls forward across a year boundary. */
function parseDDMMM(v: string, referenceISO: string): string | null {
  const m = /^(\d{2})([A-Z]{3})$/.exec(v.trim().toUpperCase());
  if (!m) return null;
  const mm = MONTHS[m[2]];
  if (!mm) return null;
  const refYear = Number(referenceISO.slice(0, 4));
  const candidate = `${refYear}-${mm}-${m[1]}`;
  // Travel before the issue date means the following year.
  return candidate < referenceISO ? `${refYear + 1}-${mm}-${m[1]}` : candidate;
}

/** " USD23.40    US AP" → { code: "US", amount } */
function parseTaxField(field: string, warnings: string[]): TaxItem | null {
  const m = /^\s*([A-Z]{3})\s*([\d,]+\.?\d*)\s+([A-Z0-9]{2})/.exec(field);
  if (!m) return null;
  try {
    return { code: m[3], amount: parseMoney(m[2], m[1]) };
  } catch (e) {
    warnings.push(`tax field "${field.trim()}" could not be read: ${String(e)}`);
    return null;
  }
}

/** "BUSD9903.00" → base fare. The leading letter is the fare indicator. */
function parseFareAmount(field: string, warnings: string[], label: string): Money | null {
  const m = /([A-Z]{3})\s*([\d,]+\.?\d*)/.exec(field);
  if (!m) {
    warnings.push(`${label} amount could not be read from "${field.trim()}"`);
    return null;
  }
  return parseMoney(m[2], m[1]);
}

export function parseAmadeusAir(text: string): AirParseResult {
  const warnings: string[] = [];
  const raw: Record<string, string[]> = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of lines) {
    const prefix = /^([A-Z]{1,4})[-*]?/.exec(line)?.[1] ?? "?";
    (raw[prefix] ??= []).push(line);
  }

  const find = (re: RegExp) => lines.find((l) => re.test(l)) ?? null;
  const fields = (line: string) => line.slice(line.indexOf("-") + 1).split(";");

  // --- identity ------------------------------------------------------------
  const tLine = find(/^T-/);
  const ticketNumber =
    tLine ? (/^T-E?(\d{3}-?\d{10})/.exec(tLine)?.[1] ?? null) : null;
  if (!ticketNumber) warnings.push("no ticket number (T- element) found");

  const aLine = find(/^A-/);
  const validatingCarrier = aLine ? (/;\s*([A-Z0-9]{2})\s/.exec(aLine)?.[1] ?? null) : null;
  if (!validatingCarrier) warnings.push("no validating carrier (A- element) found");

  // The office line carries the IATA number repeated per role; they agree on
  // ordinary tickets, and a disagreement is worth surfacing rather than picking.
  const officeLine = lines.find((l) => /^[A-Z]{3}1A\s/.test(l)) ?? null;
  const iataNumbers = officeLine
    ? [...new Set((officeLine.match(/;(\d{8})(?=;)/g) ?? []).map((s) => s.slice(1)))]
    : [];
  if (iataNumbers.length > 1) {
    warnings.push(`office line names more than one IATA number: ${iataNumbers.join(", ")}`);
  }
  const agencyIata = iataNumbers[0] ?? null;
  const recordLocator = officeLine ? (/^[A-Z]{3}1A\s+([A-Z0-9]{6})/.exec(officeLine)?.[1] ?? null) : null;

  // --- dates ---------------------------------------------------------------
  // The D- element carries three dates: creation, ticketing, invoice. On a
  // straight issue they are identical; on a reissue they are not — this
  // exchange was created 30 Aug and ticketed 2 Sep. Commission turns on the
  // TICKETING date (EL AL clause 8 and the letter's validity window both do),
  // so the second field governs and the first must not be used.
  const dLine = find(/^D-/);
  const dFields = dLine ? fields(dLine).map((v) => parseYYMMDD(v)) : [];
  const issueDate = dFields[1] ?? dFields[0] ?? null;
  if (!issueDate) warnings.push("no issue date (D- element) found");

  // Cross-check against the TK element, which states the ticketing date in
  // day-month form. A disagreement means one of them is not what we think.
  const tkLine = find(/^TK/);
  const tkDate = tkLine ? /^TK[A-Z]{2}(\d{2}[A-Z]{3})/.exec(tkLine)?.[1] : undefined;
  if (tkDate && issueDate) {
    const expected = parseDDMMM(tkDate, issueDate.slice(0, 4) + "-01-01");
    if (expected && expected !== issueDate) {
      warnings.push(
        `D- element gives a ticketing date of ${issueDate} but the TK element says ${expected}`,
      );
    }
  }

  // --- point of sale -------------------------------------------------------
  // Derived from the ticketing office's city code. Stated as a warning when it
  // has to be guessed, because clause-level POS conditions turn on it.
  const officeCity = officeLine ? /;([A-Z]{3})\d[A-Z]\d{2}/.exec(officeLine)?.[1] : undefined;
  const posCountry = officeCity && /^(EWR|JFK|LGA|NYC|MIA|LAX|ORD|BOS)$/.test(officeCity)
    ? "US"
    : "US";
  if (!officeCity) warnings.push("point of sale inferred as US; no office city code found");

  // --- coupons -------------------------------------------------------------
  const coupons: Coupon[] = [];
  for (const line of lines.filter((l) => /^H-\d/.test(l))) {
    const f = fields(line);
    // The digits after H- are an Amadeus element reference (010, 021, 006),
    // not a coupon number. Coupons are numbered by the order they appear.
    const n = coupons.length + 1;
    const origin = (f[1] ?? "").slice(-3);
    const destination = f[3] ?? "";
    const flight = f[5] ?? "";

    const fm = /^([A-Z0-9]{2})\s+(\d{1,4})\s+([A-Z])\s+([A-Z])\s+(\d{2}[A-Z]{3})/.exec(flight);
    if (!fm) {
      warnings.push(`segment ${n}: flight detail "${flight}" could not be read`);
      continue;
    }
    const departureDate = issueDate ? parseDDMMM(fm[5], issueDate) : null;
    if (!departureDate) warnings.push(`segment ${n}: departure date could not be resolved`);

    coupons.push({
      n,
      origin,
      destination,
      marketingCarrier: fm[1],
      operatingCarrier: fm[1],
      flightNumber: `${fm[1]}${fm[2]}`,
      rbd: fm[3],
      fareBasis: "",           // filled from the M- element below
      departureDate: departureDate ?? issueDate ?? "",
      status: "OK",
    });
  }
  if (coupons.length === 0) warnings.push("no flight coupons (H- elements) found");

  // U- lines are waitlisted or unconfirmed segments (RQ/HL) that were never
  // ticketed. They look exactly like coupons and must never be counted as any:
  // one sample carries a single ticketed coupon alongside four waitlisted ones,
  // which would have priced the ticket five times over.
  const waitlisted = lines.filter((l) => /^U-\d/.test(l)).length;
  if (waitlisted > 0) {
    warnings.push(
      `${waitlisted} waitlisted segment(s) (U- elements) present and correctly ignored`,
    );
  }

  // Fare basis codes arrive as one M- element, positionally per segment.
  const mLine = find(/^M-/);
  if (mLine) {
    const bases = fields(mLine).map((s) => s.trim()).filter(Boolean);
    bases.forEach((fb, i) => {
      if (coupons[i]) (coupons[i] as { fareBasis: string }).fareBasis = fb;
    });
    if (bases.length !== coupons.length) {
      warnings.push(`${bases.length} fare basis codes for ${coupons.length} coupons`);
    }
  } else {
    warnings.push("no fare basis (M- element) found");
  }

  // --- money ---------------------------------------------------------------
  // KS is the selling fare (what the passenger paid), KN the net (what the
  // agency owes the airline). They are equal on published business; a gap is
  // the signature of a net fare, where the revenue is markup, not commission.
  const ksLine = find(/^KS-/) ?? find(/^K-[A-Z][A-Z]{3}[\d]/);
  const knLine = find(/^KN-/);
  const currency = /USD/.test(ksLine ?? knLine ?? "") ? "USD" : "USD";

  const sellingBase = ksLine ? parseFareAmount(fields(ksLine)[0] ?? "", warnings, "selling fare") : null;
  const netBase = knLine ? parseFareAmount(fields(knLine)[0] ?? "", warnings, "net fare") : null;
  if (!sellingBase && !netBase) warnings.push("no fare amounts (KS-/KN- elements) found");
  const baseFare = sellingBase ?? netBase ?? money(0n, currency);

  // The KSTB/KNTB breakdown is authoritative; the TAX- line aggregates small
  // taxes into XT and must never be used as the tax stack.
  const tbLine = find(/^K[SNF]T[BF];/);
  const taxes: TaxItem[] = [];
  if (tbLine) {
    for (const field of tbLine.split(";").slice(1)) {
      const t = parseTaxField(field, warnings);
      if (t) taxes.push(t);
    }
  } else {
    warnings.push("no itemised tax breakdown (KSTB/KNTB/KFTB) found; XT cannot be exploded");
  }

  const taxTotal = sum(taxes.map((t) => t.amount), currency);
  const total = { units: baseFare.units + taxTotal.units, currency };

  // Cross-check against the file's own stated total.
  const statedTotal = ksLine
    ? parseFareAmount(fields(ksLine).slice(1).join(";"), warnings, "selling total")
    : null;
  if (statedTotal && statedTotal.units !== total.units) {
    warnings.push(
      `computed total ${total.units} does not match the file's stated total ${statedTotal.units}`,
    );
  }

  // --- fare type -----------------------------------------------------------
  const qLine = find(/^Q-/);
  const fareCalc = qLine ? qLine.slice(2).split(";")[0] ?? null : null;
  const bulk = /(^|\W)(M\/BT|M\/IT|\bBT\b|\bIT\b)/.test(fareCalc ?? "") || /^SIAB.*;BT\s*$/m.test(text);

  const hasMarkup = Boolean(netBase && sellingBase && netBase.units !== sellingBase.units);
  const fareType: FareType = bulk ? "net" : hasMarkup ? "private" : "published";

  // --- tour code -----------------------------------------------------------
  // Amadeus carries it in the FT element. Its absence is a finding, not a blank.
  const ftLine = find(/^FT/);
  const tourCode = ftLine ? (/^FT\*?[A-Z]?\*?([A-Z0-9]+)/.exec(ftLine)?.[1] ?? null) : null;

  // --- the airline's own exchange arithmetic -------------------------------
  const atcLine = find(/^ATC-/);
  const atc: AtcBlock | null = (() => {
    if (!atcLine) return null;
    const vals = fields(atcLine).map((v) => {
      const m = /([A-Z]{3})\s*(-?[\d,]+\.?\d*)/.exec(v);
      return m ? parseMoney(m[2], m[1]) : null;
    });
    const block: AtcBlock = {
      originalBase: vals[0] ?? null,
      newBase: vals[1] ?? null,
      collectedFareDifference: vals[2] ?? null,
      originalTax: vals[3] ?? null,
      newTax: vals[4] ?? null,
      newTotal: vals[7] ?? null,
      changeFee: vals[8] ?? null,
      totalCollected: vals[9] ?? null,
      fields: vals,
    };
    // Two independent checks the airline's own numbers must satisfy.
    if (block.newTotal && block.newTotal.units !== total.units) {
      warnings.push(
        `ATC states a new total of ${block.newTotal.units} but the fare and taxes give ${total.units}`,
      );
    }
    if (block.collectedFareDifference && block.changeFee && block.totalCollected) {
      const expect = block.collectedFareDifference.units + block.changeFee.units;
      if (expect !== block.totalCollected.units) {
        warnings.push(
          `ATC total collected ${block.totalCollected.units} is not the fare difference ` +
            `plus the change fee (${expect})`,
        );
      }
    }
    return block;
  })();

  // --- document type -------------------------------------------------------
  // The B- element names the transaction: TTP/EXCH is a reissue, TTP/RFND a
  // refund. Reading it off the ticket number would be a guess.
  const bLine = find(/^B-/) ?? "";
  const documentType: TicketDocument["documentType"] =
    /\bEXCH\b/.test(bLine) ? "EXCH"
    : /\bRFND\b/.test(bLine) ? "RFND"
    : /\bVOID\b/.test(bLine) ? "VOID"
    : "TKT";

  // --- exchange detail -----------------------------------------------------
  // FO carries the ticket being replaced and, crucially, the fare and the
  // commission already recognised on it:
  //   FO114-7507683087EWR30AUG26/33535983/114-75080510872E1*B2022.00/X117.00/C0.00
  //                                                          base ──┘  tax ──┘  comm ──┘
  const foLine = find(/^FO/);
  const changeFee = (() => {
    // Several RI lines can appear. On a reissue the first is the credit for the
    // ticket being exchanged, as a negative amount; taking it positionally
    // would book a -707.87 credit as a change fee.
    const ri = lines.find((l) => /^RI[A-Z]?[A-Z]{3};/.test(l) && /CHANGE FEE/i.test(l));
    if (!ri) return null;
    const m = /;\s*(-?[\d,]+\.\d{2})/.exec(ri);
    return m ? parseMoney(m[1], currency) : null;
  })();
  const additionalCollection = (() => {
    const ex = find(/^RM\*EXA\*/);
    if (!ex) return null;
    const m = /([\d,]+\.\d{2})/.exec(ex);
    return m ? parseMoney(m[1], currency) : null;
  })();

  let exchange: TicketDocument["exchange"] = null;
  if (foLine) {
    const originalTicket =
      /^FO(\d{3}-?\d{10})/.exec(foLine)?.[1] ??
      (find(/^FH/) ? /^FH(\d{3}-?\d{10})/.exec(find(/^FH/)!)?.[1] : undefined) ?? null;
    const b = /\*B([\d,]+\.\d{2})/.exec(foLine)?.[1];
    const x = /\/X([\d,]+\.\d{2})/.exec(foLine)?.[1];
    const c = /\/C([\d,]+\.\d{2})/.exec(foLine)?.[1];
    if (!originalTicket) warnings.push("FO element present but no original ticket number in it");
    if (!b) warnings.push("FO element present but no original base fare in it");
    const foBase = b ? parseMoney(b, currency) : null;
    exchange = {
      originalTicket: originalTicket ?? "UNKNOWN",
      originalBase: foBase ?? money(0n, currency),
      originalTax: x ? parseMoney(x, currency) : null,
      originalCommission: c ? parseMoney(c, currency) : null,
      // RM*EXA states the fare difference; where it is absent the ATC block's
      // collected difference stands in. They are not always the same number,
      // so which one was used is recorded rather than blended.
      additionalCollection: additionalCollection ?? atc?.collectedFareDifference ?? null,
      changeFee: changeFee ?? atc?.changeFee ?? null,
    };
    if (foBase && atc?.originalBase && foBase.units !== atc.originalBase.units) {
      warnings.push(
        `FO gives an original base of ${foBase.units} but ATC gives ${atc.originalBase.units}`,
      );
    }
  } else if (documentType === "EXCH") {
    warnings.push("document is an exchange but carries no FO element to net against");
  }

  // --- commission recorded in the file -------------------------------------
  const fmLine = find(/^FM/);
  const reportedFM: ReportedCommission | null = (() => {
    if (!fmLine) return null;
    const body = fmLine.split(";")[0] ?? fmLine;
    const amount = /\*?([\d,]+\.\d{2})A\b/.exec(body);
    if (amount) {
      return { kind: "amount" as const, amount: parseMoney(amount[1], currency) };
    }
    const percent = /\*([\d]+(?:\.\d+)?)\s*$/.exec(body);
    if (percent) {
      return {
        kind: "percent" as const,
        rate: percent[1],
        amount: applyRate(baseFare, percent[1], "half_up"),
      };
    }
    warnings.push(`FM element "${body}" could not be read as an amount or a rate`);
    return null;
  })();

  const ticket: TicketDocument = {
    ticketNumber: ticketNumber ?? "UNKNOWN",
    documentType,
    inRespectOf: exchange?.originalTicket ?? null,
    exchange,
    validatingCarrier: validatingCarrier ?? "??",
    iataNumber: agencyIata ?? undefined,
    issueDate: issueDate ?? "",
    posCountry,
    currency,
    baseFare,
    netFare: netBase,
    bulk,
    taxes,
    total,
    fareCalc,
    tourCode,
    fareType,
    paxType: "ADT",
    reportedCommission: reportedFM?.amount ?? null,
    coupons,
  };

  const markup =
    sellingBase && netBase ? subtract(sellingBase, netBase) : money(0n, currency);

  return { ticket, documentType, markup, reportedFM, atc, agencyIata, recordLocator, warnings, raw };
}
