/**
 * The host agency's weekly client statement.
 *
 * This is not a commission statement. It is an accounts ledger: one line per
 * thing the host billed or credited, and the balance at the foot is the payout.
 * Reading a real one changed three assumptions the CSV reader was built on.
 *
 *  1. THE KEY IS THE INVOICE NUMBER, NOT THE TICKET NUMBER. On the statement
 *     read here, 11 of 145 lines carry a ticket number and every one of those
 *     eleven is 0.00 — they are the airline's own issue records. Every line
 *     that carries money has no ticket number at all. A reconciler matching on
 *     ticket number matches nothing.
 *
 *  2. SIGN CARRIES THE MEANING. A negative amount is a credit: money the host
 *     owes the agent, being the markup and commission on that booking. A
 *     positive amount is a charge: the host's fee. The payout is the sum, and
 *     it is normally negative.
 *
 *  3. ONE INVOICE CAN CARRY SEVERAL LINES, and the host nets them itself,
 *     printing the subtotal on a line of its own. A credit of 50.00 against a
 *     25.00 exchange fee prints as -25.00. Those subtotal lines are not
 *     transactions and must not be counted twice.
 *
 * The layout is a fixed-width report, two lines per invoice: the issue date and
 * invoice number on one, the detail on the next. The header row gives the column
 * offsets, but they are a guide rather than a grid — a ticket number on a row
 * shifts everything after it — so the amount is found by pattern and the
 * description split on runs of spaces.
 */

import { type Money, parseMoney, zero } from "@commission/engine";

export interface ClientStatementLine {
  /** The host's invoice number — the identity of the line. */
  readonly invoice: string;
  /** Present on the airline's own issue records; absent on money lines. */
  readonly ticketNumber: string | null;
  readonly passenger: string;
  /** "MST" where the host billed it; an airline name on an issue record. */
  readonly vendor: string;
  /** Date the invoice was raised, ISO. */
  readonly issueDate: string | null;
  /** First date of travel, ISO. */
  readonly startDate: string | null;
  /** "JFKTLVJFK" as the statement prints it, unpunctuated. */
  readonly itinerary: string;
  /**
   * Signed as the statement prints it: negative is a credit the host owes the
   * agent, positive is a charge the host is making.
   */
  readonly amount: Money;
  readonly remark: string;
  /** 1-based line in the source, so a human can be pointed at it. */
  readonly row: number;
}

export interface ClientStatementInvoice {
  readonly invoice: string;
  readonly lines: readonly ClientStatementLine[];
  /** Sum of the lines. Negative means the host owes the agent. */
  readonly net: Money;
  /**
   * The subtotal the statement printed for this invoice, where it printed one.
   * Kept separate from `net` so the two can be compared: a disagreement is a
   * parse failure or an arithmetic error on the statement, and either matters.
   */
  readonly statedNet: Money | null;
}

export interface ClientStatementResult {
  readonly lines: readonly ClientStatementLine[];
  readonly invoices: readonly ClientStatementInvoice[];
  readonly client: { readonly name: string | null; readonly id: string | null;
                     readonly number: string | null };
  /** The "To:" date at the head of the statement, ISO. */
  readonly to: string | null;
  readonly currency: string;
  readonly totals: {
    /** Charges the host made — fees. Positive. */
    readonly charges: Money;
    /** Credits the host owes — markup and commission. Negative. */
    readonly credits: Money;
    /** charges + credits. Negative means the host owes the agent. */
    readonly payout: Money;
    /**
     * The balance the statement itself prints at the foot.
     *
     * Kept beside our own sum rather than in place of it: if the two disagree,
     * either the reader has misread a line or the statement does not add up,
     * and both are worth knowing before anyone acts on the figure.
     */
    readonly statedBalance: Money | null;
  };
  readonly warnings: readonly string[];
}

const AMOUNT = /^-?[\d,]+\.\d{2}$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
/** Letterhead, column headings and page furniture — never transactions. */
const FURNITURE =
  /Client Statement|TRAVEL CENTER|Issue Dt|Ticket No\s+Passenger|Page \d+|@|FAX|TOLL FREE|Client ID|Client No|^\s*Phone:|^\s*E-Mail:|PLEASURE DOING BUSINESS|THANK YOU/i;

/**
 * The closing block. These carry an amount and would otherwise read as two more
 * transactions — and since they restate the balance, counting them doubles it.
 * Parsing this statement without them produced a figure three times too large.
 */
const CLOSING = /^\s*(Total\s+Open|Account\s+Balance|Balance\s+Due|Amount\s+Due)\b/i;

