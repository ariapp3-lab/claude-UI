/**
 * Rendering a batch result for a terminal.
 *
 * Kept apart from the arithmetic so the same result can be printed, exported or
 * served without either half knowing about the other.
 */

import { formatMoney, type Money } from "@commission/engine";
import type { BatchResult, Finding, Severity } from "./reconcile.js";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", amber: "\x1b[33m", green: "\x1b[32m", blue: "\x1b[34m",
};

export interface ReportOptions {
  readonly colour?: boolean;
  readonly width?: number;
  /** Show every document, not only the ones needing attention. */
  readonly all?: boolean;
}

const SEV_COLOUR: Record<Severity, keyof typeof C> = {
  critical: "red", warning: "amber", ok: "green",
};

export function renderReport(result: BatchResult, opts: ReportOptions = {}): string {
  const colour = opts.colour ?? false;
  const c = (name: keyof typeof C, s: string) => (colour ? C[name] + s + C.reset : s);
  const money = (m: Money) => formatMoney(m);
  const out: string[] = [];

  const rule = (ch = "─") => ch.repeat(96);

  out.push("");
  out.push(c("bold", "COMMISSION RECONCILIATION"));
  out.push(rule("═"));

  const t = result.totals;
  const line = (k: string, v: string, note = "", tone?: keyof typeof C) =>
    `  ${k.padEnd(30)}${(tone ? c(tone, v) : v).padStart(colour && tone ? 22 : 14)}` +
    (note ? `   ${c("dim", note)}` : "");

  out.push(line("Documents priced", String(t.documents)));
  out.push(line("Fare value", money(t.fareValue), "USD, base fare"));
  out.push(line("Commission claimed", money(t.claimed)));
  out.push(line("Commission entitled", money(t.entitled)));
  out.push("");
  if (t.forfeited.units > 0n) {
    out.push(line("Forfeited to an exclusion", money(t.forfeited), "recoverable if corrected before filing", "red"));
  }
  if (t.overclaimed.units > 0n) {
    out.push(line("Claimed without entitlement", money(t.overclaimed), "debit-memo exposure", "red"));
  }
  if (t.unclaimed.units > 0n) {
    out.push(line("Due and unclaimed", money(t.unclaimed), "claim before the window closes", "red"));
  }
  if (t.clawback.units < 0n) {
    out.push(line("Owed back on reissues", money(t.clawback), "the replaced ticket earned more", "red"));
  }
  if (t.markup.units > 0n) {
    out.push(line("Net-fare markup", money(t.markup), "revenue, not commission", "green"));
  }
  if (t.noRevenue > 0) {
    out.push(line("Earned nothing at all", String(t.noRevenue),
      "bulk fares sold at cost, no markup", "amber"));
  }

  out.push("");
  out.push(c("dim", "  " + [...result.byReason.entries()]
    .map(([r, n]) => `${r} ${n}`).join("   ")));

  const shown = opts.all
    ? result.findings
    : result.findings.filter((x) => x.severity !== "ok");

  if (shown.length > 0) {
    out.push("");
    out.push(c("bold", shown.length === result.findings.length
      ? "EVERY DOCUMENT"
      : `NEEDS ATTENTION — ${shown.length} of ${result.findings.length}`));
    out.push(rule());
    out.push(c("dim", [
      "ticket".padEnd(16), "doc".padEnd(5), "cls".padEnd(5),
      "fare type".padEnd(11), "claimed".padStart(10),
      "entitled".padStart(10), "at stake".padStart(10), "  finding",
    ].join("")));
    out.push(rule());
    for (const x of shown) out.push(renderRow(x, c));
  }

  if (result.warnings.length > 0) {
    out.push("");
    out.push(c("bold", "PARSE NOTES"));
    out.push(rule());
    for (const w of result.warnings) out.push(`  ${c("dim", "·")} ${w}`);
  }

  out.push("");
  return out.join("\n");
}

function renderRow(x: Finding, c: (n: keyof typeof C, s: string) => string): string {
  const stake = x.recoverable ?? x.variance;
  const tone = SEV_COLOUR[x.severity];
  const cells = [
    x.ticketNumber.padEnd(16),
    x.documentType.padEnd(5),
    x.classes.padEnd(5),
    x.fareType.padEnd(11),
    formatMoney(x.claimed).padStart(10),
    formatMoney(x.entitled).padStart(10),
    formatMoney(stake).padStart(10),
  ].join("");
  return `${cells}  ${c(tone, x.reason)}\n` +
    `${" ".repeat(16)}${c("dim", `${x.route} · ${x.issueDate} · ${x.explanation}`)}`;
}

/** Flat rows for a spreadsheet. One line per document, no nesting. */
export function toCsv(result: BatchResult): string {
  const head = [
    "ticket_number", "document_type", "issue_date", "route", "booking_classes",
    "fare_type", "base_fare", "claimed", "entitled", "variance", "recoverable",
    "reason", "severity", "rule_id", "clause", "explanation",
  ];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = result.findings.map((x) =>
    [
      x.ticketNumber, x.documentType, x.issueDate, x.route, x.classes,
      x.fareType, formatMoney(x.baseFare), formatMoney(x.claimed),
      formatMoney(x.entitled), formatMoney(x.variance),
      x.recoverable ? formatMoney(x.recoverable) : "",
      x.reason, x.severity, x.ruleId ?? "", x.clause ?? "", x.explanation,
    ].map((v) => esc(String(v))).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** The whole result as JSON, with money rendered as decimal strings. */
export function toJson(result: BatchResult): string {
  return JSON.stringify(
    {
      // Totals are a mix now: amounts, counts and a currency code. Formatting
      // by type rather than by assumption keeps a string out of formatMoney.
      totals: Object.fromEntries(
        Object.entries(result.totals).map(([k, v]) => [
          k,
          typeof v === "number" || typeof v === "string" ? v : formatMoney(v as Money),
        ]),
      ),
      currencies: result.currencies,
      byReason: Object.fromEntries(result.byReason),
      findings: result.findings.map((x) => ({
        ticketNumber: x.ticketNumber, documentType: x.documentType,
        issueDate: x.issueDate, route: x.route, classes: x.classes,
        fareType: x.fareType, reason: x.reason, severity: x.severity,
        ruleId: x.ruleId, clause: x.clause,
        baseFare: formatMoney(x.baseFare), claimed: formatMoney(x.claimed),
        entitled: formatMoney(x.entitled), variance: formatMoney(x.variance),
        recoverable: x.recoverable ? formatMoney(x.recoverable) : null,
        explanation: x.explanation,
      })),
      warnings: result.warnings,
    },
    null, 2,
  ) + "\n";
}
