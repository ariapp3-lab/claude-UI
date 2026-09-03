/**
 * A consolidator's weekly statement → lines that can be matched against tickets.
 *
 * Statements arrive as spreadsheets, and no two consolidators shape one the
 * same way. Rather than encode a format, this reads any delimited file: it
 * finds the header row, maps the columns it recognises, and reports the ones it
 * did not. A column it cannot place is carried through in `raw` and named in
 * the warnings — never dropped, and never guessed at.
 *
 * Amounts are parsed the way accounting software writes them: "1,234.56",
 * "$104.72", "(35.00)" for a negative, a bare "-".
 */

import { parseMoney, type Money } from "@commission/engine";

export interface StatementLine {
  /** Normalised to "114-7503646565" wherever the source gives enough digits. */
  readonly ticketNumber: string;
  readonly documentType?: string;
  readonly issueDate?: string;
  /** Commission the statement says was earned before deductions. */
  readonly gross?: Money | null;
  /** Fees and deductions the statement applied, as a positive amount. */
  readonly fees?: Money | null;
  /** What the consolidator is actually paying on this line. */
  readonly net?: Money | null;
  readonly description?: string;
  readonly raw: Readonly<Record<string, string>>;
  /** 1-based row in the source file, for pointing a human at it. */
  readonly row: number;
}

export interface StatementParseResult {
  readonly lines: readonly StatementLine[];
  /** Column heading → the field it was read as. */
  readonly mapping: Readonly<Record<string, string>>;
  readonly unmapped: readonly string[];
  readonly currency: string;
  readonly warnings: readonly string[];
  readonly totals: { readonly gross: Money; readonly fees: Money; readonly net: Money };
}

/** Header synonyms, longest and most specific first so "net" beats "amount". */
const FIELD_PATTERNS: [keyof StatementLine, RegExp][] = [
  ["ticketNumber", /^(ticket|tkt|document|doc|tn)[\s_-]*(number|no|nbr|#)?$/i],
  ["ticketNumber", /^(ticket|tkt|document)$/i],
  ["net", /^(net|amount\s*(due|payable)|payable|to\s*agent|agent\s*net|due\s*agent)/i],
  ["fees", /^(fee|fees|deduction|deductions|charge|charges|withheld)/i],
  ["gross", /^(gross|commission|comm|comm\.?\s*amount|earned|comm\s*due)/i],
  ["documentType", /^(type|doc\s*type|transaction|trans\s*type)/i],
  ["issueDate", /^(issue|issued|date|sale\s*date|trans(action)?\s*date)/i],
  ["description", /^(description|detail|remarks?|notes?|memo)/i],
];

function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function detectDelimiter(sample: string): string {
  const counts = [",", "\t", ";", "|"].map((d) => ({
    d, n: (sample.match(new RegExp(`\\${d}`, "g")) ?? []).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/**
 * Accounting notation, not arithmetic notation. Parentheses mean negative, the
 * currency symbol and grouping are noise, and an em dash or a blank means zero
 * was not stated rather than zero was.
 */
export function parseStatementAmount(v: string, currency: string): Money | null {
  const t = v.trim();
  if (t === "" || t === "-" || t === "—" || t === "–" || /^n\/?a$/i.test(t)) return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const digits = t.replace(/[()\-\s]/g, "").replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (digits === "" || !/^\d*\.?\d*$/.test(digits)) return null;
  const m = parseMoney(digits === "" ? "0" : digits, currency);
  return negative ? { units: -m.units, currency: m.currency } : m;
}

/** "1147503646565", "114 7503646565", "1147503646565 " → "114-7503646565". */
export function normaliseTicketNumber(v: string): string {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 13) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10) return digits;
  return v.trim();
}

export function parseStatementCsv(
  text: string,
  opts: { currency?: string; mapping?: Record<string, string> } = {},
): StatementParseResult {
  const currency = opts.currency ?? "USD";
  const warnings: string[] = [];
  const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rows.length === 0) {
    return {
      lines: [], mapping: {}, unmapped: [], currency,
      warnings: ["the file is empty"],
      totals: { gross: parseMoney("0", currency), fees: parseMoney("0", currency), net: parseMoney("0", currency) },
    };
  }

  const delimiter = detectDelimiter(rows.slice(0, 5).join("\n"));

  // Statements often open with a title and an address block. The header is the
  // first row that names something we recognise as a ticket column.
  let headerIndex = rows.findIndex((r) =>
    splitRow(r, delimiter).some((c) => FIELD_PATTERNS.some(([f, re]) => f === "ticketNumber" && re.test(c))));
  if (headerIndex < 0) {
    headerIndex = 0;
    warnings.push(
      "no column naming a ticket number was found; the first row was taken as the header",
    );
  } else if (headerIndex > 0) {
    warnings.push(`${headerIndex} row(s) above the header were skipped`);
  }

  const headers = splitRow(rows[headerIndex], delimiter);
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  const taken = new Set<string>();

  for (const h of headers) {
    if (h === "") continue;
    const override = opts.mapping?.[h];
    if (override) { mapping[h] = override; taken.add(override); continue; }
    const hit = FIELD_PATTERNS.find(([field, re]) => !taken.has(field) && re.test(h));
    if (hit) { mapping[h] = hit[0]; taken.add(hit[0]); }
    else unmapped.push(h);
  }

  if (!taken.has("ticketNumber")) warnings.push("no ticket-number column could be identified");
  if (!taken.has("net") && !taken.has("gross")) {
    warnings.push("no commission or net-payable column could be identified");
  }
  if (unmapped.length > 0) {
    warnings.push(`columns carried through but not interpreted: ${unmapped.join(", ")}`);
  }

  const lines: StatementLine[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = splitRow(rows[i], delimiter);
    const raw: Record<string, string> = {};
    headers.forEach((h, k) => { if (h) raw[h] = cells[k] ?? ""; });

    const get = (field: string) => {
      const h = Object.keys(mapping).find((k) => mapping[k] === field);
      return h ? (raw[h] ?? "") : "";
    };

    const ticketRaw = get("ticketNumber");
    if (!/\d/.test(ticketRaw)) continue;   // totals rows, blank rows, footers

    lines.push({
      ticketNumber: normaliseTicketNumber(ticketRaw),
      documentType: get("documentType") || undefined,
      issueDate: get("issueDate") || undefined,
      gross: parseStatementAmount(get("gross"), currency),
      fees: parseStatementAmount(get("fees"), currency),
      net: parseStatementAmount(get("net"), currency),
      description: get("description") || undefined,
      raw,
      row: i + 1,
    });
  }

  if (lines.length === 0) warnings.push("no rows carrying a ticket number were found");

  const sumOf = (pick: (l: StatementLine) => Money | null | undefined) => ({
    units: lines.reduce((a, l) => a + (pick(l)?.units ?? 0n), 0n),
    currency,
  });

  return {
    lines,
    mapping,
    unmapped,
    currency,
    warnings,
    totals: { gross: sumOf((l) => l.gross), fees: sumOf((l) => l.fees), net: sumOf((l) => l.net) },
  };
}
