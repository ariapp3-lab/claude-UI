/**
 * Reconcile a batch of documents against a contract.
 *
 * Takes parsed tickets and the rules in force, and produces the queue a human
 * works through: what each document claimed, what the contract entitles, the
 * difference, and — where an exclusion bit — what that exclusion cost.
 *
 * Pure. No file system, no clock, no console. `main.ts` supplies the files and
 * prints the result, so this can be tested on fixtures and called from a server.
 */

import {
  DEFAULT_GEO, calculate, evaluateRule, journeyDestination, formatMoney, isZero,
  subtract, sum, zero,
  type Money, type Rule, type RuleMatch, type TicketDocument, type Waterfall,
} from "@commission/engine";

export type Reason =
  | "FORFEITED"      // entitled, but an exclusion clause bit
  | "CLAWBACK"       // a reissue nets negative: commission is owed back
  | "NOT_ENTITLED"   // claimed where the contract pays nothing
  | "OVERCLAIMED"    // claimed more than the contract allows
  | "UNDERCLAIMED"   // claimed less
  | "UNCLAIMED"      // entitled and claimed nothing
  | "MARKUP"         // net fare: revenue is markup, no commission due
  | "NO_REVENUE"     // net fare sold at cost: no commission, and no markup either
  | "AGREES"         // claim and contract match
  | "NO_RULE"
  | "AMBIGUOUS"
  | "INCOMPLETE";

export type Severity = "critical" | "warning" | "ok";

const SEVERITY: Record<Reason, Severity> = {
  FORFEITED: "critical", NOT_ENTITLED: "critical", OVERCLAIMED: "critical",
  UNCLAIMED: "critical", CLAWBACK: "critical", NO_RULE: "warning",
  AMBIGUOUS: "warning", INCOMPLETE: "warning", UNDERCLAIMED: "warning",
  NO_REVENUE: "warning", MARKUP: "ok", AGREES: "ok",
};

export interface Finding {
  readonly ticketNumber: string;
  readonly documentType: string;
  readonly route: string;
  readonly classes: string;
  readonly fareType: string;
  readonly issueDate: string;
  readonly reason: Reason;
  readonly severity: Severity;
  readonly clause: string | null;
  readonly ruleId: string | null;
  readonly baseFare: Money;
  readonly claimed: Money;
  readonly entitled: Money;
  /** claimed − entitled. Positive is an over-claim, negative a shortfall. */
  readonly variance: Money;
  /**
   * What the document would earn with the blocking exclusion lifted. Answers
   * "what is this clause costing us" without anyone re-keying the ticket.
   */
  readonly recoverable: Money | null;
  readonly explanation: string;
  /**
   * The document itself, not the calculation.
   *
   * A batch is thousands of documents and only the handful someone opens needs
   * a waterfall; retaining one per finding held tens of megabytes of condition
   * traces that nothing ever read. Recompute it on demand — it costs
   * microseconds — with `calculate({ ticket, rules })`.
   */
  readonly ticket: TicketDocument;
}

export interface BatchTotals {
  readonly documents: number;
  /** The currency these totals are expressed in. */
  readonly currency: string;
  /** Documents counted in these totals; fewer than `documents` on a mixed batch. */
  readonly counted: number;
  readonly fareValue: Money;
  readonly claimed: Money;
  readonly entitled: Money;
  readonly forfeited: Money;
  readonly overclaimed: Money;
  readonly unclaimed: Money;
  readonly clawback: Money;
  readonly markup: Money;
  /** Documents that earned nothing at all — neither commission nor markup. */
  readonly noRevenue: number;
}

export interface CurrencyCount {
  readonly code: string;
  readonly documents: number;
}

export interface BatchResult {
  readonly findings: readonly Finding[];
  /** Totals are in `totals.currency` — see `currencies`. */
  readonly totals: BatchTotals;
  /**
   * Every currency present, most documents first. A batch can mix them, and
   * amounts in different currencies cannot be added: the totals cover the
   * first of these and the rest are listed so nothing is silently omitted.
   */
  readonly currencies: readonly CurrencyCount[];
  readonly byReason: ReadonlyMap<Reason, number>;
  readonly warnings: readonly string[];
}

