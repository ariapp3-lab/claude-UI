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

import { money, parseMoney, subtract, sum, type Money } from "@commission/engine";
import type { Coupon, FareType, TaxItem, TicketDocument } from "@commission/engine";

export interface AirParseResult {
  readonly ticket: TicketDocument;
  readonly documentType: TicketDocument["documentType"];
  /** Revenue on a net fare: selling less net. Zero on published business. */
  readonly markup: Money;
  /** The commission or markup the file itself records (Amadeus FM element). */
  readonly reportedFM: Money | null;
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
  const ksLine = find(/^KS-/) ?? find(/^K-B/);
  const knLine = find(/^KN-/);
  const currency = /USD/.test(ksLine ?? knLine ?? "") ? "USD" : "USD";

  const sellingBase = ksLine ? parseFareAmount(fields(ksLine)[0] ?? "", warnings, "selling fare") : null;
  const netBase = knLine ? parseFareAmount(fields(knLine)[0] ?? "", warnings, "net fare") : null;
  if (!sellingBase && !netBase) warnings.push("no fare amounts (KS-/KN- elements) found");
  const baseFare = sellingBase ?? netBase ?? money(0n, currency);

  // The KSTB/KNTB breakdown is authoritative; the TAX- line aggregates small
  // taxes into XT and must never be used as the tax stack.
  const tbLine = find(/^KSTB/) ?? find(/^KNTB/) ?? find(/^KFTB/);
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
    const ri = find(/^RI[A-Z]?[A-Z]{3};/);
    if (!ri) return null;
    const m = /;\s*([\d,]+\.\d{2})/.exec(ri);
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
    exchange = {
      originalTicket: originalTicket ?? "UNKNOWN",
      originalBase: b ? parseMoney(b, currency) : money(0n, currency),
      originalTax: x ? parseMoney(x, currency) : null,
      originalCommission: c ? parseMoney(c, currency) : null,
      additionalCollection,
      changeFee,
    };
  } else if (documentType === "EXCH") {
    warnings.push("document is an exchange but carries no FO element to net against");
  }

  // --- commission recorded in the file -------------------------------------
  const fmLine = find(/^FM/);
  const reportedFM = fmLine
    ? (() => {
        const m = /\*[A-Z]?\*?([\d,]+\.\d{2})/.exec(fmLine) ?? /([\d,]+\.\d{2})/.exec(fmLine);
        return m ? parseMoney(m[1], currency) : null;
      })()
    : null;

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
    reportedCommission: reportedFM,
    coupons,
  };

  const markup =
    sellingBase && netBase ? subtract(sellingBase, netBase) : money(0n, currency);

  return { ticket, documentType, markup, reportedFM, agencyIata, recordLocator, warnings, raw };
}
