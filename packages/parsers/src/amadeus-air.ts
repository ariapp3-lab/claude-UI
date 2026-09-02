/**
 * Amadeus AIR file (back-office interface record) → canonical tickets.
 *
 * The AIR record is line-oriented: a short prefix, a separator, then
 * semicolon-separated fields whose meaning depends on the prefix. One record
 * describes ONE priced itinerary but can carry MANY passengers, each with their
 * own ticket number — so the unit of output is a list, never a single ticket.
 *
 * The parser reports what the file says. It never infers a missing value, and
 * anything it could not read lands in `warnings` for a human rather than being
 * defaulted: a defaulted field in a commission calculation is a wrong number
 * wearing a confident face.
 *
 * Every rule below was put there by a real ticket. See README.md for the list
 * of traps and which sample found each one.
 */

import { applyRate, money, parseMoney, subtract, sum, type Money } from "@commission/engine";
import type {
  Coupon, FareType, PaxType, TaxItem, TicketDocument,
} from "@commission/engine";

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
 * verified against more than one real document are named; the rest stay in
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

export interface AirPassenger {
  readonly ticket: TicketDocument;
  /** Passenger reference within the booking, e.g. "02". */
  readonly ref: string;
  /** Selling less net. Zero on published business. */
  readonly markup: Money;
  readonly reportedFM: ReportedCommission | null;
}

export interface AirParseResult {
  /** One per passenger. A five-passenger booking yields five tickets. */
  readonly tickets: readonly TicketDocument[];
  readonly passengers: readonly AirPassenger[];
  readonly documentType: TicketDocument["documentType"];
  readonly atc: AtcBlock | null;
  readonly agencyIata: string | null;
  readonly recordLocator: string | null;
  /**
   * Records arrive split into parts ("2/3" in the AMD line). A part is not the
   * whole booking, and its siblings carry the passengers it does not.
   */
  readonly part: { readonly index: number; readonly of: number } | null;
  readonly warnings: readonly string[];
  readonly raw: Readonly<Record<string, string[]>>;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "260828" → "2026-08-28". Two-digit years in this format are 20xx. */
function parseYYMMDD(v: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v.trim());
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "31AUG" plus a reference date → ISO, rolling forward across a year end. */
function parseDDMMM(v: string, referenceISO: string): string | null {
  const m = /^(\d{2})([A-Z]{3})$/.exec(v.trim().toUpperCase());
  if (!m) return null;
  const mm = MONTHS[m[2]];
  if (!mm) return null;
  const year = Number(referenceISO.slice(0, 4));
  const candidate = `${year}-${mm}-${m[1]}`;
  return candidate < referenceISO ? `${year + 1}-${mm}-${m[1]}` : candidate;
}

/** " USD23.40    US AP" → { code: "US", amount } */
function parseTaxField(field: string, warnings: string[]): TaxItem | null {
  const m = /^\s*([A-Z]{3})\s*(-?[\d,]+\.?\d*)\s+([A-Z0-9]{2})/.exec(field);
  if (!m) return null;
  try {
    return { code: m[3], amount: parseMoney(m[2], m[1]) };
  } catch (e) {
    warnings.push(`tax field "${field.trim()}" could not be read: ${String(e)}`);
    return null;
  }
}

function parseAmountIn(field: string): Money | null {
  const m = /([A-Z]{3})\s*(-?[\d,]+\.?\d*)/.exec(field);
  return m ? parseMoney(m[2], m[1]) : null;
}

export function parseAmadeusAir(text: string): AirParseResult {
  const warnings: string[] = [];
  const raw: Record<string, string[]> = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of lines) {
    const prefix = /^([A-Z]{1,4})[-*]?/.exec(line)?.[1] ?? "?";
    (raw[prefix] ??= []).push(line);
  }

  const find = (re: RegExp, from: string[] = lines) => from.find((l) => re.test(l)) ?? null;
  const fields = (line: string) => {
    const i = line.search(/[-*]/);
    return line.slice(i + 1).split(";");
  };