export interface ReconcileInput {
  readonly ticket: TicketDocument;
  /** Commission the source document records, when it states one. */
  readonly claimed: Money | null;
  /** Selling less net on a net fare. */
  readonly markup?: Money | null;
}

/** Trace field names that come from the effective-date windows, not `match`. */
const DATE_FIELDS = new Set(["issueDate", "travelDates"]);

export interface Recovery {
  readonly amount: Money;
  /** Exclusion clauses that had to be set aside. */
  readonly liftedRules: readonly string[];
  /** Conditions on the paying clause that had to be waived. */
  readonly waivedConditions: readonly string[];
  readonly ruleId: string | null;
}

/**
 * What the document would have earned had it complied.
 *
 * Two things stand between a document and its commission, and both have to be
 * set aside to see the number: an exclusion clause that wins outright (a
 * missing tour code asserts nil), and the paying clause's own conditions, which
 * usually fail for the same reason. Lifting only the exclusion is not enough —
 * the tour-code condition still sits on the clause that pays.
 *
 * So: drop winning nil clauses, then find the paying clause that comes closest,
 * waive the few conditions it failed on, and price it. Every waiver is named in
 * the result. The cap matters — waive enough conditions and any document can be
 * made to look entitled, which would be a lie dressed as a finding.
 */
export function recoverableValue(
  ticket: TicketDocument,
  rules: readonly Rule[],
  maxWaive = 2,
): Recovery {
  let pool = [...rules];
  const liftedRules: string[] = [];

  // 1 — set aside exclusion clauses that win outright.
  for (let i = 0; i < 4; i++) {
    const w = calculate({ ticket, rules: pool });
    if (w.carrier.outcome !== "NIL" || !w.carrier.ruleId) break;
    const winner = pool.find((r) => r.id === w.carrier.ruleId);
    if (!winner || winner.award.kind !== "nil") break;
    liftedRules.push(winner.id);
    pool = pool.filter((r) => r.id !== winner.id);
  }

  const afterLift = calculate({ ticket, rules: pool });
  if (!isZero(afterLift.carrier.commission)) {
    return {
      amount: afterLift.carrier.commission,
      liftedRules, waivedConditions: [],
      ruleId: afterLift.carrier.ruleId ?? null,
    };
  }

  // 2 — find the paying clause that comes closest, and see what it failed on.
  const ctx = { geo: DEFAULT_GEO };
  const candidates = pool
    .filter((r) => r.layer === "carrier_to_host" && r.award.kind !== "nil")
    .map((rule) => {
      const ev = evaluateRule(rule, ticket, ctx);
      return { rule, failed: ev.traces.filter((t) => !t.passed).map((t) => t.field) };
    })
    .filter((x) => x.failed.length > 0 && x.failed.length <= maxWaive)
    .sort((a, b) => a.failed.length - b.failed.length || b.rule.priority - a.rule.priority);

  const best = candidates[0];
  if (!best) return { amount: zero(ticket.currency), liftedRules, waivedConditions: [], ruleId: null };

  const match: Record<string, unknown> = { ...(best.rule.match as Record<string, unknown>) };
  let effective = best.rule.effective;
  for (const field of best.failed) {
    if (DATE_FIELDS.has(field)) effective = undefined;
    else delete match[field];
  }
  const relaxed: Rule = { ...best.rule, match: match as RuleMatch, effective };

  const w = calculate({ ticket, rules: [relaxed] });
  return {
    amount: w.carrier.commission,
    liftedRules,
    waivedConditions: best.failed,
    ruleId: best.rule.id,
  };
}

