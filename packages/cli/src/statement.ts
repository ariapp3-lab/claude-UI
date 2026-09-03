/**
 * Settling a consolidator's weekly statement against what the tickets earned.
 *
 * Two lists meet here: what the engine says each document is worth, and what
 * the consolidator says they are paying for it. The job is not to reconcile
 * them into one number — it is to say precisely where they disagree, and to be
 * honest about the part that cannot be checked.
 *
 * That part is fees. Without the sub-agent agreement's fee schedule there is no
 * way to know whether a deduction is contractual. So the share is verified and
 * the deductions are surfaced, separately, rather than folded into one variance
 * that hides which half is in question.
 */

import {
  DEFAULT_GEO, formatMoney, isZero, journeyDestination, subtract, zero,
  type Money, type Rule, type TicketDocument, type Waterfall,
} from "@commission/engine";
import { calculate } from "@commission/engine";
import type { StatementLine } from "@commission/parsers";

export type SettlementReason =
  | "AGREES"              // paid what the contract gives
  | "SHORT_PAID"          // paid less
  | "OVER_PAID"           // paid more
  | "NOT_ON_STATEMENT"    // earned, and the statement does not list it
  | "NOT_IN_TICKETS"      // paid for a document we hold no ticket for
  | "PAID_WHERE_NONE_DUE" // paid on a document the contract gives nothing for
  | "CORRECTLY_NIL"       // both sides agree there is nothing
  | "DEDUCTION";          // a fee was withheld that no supplied agreement covers

export type Severity = "critical" | "warning" | "ok";

const SEVERITY: Record<SettlementReason, Severity> = {
  SHORT_PAID: "critical", NOT_ON_STATEMENT: "critical", NOT_IN_TICKETS: "warning",
  OVER_PAID: "warning", PAID_WHERE_NONE_DUE: "warning", DEDUCTION: "warning",
  AGREES: "ok", CORRECTLY_NIL: "ok",
};

export interface SettlementRow {
  readonly ticketNumber: string;
  readonly route: string | null;
  readonly classes: string | null;
  readonly reason: SettlementReason;
  readonly severity: Severity;
  /** What the contract gives this sub-agent, before any fee. */
  readonly expected: Money;
  /** What the statement says was earned, before its own deductions. */
  readonly statedGross: Money | null;
  readonly statedFees: Money | null;
  readonly statedNet: Money | null;
  /** statedGross (or net, where no gross is given) less expected. */
  readonly variance: Money;
  readonly explanation: string;
  readonly statementRow: number | null;
}

export interface SettlementTotals {
  readonly rows: number;
  readonly expected: Money;
  readonly statedGross: Money;
  readonly statedFees: Money;
  readonly statedNet: Money;
  readonly shortPaid: Money;
  readonly overPaid: Money;
  readonly missing: Money;
  readonly unexplainedDeductions: Money;
}

export interface Settlement {
  readonly rows: readonly SettlementRow[];
  readonly totals: SettlementTotals;
  readonly byReason: ReadonlyMap<SettlementReason, number>;
  readonly warnings: readonly string[];
}

export interface SettleInput {
  readonly tickets: readonly TicketDocument[];
  readonly statement: readonly StatementLine[];
  readonly rules: readonly Rule[];
  readonly subAgentId: string;
  readonly currency?: string;
  /** Fees the supplied agreement accounts for, so they are not flagged twice. */
  readonly explainedFees?: (line: StatementLine) => boolean;
}

/** Ticket numbers vary in punctuation between systems; compare on the digits. */
function key(ticketNumber: string): string {
  return ticketNumber.replace(/\D/g, "");
}