/** "8/16/2026" to "2026-08-16". Returns null on anything else. */
function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = US_DATE.exec(v.trim());
  if (!m) return null;
  // US order: 8/16/2026 is August the 16th.
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

interface Columns {
  ticket: number; passenger: number; vendor: number;
  start: number; itinerary: number; fare: number; remarks: number;
}

/**
 * Read the column offsets from the header row.
 *
 * A fixed-width report is only fixed if you know where the columns are, and
 * guessing them from the data goes wrong the first time a passenger is called
 * "Van Der Berg/Anne" or a vendor is "El Al Israel Airlines". The header says
 * where they are, so read it.
 */
function findColumns(lines: readonly string[]): Columns | null {
  for (const ln of lines) {
    if (!ln.includes("Ticket No") || !ln.includes("Passenger")) continue;
    const at = (label: string) => ln.indexOf(label);
    const cols = {
      ticket: at("Ticket No"), passenger: at("Passenger"), vendor: at("Vendor"),
      start: at("Start Dt"), itinerary: at("Itinerary"), fare: at("Fare"),
      remarks: at("Remarks"),
    };
    if (Object.values(cols).some((n) => n < 0)) continue;
    return cols;
  }
  return null;
}

/**
 * Vendors seen on a travel agency's own statement: itself, and the airlines it
 * reports issue records for. Used only to recover the boundary where the report
 * separated the passenger from the vendor with a single space instead of the
 * usual run — the passenger's own name is never matched, because the split is
 * anchored to the start of a word and every passenger carries a "/".
 */
const VENDOR = /\b(MST|El Al[A-Za-z ]*|Delta[A-Za-z ]*|United[A-Za-z ]*|American[A-Za-z ]*|Lufthansa[A-Za-z ]*|[A-Z][A-Za-z]+ Air[A-Za-z]*)\s*$/;

/**
 * Pull the description apart: ticket number, passenger, vendor, travel date,
 * itinerary.
 *
 * The report separates these with a run of spaces most of the time and with a
 * single space some of the time, and which it does varies by row rather than by
 * column. So the fields are recovered by what they are rather than by where
 * they sit: a ticket number is a long run of digits at the front, a date is a
 * date, the passenger carries a "/", and the vendor is what sits between the
 * passenger and the date.
 */
function readDescription(head: string): {
  ticketNumber: string | null; passenger: string; vendor: string;
  startDate: string | null; itinerary: string;
} {
  let rest = head.trim();

  const tk = /^(\d{9,13})\s+/.exec(rest);
  const ticketNumber = tk ? tk[1]! : null;
  if (tk) rest = rest.slice(tk[0].length);

  // Everything from the travel date rightwards.
  const dm = /\s(\d{1,2}\/\d{1,2}\/\d{4})\s*/.exec(rest);
  const startDate = dm ? isoDate(dm[1]) : null;
  const before = dm ? rest.slice(0, dm.index) : rest;
  const itinerary = dm ? rest.slice(dm.index + dm[0].length).trim() : "";

  // Passenger and vendor, usually separated by a run of spaces.
  const parts = before.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { ticketNumber, passenger: parts[0]!, vendor: parts.slice(1).join(" "),
             startDate, itinerary };
  }

  // One field: the report used a single space. Split at the vendor.
  const only = parts[0] ?? "";
  const vm = VENDOR.exec(only);
  if (vm && vm.index > 0) {
    return { ticketNumber, passenger: only.slice(0, vm.index).trim(),
             vendor: vm[0].trim(), startDate, itinerary };
  }
  return { ticketNumber, passenger: only, vendor: "", startDate, itinerary };
}