  // --- record part ---------------------------------------------------------
  const amd = find(/^AMD\s/);
  const partMatch = amd ? /;(\d+)\/(\d+);/.exec(amd) : null;
  const part = partMatch
    ? { index: Number(partMatch[1]), of: Number(partMatch[2]) }
    : null;
  if (part && part.of > 1) {
    warnings.push(
      `this is part ${part.index} of ${part.of}; the remaining parts carry ` +
        "passengers this one does not and must be processed alongside it",
    );
  }

  // --- identity ------------------------------------------------------------
  const aLine = find(/^A-/);
  const validatingCarrier = aLine ? (/;\s*([A-Z0-9]{2})\s/.exec(aLine)?.[1] ?? null) : null;
  if (!validatingCarrier) warnings.push("no validating carrier (A- element) found");

  const officeLine = lines.find((l) => /^[A-Z]{3}1A\s/.test(l)) ?? null;
  const iataNumbers = officeLine
    ? [...new Set((officeLine.match(/;(\d{8})(?=;)/g) ?? []).map((s) => s.slice(1)))]
    : [];
  if (iataNumbers.length > 1) {
    warnings.push(`office line names more than one IATA number: ${iataNumbers.join(", ")}`);
  }
  const agencyIata = iataNumbers[0] ?? null;
  const recordLocator = officeLine
    ? (/^[A-Z]{3}1A\s+([A-Z0-9]{6})/.exec(officeLine)?.[1] ?? null)
    : null;

  // --- dates ---------------------------------------------------------------
  // The D- element carries three dates: creation, ticketing, invoice. On a
  // straight issue they are identical; on a reissue they are not — one sample
  // was created 15 July and ticketed 2 September. Commission turns on the
  // TICKETING date, so the second field governs.
  const dLine = find(/^D-/);
  const dFields = dLine ? fields(dLine).map((v) => parseYYMMDD(v)) : [];
  const issueDate = dFields[1] ?? dFields[0] ?? null;
  if (!issueDate) warnings.push("no issue date (D- element) found");

  const tkLine = find(/^TK/);
  const tkDate = tkLine ? /^TK[A-Z]{2}(\d{2}[A-Z]{3})/.exec(tkLine)?.[1] : undefined;
  if (tkDate && issueDate) {
    const expected = parseDDMMM(tkDate, `${issueDate.slice(0, 4)}-01-01`);
    if (expected && expected !== issueDate) {
      warnings.push(
        `D- gives a ticketing date of ${issueDate} but the TK element says ${expected}`,
      );
    }
  }

  const posCountry = "US";
  if (!officeLine) warnings.push("point of sale inferred as US; no office line found");

  // --- document type -------------------------------------------------------
  const bLine = find(/^B-/) ?? "";
  const documentType: TicketDocument["documentType"] =
    /\bEXCH\b/.test(bLine) ? "EXCH"
    : /\bRFND\b/.test(bLine) ? "RFND"
    : /\bVOID\b/.test(bLine) ? "VOID"
    : "TKT";