function classify(
  w: Waterfall,
  claimed: Money,
  recovery: Recovery | null,
  markup: Money | null,
  bulk: boolean,
): { reason: Reason; explanation: string } {
  const recoverable = recovery?.amount ?? zero(claimed.currency);
  const entitled = w.carrier.commission;
  const outcome = w.carrier.outcome;
  const clause = w.carrier.clause ? ` (${w.carrier.clause})` : "";

  if (outcome === "NO_RULE") {
    return { reason: "NO_RULE", explanation: "no clause in the contract covers this document" };
  }
  if (outcome === "AMBIGUOUS") {
    return { reason: "AMBIGUOUS", explanation: w.carrier.notes?.[0] ?? "two clauses match equally" };
  }
  if (outcome === "INCOMPLETE") {
    return { reason: "INCOMPLETE", explanation: w.carrier.notes?.[0] ?? "the document is missing something the clause needs" };
  }

  if (isZero(entitled) && bulk) {
    const would = recoverable.units > 0n
      ? ` It would earn ${formatMoney(recoverable)} as a published fare carrying the tour code.`
      : "";
    if (markup && markup.units > 0n) {
      // No clause citation and no counterfactual: this document is on a
      // different revenue model, not failing on the commission one.
      return {
        reason: "MARKUP",
        explanation: `revenue is markup of ${formatMoney(markup)}, not commission`,
      };
    }
    return {
      reason: "NO_REVENUE",
      explanation:
        `sold on a bulk fare at cost — no commission and no markup, so this document ` +
        `earned the agency nothing.${would}`,
    };
  }
  if (entitled.units < 0n) {
    return {
      reason: "CLAWBACK",
      explanation:
        `${formatMoney(w.carrier.priorCommission ?? entitled)} was taken on the ticket this ` +
        `reissue replaces, and the reissue earns ${formatMoney(w.carrier.gross ?? zero(claimed.currency))}${clause}`,
    };
  }
  if (isZero(entitled) && recoverable.units > 0n && recovery) {
    const blockers = (recovery.waivedConditions.length > 0
      ? recovery.waivedConditions
      : recovery.liftedRules.map((r) => r.replace(/^.*20\d\d-/, ""))
    ).join(" and ");
    return {
      reason: "FORFEITED",
      explanation: `${formatMoney(recoverable)} forfeited${clause} — blocked only by ${blockers}`,
    };
  }
  if (isZero(entitled) && claimed.units > 0n) {
    return {
      reason: "NOT_ENTITLED",
      explanation: `${formatMoney(claimed)} claimed where the contract pays nothing${clause}`,
    };
  }
  if (entitled.units > 0n && isZero(claimed)) {
    return {
      reason: "UNCLAIMED",
      explanation: `${formatMoney(entitled)} due and nothing claimed`,
    };
  }
  if (claimed.units > entitled.units) {
    return {
      reason: "OVERCLAIMED",
      explanation:
        `${formatMoney(claimed)} claimed against ${formatMoney(entitled)} entitled`,
    };
  }
  if (claimed.units < entitled.units) {
    return {
      reason: "UNDERCLAIMED",
      explanation:
        `${formatMoney(claimed)} claimed against ${formatMoney(entitled)} entitled`,
    };
  }
  return { reason: "AGREES", explanation: "the claim matches the contract" };
}

/** The counterfactual explores relaxed rules; it must not be able to throw. */
function safeRecoverable(ticket: TicketDocument, rules: readonly Rule[]): Recovery | null {
  try {
    return recoverableValue(ticket, rules);
  } catch {
    return null;
  }
}

