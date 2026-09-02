/**
 * Rendering a waterfall as something a human can check against a contract.
 *
 * This is not a debugging convenience. §12 of the specification treats the
 * explanation as a test surface: if the person who does this by hand today
 * cannot read the output and verify it against the clause, the calculation is
 * not finished, whether or not the number happens to be right.
 */

import { formatMoney, isZero, isNegative } from "./money.js";
import type { Waterfall } from "./types.js";

function pad(label: string, value: string, width = 46): string {
  const dots = Math.max(1, width - label.length - value.length);
  return `${label}${" ".repeat(dots)}${value}`;
}

export function explain(w: Waterfall): string {
  const out: string[] = [];
  const cur = w.currency;

  out.push(`Ticket ${w.ticketNumber}   ${cur}`);
  out.push("─".repeat(46));

  const trace = w.carrier.basisTrace ?? [];
  if (trace.length > 0) {
    for (const t of trace) {
      const mark = t.included ? " " : "×";
      const label = t.component === "base_fare" ? "Base fare" : t.component;
      out.push(pad(`${mark} ${label}`, formatMoney(t.amount)));
    }
  } else {
    out.push(pad("  Base fare", formatMoney(w.baseFare)));
  }
  out.push(pad("  Ticket total", formatMoney(w.ticketTotal)));
  out.push("─".repeat(46));

  if (w.carrier.basis) {
    out.push(pad("  Commissionable basis", formatMoney(w.carrier.basis)));
  }

  const ruleRef = w.carrier.ruleId
    ? `${w.carrier.ruleId}${w.carrier.clause ? ` ${w.carrier.clause}` : ""}`
    : "—";

  switch (w.carrier.outcome) {
    case "CALCULATED":
    case "NIL":
      out.push(pad("  Carrier commission", formatMoney(w.carrier.commission)));
      break;
    default:
      out.push(pad(`  Carrier commission [${w.carrier.outcome}]`, "—"));
  }

  if (w.subAgent) {
    out.push(pad("  Sub-agent share", formatMoney(w.subAgent.commission)));
    out.push(pad("  Host spread", formatMoney(w.hostSpread)));
  }
  for (const fee of w.fees) {
    out.push(pad(`  ${fee.label}`, formatMoney(fee.amount)));
  }

  out.push("─".repeat(46));
  if (w.subAgent) {
    out.push(pad("  NET TO SUB-AGENT", formatMoney(w.netToSubAgent)));
  } else {
    out.push(pad("  NET TO HOST", formatMoney(w.hostSpread)));
  }

  out.push("");
  out.push(`Rule: ${ruleRef}`);
  if (w.subAgent?.ruleId) out.push(`Sub-agent rule: ${w.subAgent.ruleId}`);

  const excluded = trace.filter((t) => !t.included && !isZero(t.amount));
  if (excluded.length > 0) {
    out.push(
      `Excluded from basis: ${excluded
        .map((t) => `${t.component} ${formatMoney(t.amount)}`)
        .join(", ")}`,
    );
  }

  const notes = [...(w.carrier.notes ?? []), ...(w.subAgent?.notes ?? [])];
  for (const n of notes) out.push(`Note: ${n}`);
  for (const f of w.flags) out.push(`⚑ ${f.code}: ${f.message}`);

  out.push(`Engine ${w.engineVersion}`);
  return out.join("\n");
}

/** One-line summary for a reconciliation list. */
export function summarise(w: Waterfall): string {
  const amount = w.subAgent ? w.netToSubAgent : w.hostSpread;
  const sign = isNegative(amount) ? "" : "+";
  return `${w.ticketNumber}  ${w.carrier.outcome.padEnd(11)} ${sign}${formatMoney(amount)} ${w.currency}`;
}