export function parseMstClientStatement(
  text: string,
  opts: { readonly currency?: string } = {},
): ClientStatementResult {
  const currency = opts.currency ?? "USD";
  const warnings: string[] = [];
  const raw = text.split(/\r\n|\r|\n/);

  const cols = findColumns(raw);
  if (!cols) {
    warnings.push(
      "no column header was found — this does not look like a client statement",
    );
  }

  let client: { name: string | null; id: string | null; number: string | null } =
    { name: null, id: null, number: null };
  let to: string | null = null;

  const lines: ClientStatementLine[] = [];
  const statedNets = new Map<string, Money>();
  let statedBalance: Money | null = null;
  let invoice: string | null = null;
  let issueDate: string | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ln = raw[i]!;
    const t = ln.trim();
    if (!t) continue;

    const toMatch = /\bTo:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t);
    if (toMatch) to = isoDate(toMatch[1]);
    const idMatch = /Client ID:\s*(\S+)/.exec(t);
    if (idMatch) client = { ...client, id: idMatch[1]! };
    const noMatch = /Client No:\s*(\S+)/.exec(t);
    if (noMatch) client = { ...client, number: noMatch[1]! };

    if (FURNITURE.test(t)) continue;

    const closing = CLOSING.exec(t);
    if (closing) {
      const amt = /-?[\d,]+\.\d{2}\s*$/.exec(t);
      if (amt) statedBalance = parseMoney(amt[0].replace(/,/g, ""), currency);
      continue;
    }

    // "7/27/2026    10107449" — the invoice this line and the next belong to.
    const header = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{5,})$/.exec(t);
    if (header) {
      invoice = header[2]!;
      issueDate = isoDate(header[1]);
      continue;
    }

    // A lone amount is the subtotal the statement printed for the invoice
    // above. It is a restatement of lines already read, not a transaction.
    if (AMOUNT.test(t)) {
      // The grand total prints the same way, immediately after the last
      // invoice, so it would be read as that invoice's subtotal. A subtotal is
      // only printed where there is something to net, so require two lines.
      const seen = lines.filter((l) => l.invoice === invoice).length;
      if (invoice && seen > 1) {
        statedNets.set(invoice, parseMoney(t.replace(/,/g, ""), currency));
      } else {
        statedBalance = parseMoney(t.replace(/,/g, ""), currency);
      }
      continue;
    }

    // The money is the first amount past the description. Anything after it is
    // the remark. Column offsets are not used for this: every page of the
    // report carries its own header at slightly different offsets, and the rows
    // do not reliably line up with their own page's header either.
    const hit = [...ln.matchAll(/-?[\d,]+\.\d{2}/g)]
      .find((m) => m.index !== undefined && m.index >= 40);
    if (!hit || hit.index === undefined) continue;
    const amountText = hit[0];

    if (!invoice) {
      warnings.push(`line ${i + 1} carries an amount but no invoice number precedes it`);
      continue;
    }

    const { ticketNumber, passenger, vendor, startDate, itinerary } =
      readDescription(ln.slice(0, hit.index));

    lines.push({
      invoice,
      ticketNumber,
      passenger,
      vendor,
      issueDate,
      startDate,
      itinerary,
      amount: parseMoney(amountText.replace(/,/g, ""), currency),
      remark: ln.slice(hit.index + amountText.length).trim(),
      row: i + 1,
    });
  }

  // Group by invoice, preserving the order they appeared in.
  const order: string[] = [];
  const grouped = new Map<string, ClientStatementLine[]>();
  for (const l of lines) {
    if (!grouped.has(l.invoice)) { grouped.set(l.invoice, []); order.push(l.invoice); }
    grouped.get(l.invoice)!.push(l);
  }

  const invoices: ClientStatementInvoice[] = order.map((id) => {
    const ls = grouped.get(id)!;
    const net = ls.reduce((n, l) => n + l.amount.units, 0n);
    const stated = statedNets.get(id) ?? null;
    if (stated && stated.units !== net) {
      warnings.push(
        `invoice ${id}: the statement prints a subtotal that its own lines do not sum to`,
      );
    }
    return { invoice: id, lines: ls, net: { units: net, currency }, statedNet: stated };
  });

  const charges = lines.filter((l) => l.amount.units > 0n)
    .reduce((n, l) => n + l.amount.units, 0n);
  const credits = lines.filter((l) => l.amount.units < 0n)
    .reduce((n, l) => n + l.amount.units, 0n);

  if (lines.length === 0) {
    warnings.push("no transaction lines were found");
  }
  if (statedBalance && statedBalance.units !== charges + credits) {
    warnings.push(
      `the lines sum to ${(Number(charges + credits) / 100).toFixed(2)} but the statement ` +
      `prints a balance of ${(Number(statedBalance.units) / 100).toFixed(2)}`,
    );
  }

  return {
    lines,
    invoices,
    client: { ...client, name: client.name },
    to,
    currency,
    totals: {
      charges: { units: charges, currency },
      credits: { units: credits, currency },
      payout: { units: charges + credits, currency },
      statedBalance,
    },
    warnings,
  };
}

/** Convenience: everything the host owes, as a positive figure. */
export function payoutOwed(r: ClientStatementResult): Money {
  return r.totals.payout.units < 0n
    ? { units: -r.totals.payout.units, currency: r.currency }
    : zero(r.currency);
}