export function settle(input: SettleInput): Settlement {
  const counts = new Map<string, number>();
  for (const t of input.tickets) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  const currency =
    input.currency ??
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "USD";
  const warnings: string[] = [];
  const rows: SettlementRow[] = [];

  const byTicket = new Map<string, TicketDocument>();
  for (const t of input.tickets) {
    const k = key(t.ticketNumber);
    if (byTicket.has(k)) {
      warnings.push(`ticket ${t.ticketNumber} appears more than once in the documents`);
    }
    byTicket.set(k, t);
  }

  const byLine = new Map<string, StatementLine>();
  for (const l of input.statement) {
    const k = key(l.ticketNumber);
    if (byLine.has(k)) {
      warnings.push(`ticket ${l.ticketNumber} appears more than once on the statement`);
    }
    byLine.set(k, l);
  }

  const seen = new Set<string>();

  for (const [k, ticket] of byTicket) {
    seen.add(k);
    let w: Waterfall;
    try {
      w = calculate({ ticket, rules: input.rules, subAgentId: input.subAgentId });
    } catch (e) {
      warnings.push(`${ticket.ticketNumber} could not be priced: ${(e as Error).message}`);
      continue;
    }
    const expected = w.subAgent?.commission ?? zero(currency);
    const line = byLine.get(k);

    // Named by the turnaround: a round trip is JFK–TLV, not JFK–JFK.
    const route = ticket.coupons.length
      ? `${ticket.coupons[0].origin}–${journeyDestination(ticket.coupons, DEFAULT_GEO) ?? "?"}`
      : null;
    const classes = [...new Set(ticket.coupons.map((c) => c.rbd))].join("/") || null;

    if (!line) {
      const missing = isZero(expected);
      rows.push({
        ticketNumber: ticket.ticketNumber, route, classes,
        reason: missing ? "CORRECTLY_NIL" : "NOT_ON_STATEMENT",
        severity: missing ? "ok" : "critical",
        expected, statedGross: null, statedFees: null, statedNet: null,
        variance: missing ? zero(currency) : { units: -expected.units, currency },
        explanation: missing
          ? "nothing due, and the statement does not list it"
          : `${formatMoney(expected)} due and the statement does not list this ticket`,
        statementRow: null,
      });
      continue;
    }

    // A statement that gives only a net figure is compared on that; one that
    // separates gross from fees is compared on gross, so a deduction cannot
    // masquerade as a short payment.
    const comparable = line.gross ?? line.net ?? zero(currency);
    const variance = subtract(comparable, expected);
    const feeWithheld =
      line.fees && line.fees.units !== 0n
        ? { units: line.fees.units < 0n ? -line.fees.units : line.fees.units, currency }
        : line.gross && line.net
          ? subtract(line.gross, line.net)
          : null;

    let reason: SettlementReason;
    let explanation: string;

    if (isZero(expected) && comparable.units > 0n) {
      reason = "PAID_WHERE_NONE_DUE";
      explanation =
        `${formatMoney(comparable)} paid where the contract gives nothing` +
        (w.carrier.clause ? ` (${w.carrier.clause})` : "");
    } else if (isZero(expected) && isZero(comparable)) {
      reason = "CORRECTLY_NIL";
      explanation = "nothing due, and nothing paid";
    } else if (variance.units < 0n) {
      reason = "SHORT_PAID";
      explanation =
        `${formatMoney(comparable)} paid against ${formatMoney(expected)} due — ` +
        `${formatMoney({ units: -variance.units, currency })} short`;
    } else if (variance.units > 0n) {
      reason = "OVER_PAID";
      explanation = `${formatMoney(comparable)} paid against ${formatMoney(expected)} due`;
    } else if (feeWithheld && feeWithheld.units > 0n && !(input.explainedFees?.(line) ?? false)) {
      reason = "DEDUCTION";
      explanation =
        `the share is correct at ${formatMoney(expected)}, but ` +
        `${formatMoney(feeWithheld)} was withheld and no supplied agreement covers it`;
    } else {
      reason = "AGREES";
      explanation = "paid exactly what the contract gives";
    }

    rows.push({
      ticketNumber: ticket.ticketNumber, route, classes,
      reason, severity: SEVERITY[reason],
      expected,
      statedGross: line.gross ?? null,
      statedFees: line.fees ?? feeWithheld ?? null,
      statedNet: line.net ?? null,
      variance, explanation, statementRow: line.row,
    });
  }

  // Anything the consolidator paid for that we hold no document for. Not
  // necessarily an error — the ticket may sit in a file we were not given —
  // but it is money moving against something unverified, so it is surfaced.
  for (const [k, line] of byLine) {
    if (seen.has(k)) continue;
    const paid = line.net ?? line.gross ?? zero(currency);
    rows.push({
      ticketNumber: line.ticketNumber, route: null, classes: null,
      reason: "NOT_IN_TICKETS", severity: "warning",
      expected: zero(currency),
      statedGross: line.gross ?? null,
      statedFees: line.fees ?? null,
      statedNet: line.net ?? null,
      variance: paid,
      explanation:
        `${formatMoney(paid)} paid on a document not present in the batch — ` +
        "it cannot be checked against a contract",
      statementRow: line.row,
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, ok: 2 };
  const size = (r: SettlementRow) => (r.variance.units < 0n ? -r.variance.units : r.variance.units);
  rows.sort((a, b) => rank[a.severity] - rank[b.severity] || Number(size(b) - size(a)));

  // Amounts in another currency are left out of the totals rather than added
  // to them; a settlement that quietly mixes currencies is worse than one that
  // covers less.
  const sum = (pick: (r: SettlementRow) => Money | null) => ({
    units: rows.reduce((a, r) => {
      const m = pick(r);
      return a + (m && m.currency === currency ? m.units : 0n);
    }, 0n),
    currency,
  });

  const byReason = new Map<SettlementReason, number>();
  for (const r of rows) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

  return {
    rows, byReason, warnings,
    totals: {
      rows: rows.length,
      expected: sum((r) => r.expected),
      statedGross: sum((r) => r.statedGross),
      statedFees: sum((r) => r.statedFees),
      statedNet: sum((r) => r.statedNet),
      shortPaid: sum((r) => (r.reason === "SHORT_PAID" ? r.variance : null)),
      overPaid: sum((r) => (r.reason === "OVER_PAID" ? r.variance : null)),
      missing: sum((r) => (r.reason === "NOT_ON_STATEMENT" ? r.expected : null)),
      unexplainedDeductions: sum((r) => (r.reason === "DEDUCTION" ? r.statedFees : null)),
    },
  };
}
