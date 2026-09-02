/**
 * Rule matching.
 *
 * Two properties matter more than speed here:
 *
 *  1. Every condition test is recorded, pass or fail, so a result can explain
 *     itself against the contract clause it came from.
 *  2. A tie is never broken by chance. Priority, then specificity, then the
 *     engine refuses and asks a human. A wrong confident number costs more
 *     than a queued one.
 */

import type {
  ConditionTrace,
  Coupon,
  DateWindow,
  RejectedRule,
  Rule,
  RuleMatch,
  StringCondition,
  TicketDocument,
} from "./types.js";
import { type GeoContext, journeyDestination, journeyOrigin, matchMarket } from "./geo.js";

export interface MatchContext {
  readonly geo: GeoContext;
  /** Outcome of the carrier layer, for layer-2 `upstreamCommission` gating. */
  readonly upstreamCommissionIsNil?: boolean;
}

function normalise(c: string | StringCondition): StringCondition {
  return typeof c === "string" ? { in: [c] } : c;
}

function testString(
  field: string,
  value: string | null | undefined,
  raw: string | StringCondition,
): ConditionTrace {
  const cond = normalise(raw);
  const actual = value ?? "∅";
  const parts: string[] = [];
  let passed = true;

  if (cond.absent === true) {
    parts.push("absent");
    if (value != null && value !== "") passed = false;
  }
  if (cond.present === true) {
    parts.push("present");
    if (value == null || value === "") passed = false;
  }
  if (cond.in) {
    parts.push(`in [${cond.in.join(", ")}]`);
    if (value == null || !cond.in.some((v) => v.toUpperCase() === value.toUpperCase())) {
      passed = false;
    }
  }
  if (cond.notIn) {
    parts.push(`not in [${cond.notIn.join(", ")}]`);
    if (value != null && cond.notIn.some((v) => v.toUpperCase() === value.toUpperCase())) {
      passed = false;
    }
  }
  if (cond.matches) {
    parts.push(`matches /${cond.matches}/`);
    if (value == null || !new RegExp(cond.matches, "i").test(value)) passed = false;
  }
  if (cond.notMatches) {
    parts.push(`not matches /${cond.notMatches}/`);
    if (value != null && new RegExp(cond.notMatches, "i").test(value)) passed = false;
  }

  return { field, expected: parts.join(" and ") || "any", actual, passed };
}

function withinWindow(date: string, w: DateWindow | undefined): boolean {
  if (!w) return true;
  if (w.from && date < w.from) return false;
  if (w.to && date > w.to) return false;
  return true;
}

function describeWindow(w: DateWindow | undefined): string {
  if (!w) return "any";
  return `${w.from ?? "−∞"} … ${w.to ?? "+∞"}`;
}

/**
 * Test a rule's effective windows. Issue date and travel dates are separate
 * axes: a contract commonly covers tickets *sold* in one quarter for travel
 * across a whole year, and both have to hold.
 */
export function testEffective(rule: Rule, ticket: TicketDocument): ConditionTrace[] {
  const traces: ConditionTrace[] = [];
  const eff = rule.effective;
  if (!eff) return traces;

  if (eff.issuedBetween) {
    traces.push({
      field: "issueDate",
      expected: describeWindow(eff.issuedBetween),
      actual: ticket.issueDate,
      passed: withinWindow(ticket.issueDate, eff.issuedBetween),
    });
  }

  if (eff.travelBetween) {
    // Every travelled coupon must fall inside the window. A ticket that
    // straddles two contract periods is a genuine edge case and belongs in a
    // human's queue, not resolved by taking the first coupon and hoping.
    const dates = ticket.coupons.map((c) => c.departureDate).sort();
    const first = dates[0] ?? ticket.issueDate;
    const last = dates[dates.length - 1] ?? ticket.issueDate;
    const passed =
      withinWindow(first, eff.travelBetween) && withinWindow(last, eff.travelBetween);
    traces.push({
      field: "travelDates",
      expected: describeWindow(eff.travelBetween),
      actual: first === last ? first : `${first} … ${last}`,
      passed,
    });
  }

  return traces;
}

/** Coupon-level fields test against *every* coupon unless scope is per-coupon. */
function allCoupons(
  coupons: readonly Coupon[],
  pick: (c: Coupon) => string | null | undefined,
): string[] {
  return coupons.map((c) => pick(c) ?? "∅");
}

export interface RuleEvaluation {
  readonly rule: Rule;
  readonly matched: boolean;
  readonly traces: readonly ConditionTrace[];
  /** Number of declared conditions — the specificity tiebreaker. */
  readonly specificity: number;
  readonly unresolvedGeography: boolean;
}

/**
 * Evaluate one rule against one ticket, recording every condition it declared.
 * `coupon` narrows coupon-level tests to a single coupon for coupon-scoped rules.
 */