export function reconcile(
  inputs: readonly ReconcileInput[],
  rules: readonly Rule[],
  warnings: readonly string[] = [],
): BatchResult {
  // The batch's own currency, taken from the documents rather than assumed.
  // A folder can hold EUR and USD side by side, and adding them is not a
  // rounding question — it is arithmetic that has no answer.
  const counts = new Map<string, number>();
  for (const i of inputs) {
    counts.set(i.ticket.currency, (counts.get(i.ticket.currency) ?? 0) + 1);
  }
  const currencies: CurrencyCount[] = [...counts.entries()]
    .map(([code, documents]) => ({ code, documents }))
    .sort((a, b) => b.documents - a.documents || a.code.localeCompare(b.code));
  const currency = currencies[0]?.code ?? "USD";

  const allWarnings = [...warnings];
  if (currencies.length > 1) {
    allWarnings.unshift(
      `this batch holds more than one currency (${currencies
        .map((c) => `${c.code} ${c.documents}`)
        .join(", ")}); the totals cover ${currency} only`,
    );
  }

  const findings: Finding[] = [];

  for (const { ticket, claimed: rawClaimed, markup } of inputs) {
    // A batch is thousands of documents from a live feed, and one of them
    // failing is not a reason to lose the other four thousand. The failure is
    // reported as a finding against the document that caused it.
    let w: Waterfall;
    try {
      w = calculate({ ticket, rules });
    } catch (e) {
      findings.push({
        ticketNumber: ticket.ticketNumber,
        documentType: ticket.documentType,
        route: "?", classes: "?",
        fareType: ticket.bulk ? "net (BT)" : ticket.fareType,
        issueDate: ticket.issueDate,
        reason: "INCOMPLETE", severity: "warning",
        clause: null, ruleId: null,
        baseFare: ticket.baseFare,
        claimed: rawClaimed ?? zero(ticket.currency),
        entitled: zero(ticket.currency),
        variance: zero(ticket.currency),
        recoverable: null,
        explanation: `this document could not be priced: ${(e as Error).message}`,
        ticket,
      });
      continue;
    }
    const claimed = rawClaimed ?? zero(ticket.currency);
    const entitled = w.carrier.commission;

    const rec = isZero(entitled) ? safeRecoverable(ticket, rules) : null;
    const recoverable =
      rec && rec.amount.units > 0n &&
      (rec.liftedRules.length > 0 || rec.waivedConditions.length > 0)
        ? rec.amount
        : null;

    const { reason, explanation } = classify(w, claimed, rec, markup ?? null, ticket.bulk === true);

    // A document that needs no action carries no amount at stake.
    const atStake = reason === "MARKUP" || reason === "AGREES" ? null : recoverable;

    findings.push({
      ticketNumber: ticket.ticketNumber,
      documentType: ticket.documentType,
      route: ticket.coupons.length
        ? `${ticket.coupons[0].origin}–${journeyDestination(ticket.coupons, DEFAULT_GEO)}`
        : "?",
      classes: [...new Set(ticket.coupons.map((c) => c.rbd))].join("/") || "?",
      fareType: ticket.bulk ? "net (BT)" : ticket.fareType,
      issueDate: ticket.issueDate,
      reason,
      severity: SEVERITY[reason],
      clause: w.carrier.clause ?? null,
      ruleId: w.carrier.ruleId ?? null,
      baseFare: ticket.baseFare,
      claimed,
      entitled,
      variance: subtract(claimed, entitled),
      recoverable: atStake,
      explanation,
      ticket,
    });
  }

  // Most consequential first: severity, then the size of the money at stake.
  const rank: Record<Severity, number> = { critical: 0, warning: 1, ok: 2 };
  const stake = (x: Finding) => {
    const v = x.variance.units < 0n ? -x.variance.units : x.variance.units;
    const r = x.recoverable ? (x.recoverable.units < 0n ? -x.recoverable.units : x.recoverable.units) : 0n;
    return v > r ? v : r;
  };
  const sorted = [...findings].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || Number(stake(b) - stake(a)),
  );

  // Only amounts already in the batch currency are summed; the rest are
  // counted in `currencies` and reported, never coerced.
  const pick = (p: (x: Finding) => Money | null) =>
    sum(
      sorted.map(p).filter((m): m is Money => m !== null && m.currency === currency),
      currency,
    );

  const byReason = new Map<Reason, number>();
  for (const x of sorted) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);

  return {
    findings: sorted,
    byReason,
    currencies,
    warnings: allWarnings,
    totals: {
      documents: sorted.length,
      currency,
      counted: sorted.filter((x) => x.baseFare.currency === currency).length,
      fareValue: pick((x) => x.baseFare),
      claimed: pick((x) => x.claimed),
      entitled: pick((x) => (x.entitled.units > 0n ? x.entitled : null)),
      forfeited: pick((x) => (x.reason === "FORFEITED" ? x.recoverable : null)),
      overclaimed: pick((x) =>
        x.reason === "NOT_ENTITLED" || x.reason === "OVERCLAIMED" ? x.claimed : null),
      unclaimed: pick((x) => (x.reason === "UNCLAIMED" ? x.entitled : null)),
      clawback: pick((x) => (x.reason === "CLAWBACK" ? x.entitled : null)),
      markup: pick((x) => (x.reason === "MARKUP" ? x.claimed : null)),
      noRevenue: sorted.filter((x) => x.reason === "NO_REVENUE").length,
    },
  };
}