  // --- coupons -------------------------------------------------------------
  // U- elements are waitlisted or unconfirmed segments (RQ/HL) that were never
  // ticketed. They look exactly like coupons and must never be counted as any.
  const coupons: Coupon[] = [];
  for (const line of lines.filter((l) => /^H-\d/.test(l))) {
    const f = fields(line);
    const n = coupons.length + 1;      // H- digits are element refs, not coupons
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
      origin: (f[1] ?? "").slice(-3),
      destination: f[3] ?? "",
      marketingCarrier: fm[1],
      operatingCarrier: fm[1],
      flightNumber: `${fm[1]}${fm[2]}`,
      rbd: fm[3],
      fareBasis: "",
      departureDate: departureDate ?? issueDate ?? "",
      status: "OK",
    });
  }
  if (coupons.length === 0) warnings.push("no flight coupons (H- elements) found");

  const waitlisted = lines.filter((l) => /^U-\d/.test(l)).length;
  if (waitlisted > 0) {
    warnings.push(`${waitlisted} waitlisted segment(s) (U- elements) present and correctly ignored`);
  }

  // The M- element gives fare basis and ticket designator together, positionally
  // per coupon: "YPRPF3R  CH" is fare basis YPRPF3R with designator CH.
  let ticketDesignator: string | null = null;
  const mLine = find(/^M-/);
  if (mLine) {
    const entries = fields(mLine).map((s) => s.trim()).filter(Boolean);
    entries.forEach((entry, i) => {
      const [basis, designator] = entry.split(/\s+/);
      if (coupons[i]) (coupons[i] as { fareBasis: string }).fareBasis = basis ?? "";
      if (designator) ticketDesignator = designator;
    });
    if (entries.length !== coupons.length) {
      warnings.push(`${entries.length} fare basis codes for ${coupons.length} coupons`);
    }
  } else {
    warnings.push("no fare basis (M- element) found");
  }

  // --- money ---------------------------------------------------------------
  // KS is the selling fare, KN the net. They are equal on published business
  // and on a bulk fare sold at cost; a gap is markup. The fare line is KS-/KN-
  // on an issue but K-B or K-F on an exchange, so the shape varies.
  const ksLine = find(/^KS-/) ?? find(/^K-[A-Z][A-Z]{3}\d/);
  const knLine = find(/^KN-/);
  const currency = "USD";

  const sellingBase = ksLine ? parseAmountIn(fields(ksLine)[0] ?? "") : null;
  const netBase = knLine ? parseAmountIn(fields(knLine)[0] ?? "") : null;
  if (!sellingBase && !netBase) warnings.push("no fare amounts (KS-/KN-/K- elements) found");
  const baseFare = sellingBase ?? netBase ?? money(0n, currency);

  // The breakdown line is KSTB, KNTB, KFTB or KFTF. TAX- must never be used:
  // it aggregates small taxes into a single XT line that a rule naming a tax
  // code cannot see through.
  const tbLine = find(/^K[SNF]T[BF];/);
  const taxes: TaxItem[] = [];
  if (tbLine) {
    for (const field of tbLine.split(";").slice(1)) {
      const t = parseTaxField(field, warnings);
      if (t) taxes.push(t);
    }
  } else {
    warnings.push("no itemised tax breakdown (KSTB/KNTB/KFTB/KFTF) found; XT cannot be exploded");
  }

  const taxTotal = sum(taxes.map((t) => t.amount), currency);
  const total = { units: baseFare.units + taxTotal.units, currency };

  const statedTotal = ksLine
    ? parseAmountIn(fields(ksLine).slice(1).join(";"))
    : null;
  if (statedTotal && statedTotal.units !== total.units) {
    warnings.push(
      `computed total ${total.units} does not match the file's stated total ${statedTotal.units}`,
    );
  }

  // --- fare type -----------------------------------------------------------
  const qLine = find(/^Q-/);
  const fareCalc = qLine ? (qLine.slice(2).split(";")[0] ?? null) : null;
  const bulk =
    /(^|\W)M\/(BT|IT)(\W|$)/.test(fareCalc ?? "") || /^SIAB.*;\s*(BT|IT)\s*$/m.test(text);
  const hasMarkup = Boolean(netBase && sellingBase && netBase.units !== sellingBase.units);
  const fareType: FareType = bulk ? "net" : hasMarkup ? "private" : "published";

  const ftLine = find(/^FT/);
  const tourCode = ftLine ? (/^FT\*?[A-Z]?\*?([A-Z0-9]+)/.exec(ftLine)?.[1] ?? null) : null;

  // --- the airline's own exchange arithmetic -------------------------------
  const atcLine = find(/^ATC-/);
  const atc: AtcBlock | null = (() => {
    if (!atcLine) return null;
    const vals = fields(atcLine).map(parseAmountIn);
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
    if (block.newTotal && block.newTotal.units !== total.units) {
      warnings.push(
        `ATC states a new total of ${block.newTotal.units} but fare plus taxes give ${total.units}`,
      );
    }
    if (block.collectedFareDifference && block.changeFee && block.totalCollected) {
      const expect = block.collectedFareDifference.units + block.changeFee.units;
      if (expect !== block.totalCollected.units) {
        warnings.push(
          `ATC total collected ${block.totalCollected.units} is not the fare ` +
            `difference plus the change fee (${expect})`,
        );
      }
    }
    return block;
  })();

  // --- exchange detail -----------------------------------------------------
  // Several RI lines can appear. On a reissue the first is the credit for the
  // ticket being exchanged, as a negative amount; the fee is matched by name.
  const changeFee = (() => {
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

  const foLine = find(/^FO/);
  let exchange: TicketDocument["exchange"] = null;
  if (foLine) {
    const originalTicket = /^FO(\d{3}-?\d{10})/.exec(foLine)?.[1] ?? null;
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

  // --- passengers ----------------------------------------------------------
  // Everything above is shared by the itinerary. Everything below is per
  // passenger: each I- block owns a ticket number and its own FM element.
  const iIndices = lines
    .map((l, i) => (/^I-\d/.test(l) ? i : -1))
    .filter((i) => i >= 0);

  const blocks = iIndices.map((start, k) => ({
    header: lines[start],
    body: lines.slice(start, iIndices[k + 1] ?? lines.length),
  }));

  if (blocks.length === 0) warnings.push("no passenger (I-) blocks found");

  const readFM = (scope: string[]): ReportedCommission | null => {
    const fmLine = find(/^FM/, scope);
    if (!fmLine) return null;
    const body = fmLine.split(";")[0] ?? fmLine;
    // A trailing "A" marks an amount. Without it, a value carrying decimals is
    // still an amount and a bare integer is a percentage.
    const amount = /\*?(-?[\d,]+\.\d{2})A\b/.exec(body);
    if (amount) return { kind: "amount", amount: parseMoney(amount[1], currency) };
    const decimal = /\*(-?[\d,]+\.\d{2})\s*$/.exec(body);
    if (decimal) return { kind: "amount", amount: parseMoney(decimal[1], currency) };
    const percent = /\*(\d+(?:\.\d)?)\s*$/.exec(body);
    if (percent) {
      return {
        kind: "percent",
        rate: percent[1],
        amount: applyRate(baseFare, percent[1], "half_up"),
      };
    }
    warnings.push(`FM element "${body}" could not be read as an amount or a rate`);
    return null;
  };

  const passengers: AirPassenger[] = blocks.map((block, i) => {
    const f = fields(block.header);
    const label = f[1] ?? "";
    const ref = /^(\d{2})/.exec(label)?.[1] ?? String(i + 1).padStart(2, "0");

    const tLine = find(/^T-/, block.body);
    const ticketNumber = tLine ? (/^T-E?(\d{3}-?\d{10})/.exec(tLine)?.[1] ?? null) : null;
    if (!ticketNumber) {
      warnings.push(`passenger ${ref} has no ticket number (T- element)`);
    }

    const isChild = /\(CHD\)/i.test(label) || block.body.some((l) => /^SSR CHLD/.test(l));
    const isInfant = /\(INF\)/i.test(label) || block.body.some((l) => /^SSR INFT/.test(l));
    const paxType: PaxType = isInfant ? "INF" : isChild ? "CHD" : "ADT";

    const reportedFM = readFM(block.body) ?? readFM(lines);

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
      ticketDesignator,
      fareType,
      paxType,
      reportedCommission: reportedFM?.amount ?? null,
      coupons,
    };

    return {
      ticket,
      ref,
      markup: sellingBase && netBase ? subtract(sellingBase, netBase) : money(0n, currency),
      reportedFM,
    };
  });

  // The segment status carries a passenger count ("OK03"). A disagreement with
  // the number of I- blocks means tickets are missing from this part.
  const hLine = find(/^H-\d/);
  const stated = hLine ? /;OK(\d{2});/.exec(hLine)?.[1] : undefined;
  if (stated && Number(stated) !== passengers.length) {
    warnings.push(
      `segments are held for ${Number(stated)} passenger(s) but ${passengers.length} ` +
        "ticket(s) are present in this part",
    );
  }

  return {
    tickets: passengers.map((p) => p.ticket),
    passengers,
    documentType,
    atc,
    agencyIata,
    recordLocator,
    part,
    warnings,
    raw,
  };
}