export function evaluateRule(
  rule: Rule,
  ticket: TicketDocument,
  ctx: MatchContext,
  coupon?: Coupon,
): RuleEvaluation {
  const m: RuleMatch = rule.match;
  const traces: ConditionTrace[] = [...testEffective(rule, ticket)];
  const coupons = coupon ? [coupon] : ticket.coupons;
  let unresolvedGeography = false;

  if (m.validatingCarrier !== undefined) {
    traces.push(testString("validatingCarrier", ticket.validatingCarrier, m.validatingCarrier));
  }
  if (m.posCountry !== undefined) {
    traces.push(testString("posCountry", ticket.posCountry, m.posCountry));
  }
  if (m.fareType !== undefined) {
    traces.push(testString("fareType", ticket.fareType, m.fareType));
  }
  if (m.paxType !== undefined) {
    traces.push(testString("paxType", ticket.paxType, m.paxType));
  }
  if (m.documentType !== undefined) {
    traces.push(testString("documentType", ticket.documentType, m.documentType));
  }
  if (m.tourCode !== undefined) {
    traces.push(testString("tourCode", ticket.tourCode ?? null, m.tourCode));
  }
  if (m.ticketDesignator !== undefined) {
    traces.push(
      testString("ticketDesignator", ticket.ticketDesignator ?? null, m.ticketDesignator),
    );
  }

  // Coupon-level conditions: every coupon in scope must satisfy them.
  if (m.rbd !== undefined) {
    const values = allCoupons(coupons, (c) => c.rbd);
    const results = coupons.map((c) => testString("rbd", c.rbd, m.rbd!));
    traces.push({
      field: "rbd",
      expected: results[0]?.expected ?? "any",
      actual: values.join(", "),
      passed: results.every((r) => r.passed),
    });
  }
  if (m.fareBasis !== undefined) {
    const values = allCoupons(coupons, (c) => c.fareBasis);
    const results = coupons.map((c) => testString("fareBasis", c.fareBasis, m.fareBasis!));
    traces.push({
      field: "fareBasis",
      expected: results[0]?.expected ?? "any",
      actual: values.join(", "),
      passed: results.every((r) => r.passed),
    });
  }
  if (m.marketingCarrier !== undefined) {
    const results = coupons.map((c) =>
      testString("marketingCarrier", c.marketingCarrier, m.marketingCarrier!),
    );
    traces.push({
      field: "marketingCarrier",
      expected: results[0]?.expected ?? "any",
      actual: allCoupons(coupons, (c) => c.marketingCarrier).join(", "),
      passed: results.every((r) => r.passed),
    });
  }

  if (m.market !== undefined) {
    const origin = coupon ? coupon.origin : journeyOrigin(ticket.coupons);
    const dest = coupon ? coupon.destination : journeyDestination(ticket.coupons, ctx.geo);
    const r = matchMarket(origin, dest, m.market, ctx.geo);
    if (r.unresolved) unresolvedGeography = true;
    traces.push({
      field: "market",
      expected: `${m.market.from} ↔ ${m.market.to}`.replace(
        "↔",
        m.market.direction === "outbound" ? "→" : "↔",
      ),
      actual: r.describe,
      passed: r.matched,
    });
  }

  if (m.upstreamCommission !== undefined && m.upstreamCommission !== "any") {
    const isNil = ctx.upstreamCommissionIsNil === true;
    const want = m.upstreamCommission;
    traces.push({
      field: "upstreamCommission",
      expected: want,
      actual: isNil ? "nil" : "nonzero",
      passed: want === "nil" ? isNil : !isNil,
    });
  }

  return {
    rule,
    matched: traces.every((t) => t.passed),
    traces,
    specificity: countConditions(m) + countWindows(rule),
    unresolvedGeography,
  };
}

function countConditions(m: RuleMatch): number {
  return Object.values(m).filter((v) => v !== undefined).length;
}

function countWindows(rule: Rule): number {
  const e = rule.effective;
  if (!e) return 0;
  return (e.issuedBetween ? 1 : 0) + (e.travelBetween ? 1 : 0);
}

export type SelectionResult =
  | { readonly kind: "matched"; readonly evaluation: RuleEvaluation; readonly rejected: RejectedRule[] }
  | { readonly kind: "none"; readonly rejected: RejectedRule[] }
  | { readonly kind: "ambiguous"; readonly candidates: RuleEvaluation[]; readonly rejected: RejectedRule[] }
  | { readonly kind: "incomplete"; readonly evaluation: RuleEvaluation; readonly rejected: RejectedRule[] };

/**
 * Pick the winning rule from a candidate set.
 *
 * Order: highest priority, then most conditions declared (the more specific
 * clause wins), then — deliberately — nothing. Two rules that are equally
 * specific and equally prioritised describe the same ticket two ways, and
 * only the contract owner can say which was meant.
 */
export function selectRule(
  rules: readonly Rule[],
  ticket: TicketDocument,
  ctx: MatchContext,
  coupon?: Coupon,
): SelectionResult {
  const rejected: RejectedRule[] = [];
  const matches: RuleEvaluation[] = [];

  for (const rule of rules) {
    if (rule.approved === false) {
      rejected.push({
        ruleId: rule.id,
        version: rule.version,
        reason: "rule is not approved and cannot fire",
      });
      continue;
    }
    const evaluation = evaluateRule(rule, ticket, ctx, coupon);
    if (evaluation.matched) {
      matches.push(evaluation);
    } else {
      const failed = evaluation.traces.find((t) => !t.passed);
      rejected.push({
        ruleId: rule.id,
        version: rule.version,
        reason: failed ? `${failed.field} did not match` : "no condition matched",
        failedOn: failed,
      });
    }
  }

  if (matches.length === 0) return { kind: "none", rejected };

  matches.sort((a, b) =>
    b.rule.priority !== a.rule.priority
      ? b.rule.priority - a.rule.priority
      : b.specificity - a.specificity,
  );

  const best = matches[0];
  const tied = matches.filter(
    (m) => m.rule.priority === best.rule.priority && m.specificity === best.specificity,
  );
  if (tied.length > 1) return { kind: "ambiguous", candidates: tied, rejected };

  if (best.unresolvedGeography) return { kind: "incomplete", evaluation: best, rejected };
  return { kind: "matched", evaluation: best, rejected };
}
