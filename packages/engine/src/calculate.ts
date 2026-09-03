/**
 * The calculation. Every dollar in the system originates here.
 *
 * Design rules this file obeys without exception:
 *
 *  - No floating point. Amounts are bigint minor units end to end.
 *  - No clock, no randomness, no I/O. Same inputs, same outputs, forever.
 *  - Nothing is inferred. A missing rule is NO_RULE, not zero. An unknown
 *    airport is INCOMPLETE, not a guess. A tie is AMBIGUOUS, not a coin flip.
 *  - The host spread is computed by *subtraction* from the carrier commission,
 *    so `subAgentShare + hostSpread === carrierCommission` holds by
 *    construction rather than by hoping two roundings agree.
 */

import {
  type Money,
  type RoundingMode,
  add,
  applyFraction,
  applyRate,
  allocate,
  formatMoney,
  isNegative,
  isZero,
  max as maxMoney,
  min as minMoney,
  negate,
  parseMoney,
  parseRate,
  subtract,
  sum,
  zero,
} from "./money.js";
import { DEFAULT_GEO, type GeoContext, splitHalves } from "./geo.js";
import { type MatchContext, selectRule } from "./match.js";
import type {
  Award,
  BasisComponent,
  BasisTrace,
  ConditionTrace,
  Coupon,
  RateTable,
  LayerResult,
  Rule,
  TicketDocument,
  Waterfall,
} from "./types.js";

export const ENGINE_VERSION = "0.1.0";

export interface CalculationOptions {
  readonly geo?: GeoContext;
  /** Rounding used where a rule does not state its own. */
  readonly defaultRounding?: RoundingMode;
}

// ---------------------------------------------------------------------------
// Basis
// ---------------------------------------------------------------------------

function componentCode(c: BasisComponent): string {
  if (typeof c === "string") return c === "base_fare" ? "base_fare" : c.toUpperCase();
  return c.tax.toUpperCase();
}

/**
 * Resolve the commissionable basis, and record *everything on the ticket*
 * with an included/excluded verdict — not just the included parts. Showing a
 * reader that YQ 386.00 was seen and deliberately excluded is the difference
 * between an answer and a claim.
 */
function resolveBasis(
  ticket: TicketDocument,
  components: readonly BasisComponent[],
  baseOverride?: Money,
): { basis: Money; trace: BasisTrace[] } {
  const wanted = new Set(components.map(componentCode));
  const trace: BasisTrace[] = [];
  const parts: Money[] = [];

  const base = baseOverride ?? ticket.baseFare;
  const baseIncluded = wanted.has("base_fare");
  trace.push({
    component: "base_fare",
    amount: base,
    included: baseIncluded,
    reason: baseIncluded ? undefined : "not named in the rule's basis",
  });
  if (baseIncluded) parts.push(base);

  for (const tax of ticket.taxes) {
    const code = tax.code.toUpperCase();
    const included = wanted.has(code);
    const carrierImposed = code === "YQ" || code === "YR";
    trace.push({
      component: code,
      amount: tax.amount,
      included,
      reason: included
        ? "named in the rule's basis"
        : carrierImposed
          ? "carrier-imposed surcharge, excluded by this contract"
          : "government tax or airport charge",
    });
    if (included) parts.push(tax.amount);
  }

  return { basis: sum(parts, ticket.currency), trace };
}

/**
 * Resolve the rate for a set of coupons from a booking-class table.
 *
 * A class the airline did not list is not a class it agreed to pay on, so an
 * unlisted RBD earns nil rather than falling through to some default. Mixed
 * classes inside one priced sector are genuinely undefined by the contract and
 * are reported, not averaged.
 */
function rateFromTable(
  table: RateTable,
  coupons: readonly Coupon[],
): { rate: string | null; note: string; ambiguous: boolean } {
  const classes = [...new Set(coupons.map((c) => c.rbd.toUpperCase()))];

  const unlisted = classes.filter((c) => table.rates[c] === undefined);
  if (unlisted.length > 0) {
    // `otherwise` governs this case and this case only: a class the airline
    // did not list. It has nothing to say about a sector booked in two.
    return {
      rate: null,
      ambiguous: table.otherwise === "ambiguous",
      note: `booking class ${unlisted.join("/") || "∅"} is not listed in the rate table`,
    };
  }

  const rates = [...new Set(classes.map((c) => table.rates[c]!))];
  if (rates.length > 1) {
    // Two classes at two different rates in one priced sector. The contract
    // says the rate follows "the RBD booked" and does not say which one that
    // is when there are two, so there is no answer to compute.
    return {
      rate: null,
      ambiguous: true,
      note:
        `sector mixes booking classes ${classes.join("/")} at ${rates.join("% / ")}% — ` +
        "the contract does not say which governs a mixed sector",
    };
  }

  // Several classes that happen to earn the same rate are not ambiguous.
  const rate = rates[0]!;
  return { rate, ambiguous: false, note: `${classes.join("/")} → ${rate}%` };
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

interface AwardResult {
  readonly commission: Money;
  readonly accrual?: Money;
  readonly basis?: Money;
  readonly basisTrace?: BasisTrace[];
  readonly notes: string[];
  readonly nil: boolean;
  /** The contract does not determine an answer here; a human must decide. */
  readonly ambiguous?: boolean;
  /** The rate actually used, once a table has been resolved. */
  readonly rateUsed?: string;
}

function applyAward(
  award: Award,
  ticket: TicketDocument,
  opts: Required<Pick<CalculationOptions, "defaultRounding">>,
  upstream?: Money,
  baseOverride?: Money,
  couponCount = 1,
  couponScope?: readonly Coupon[],
  upstreamBasis?: Money,
  upstreamGross?: Money,
): AwardResult {
  const currency = ticket.currency;
  const rounding = award.rounding?.mode ?? opts.defaultRounding;
  const notes: string[] = [];

  switch (award.kind) {
    case "nil":
      return {
        commission: zero(currency),
        notes: ["nil commission asserted by contract — not a missing rule"],
        nil: true,
      };

    case "percent": {
      const components = award.basis ?? ["base_fare"];
      const { basis, trace } = resolveBasis(ticket, components, baseOverride);

      let rate = award.rate;
      if (award.rateTable) {
        const scopeCoupons = couponScope ?? ticket.coupons;
        const r = rateFromTable(award.rateTable, scopeCoupons);
        notes.push(r.note);
        if (r.rate === null) {
          return {
            commission: zero(currency),
            basis,
            basisTrace: trace,
            notes,
            nil: true,
            ambiguous: r.ambiguous,
          };
        }
        rate = r.rate;
      }

      let commission = applyRate(basis, rate ?? "0", rounding);

      if (award.cap) {
        const cap = parseMoney(award.cap, award.currency ?? currency);
        const capped = minMoney(commission, cap);
        if (capped.units !== commission.units) {
          notes.push(`capped at ${formatMoney(cap)} ${cap.currency}`);
          commission = capped;
        }
      }
      if (award.floor) {
        const floor = parseMoney(award.floor, award.currency ?? currency);
        const floored = maxMoney(commission, floor);
        if (floored.units !== commission.units) {
          notes.push(`raised to floor ${formatMoney(floor)} ${floor.currency}`);
          commission = floored;
        }
      }
      return {
        commission, basis, basisTrace: trace, notes,
        nil: isZero(commission), rateUsed: rate,
      };
    }

    case "flat": {
      const per = award.per ?? "ticket";
      const one = parseMoney(award.amount ?? "0", award.currency ?? currency);
      const commission =
        per === "coupon" ? applyFraction(one, BigInt(couponCount), 1n) : one;
      if (per === "coupon") notes.push(`flat ${formatMoney(one)} × ${couponCount} coupons`);
      return { commission, notes, nil: isZero(commission) };
    }

    case "plb": {
      // Target-based override. It accrues per ticket but only becomes payable
      // when the period target is assessed, so it must never be added to a
      // per-ticket payable figure.
      const components = award.basis ?? ["base_fare"];
      const { basis, trace } = resolveBasis(ticket, components, baseOverride);
      const accrual = applyRate(basis, award.rate ?? "0", rounding);
      notes.push(
        "PLB accrual — not payable on this ticket; settles against the period target",
      );
      return {
        commission: zero(currency),
        accrual,
        basis,
        basisTrace: trace,
        notes,
        nil: true,
      };
    }

    case "share_of_upstream": {
      const up = upstream ?? zero(currency);
      if (isZero(up)) {
        return {
          commission: zero(currency),
          notes: [
            award.whenUpstreamNil === "fee_only"
              ? "carrier layer awarded nothing — fees only"
              : "carrier layer awarded nothing — no share to pass through",
          ],
          nil: true,
        };
      }
      const mode = award.mode ?? "points";

      if (mode === "residual") {
        // "The consolidator keeps one point." A point is a point OF THE FARE,
        // so the retention is taken on the commissionable basis rather than as
        // a fraction of the commission. That distinction matters twice: a
        // contract whose rate comes from a table has no single rate to divide
        // by, and a ticket priced per half round trip has two.
        if (!upstreamBasis) {
          return {
            commission: zero(currency),
            notes: ["the fare the carrier commissioned is unknown — cannot resolve a residual share"],
            nil: true,
          };
        }
        // A point of the fare — but of the fare THIS document earned on. A
        // reissue commissioned only on the fare difference must not surrender a
        // point of the whole new fare, and a refund reversing half the
        // commission gives back half the point. Scaling the retention by what
        // the document actually earned against what its fare would have earned
        // handles reissues, refunds and partial refunds with one rule.
        const retainedFull = applyRate(upstreamBasis, award.hostRetainsPoints ?? "0", rounding);
        const retained =
          upstreamGross && upstreamGross.units !== 0n && upstreamGross.units !== up.units
            ? applyFraction(retainedFull, up.units, upstreamGross.units, rounding)
            : retainedFull;

        if (up.units > 0n && retained.units >= up.units) {
          return {
            commission: zero(currency),
            notes: [
              `the host retains ${award.hostRetainsPoints} point(s) of the fare, ` +
                `${formatMoney(retained)}, which is the whole of the ` +
                `${formatMoney(up)} the carrier paid — nothing remains for the sub-agent`,
            ],
            nil: true,
          };
        }
        const commission = subtract(up, retained);
        notes.push(
          retained.units === retainedFull.units
            ? `the host retains ${award.hostRetainsPoints} point(s) of the ` +
                `${formatMoney(upstreamBasis)} fare, ${formatMoney(retained)}; ` +
                "the sub-agent takes the remainder"
            : `the host retains ${formatMoney(retained)} — ${award.hostRetainsPoints} ` +
                `point(s) of the fare, scaled to the ${formatMoney(up)} this document ` +
                `earned of the ${formatMoney(upstreamGross!)} its fare would carry`,
        );
        return { commission, notes, nil: isZero(commission) };
      }

      if (mode === "absolute") {
        const commission = parseMoney(award.amount ?? "0", award.currency ?? currency);
        notes.push("absolute override — independent of the carrier rate");
        return { commission, notes, nil: isZero(commission) };
      }
      if (mode === "fraction") {
        const n = parseRate(award.numerator ?? "0");
        const d = parseRate(award.denominator ?? "1");
        const commission = applyFraction(up, n, d, rounding);
        notes.push(`${award.numerator}/${award.denominator} of carrier commission`);
        return { commission, notes, nil: isZero(commission) };
      }
      // points: the sub-agent's points as a fraction of the carrier's points.
      // Derived from the rule that actually fired upstream, so a carrier rate
      // change flows through with no edit here.
      const subPoints = parseRate(award.points ?? "0");
      const carrierPoints = parseRate(award.denominator ?? "0");
      if (carrierPoints === 0n) {
        return {
          commission: zero(currency),
          notes: ["carrier rate unknown — cannot resolve a points share"],
          nil: true,
        };
      }
      let commission = applyFraction(up, subPoints, carrierPoints, rounding);
      notes.push(`${award.points} of ${award.denominator} points of carrier commission`);
      if (award.capAtUpstream === true && commission.units > up.units) {
        notes.push(
          `capped at the carrier commission of ${formatMoney(up)} — the clause ` +
            "awards more points than the carrier granted",
        );
        commission = up;
      }
      return { commission, notes, nil: isZero(commission) };
    }

    case "fee": {
      const per = award.per ?? "ticket";
      let gross: Money;

      if (award.rate !== undefined) {
        // A percentage fee — a merchant-account charge on the ticket total, or
        // a handling charge on the commission. Taken on the *absolute* value so
        // that a fee on a refund is still a charge, not a rebate.
        const basisOf = award.basisOf ?? "ticket_total";
        const source =
          basisOf === "base_fare"
            ? ticket.baseFare
            : basisOf === "commission"
              ? (upstream ?? zero(currency))
              : ticket.total;
        const magnitude: Money = {
          units: source.units < 0n ? -source.units : source.units,
          currency: source.currency,
        };
        gross = applyRate(magnitude, award.rate, rounding);
        notes.push(`${award.rate}% of ${basisOf.replace("_", " ")} ${formatMoney(magnitude)}`);
        if (award.minimum) {
          const floor = parseMoney(award.minimum, award.currency ?? currency);
          if (gross.units < floor.units) {
            notes.push(`raised to the ${formatMoney(floor)} minimum`);
            gross = floor;
          }
        }
        if (award.cap) {
          const cap = parseMoney(award.cap, award.currency ?? currency);
          if (gross.units > cap.units) {
            notes.push(`capped at ${formatMoney(cap)}`);
            gross = cap;
          }
        }
      } else {
        const one = parseMoney(award.amount ?? "0", award.currency ?? currency);
        gross = per === "coupon" ? applyFraction(one, BigInt(couponCount), 1n) : one;
      }

      // Signed from the sub-agent's point of view: a fee they pay is negative.
      const signed = award.direction === "credit_subagent" ? gross : negate(gross);
      return { commission: signed, notes, nil: isZero(signed) };
    }

    default: {
      const never: never = award.kind;
      throw new Error(`unsupported award kind: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Prorating
// ---------------------------------------------------------------------------

/**
 * Split the base fare across coupons for coupon-scoped rules.
 *
 * Weights come from the fare calculation string where the adapter could lift
 * them; otherwise every coupon is weighted equally, which is stated in the
 * trace rather than hidden. `allocate` guarantees the parts sum to the whole,
 * so a per-coupon rule can never invent or lose a minor unit.
 */
export function prorateBasis(
  ticket: TicketDocument,
  basis: Money,
): { parts: Money[]; method: "fare_calc" | "equal" } {
  const weights = ticket.coupons.map((c) => c.fareCalcWeight ?? null);
  const haveAll = weights.every((w) => w !== null && w > 0n);
  const method = haveAll ? "fare_calc" : "equal";
  const w = haveAll ? (weights as bigint[]) : ticket.coupons.map(() => 1n);
  return { parts: allocate(basis, w), method };
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function emptyLayer(
  layer: LayerResult["layer"],
  currency: string,
  outcome: LayerResult["outcome"],
  notes: string[],
  rejected: LayerResult["rejected"],
): LayerResult {
  return { layer, outcome, commission: zero(currency), notes, rejected };
}

/**
 * Carrier → host agency.
 *
 * Ticket scope is evaluated first because that is what nearly every contract
 * means. Only when the winning rule declares `scope: "coupon"` is the ticket
 * re-evaluated coupon by coupon against a prorated base.
 */
function computeCarrierGross(
  ticket: TicketDocument,
  rules: readonly Rule[],
  opts: CalculationOptions = {},
): LayerResult & { rate?: string; rule?: Rule } {
  const geo = opts.geo ?? DEFAULT_GEO;
  const defaultRounding = opts.defaultRounding ?? "half_up";
  const ctx: MatchContext = { geo };
  const pool = rules.filter((r) => r.layer === "carrier_to_host");

  const selection = selectRule(pool, ticket, ctx);

  if (selection.kind === "none") {
    return emptyLayer(
      "carrier_to_host",
      ticket.currency,
      "NO_RULE",
      [
        `no carrier clause covers this ticket (${pool.length} considered). ` +
          "This is not the same as nil commission and must be resolved, not assumed.",
      ],
      selection.rejected,
    );
  }
  if (selection.kind === "ambiguous") {
    return {
      ...emptyLayer(
        "carrier_to_host",
        ticket.currency,
        "AMBIGUOUS",
        [
          "two clauses match at equal priority and specificity: " +
            selection.candidates.map((c) => `${c.rule.id} v${c.rule.version}`).join(" / "),
        ],
        selection.rejected,
      ),
      conditions: selection.candidates[0].traces,
    };
  }
  if (selection.kind === "incomplete") {
    return {
      ...emptyLayer(
        "carrier_to_host",
        ticket.currency,
        "INCOMPLETE",
        ["an airport on this ticket is not in the geography table, so its market cannot be resolved"],
        selection.rejected,
      ),
      ruleId: selection.evaluation.rule.id,
      ruleVersion: selection.evaluation.rule.version,
      conditions: selection.evaluation.traces,
    };
  }

  const winner = selection.evaluation.rule;
  const notes: string[] = [];

  if ((winner.scope ?? "ticket") === "half_rt") {
    // Clause-12.1 pricing: each direction of travel is rated on its own
    // booking class against its own share of the fare. An outbound in D at 9%
    // and a return in W at 5% are two different rates on one ticket, and
    // averaging them or taking the first is simply wrong money.
    const halves = splitHalves(ticket.coupons, geo);
    const weights = halves.map((h) =>
      h.coupons.reduce((acc, c) => acc + (c.fareCalcWeight ?? 1n), 0n),
    );
    const usedFareCalc = ticket.coupons.every((c) => (c.fareCalcWeight ?? 0n) > 0n);

    // Split the commissionable basis itself. Splitting only the base fare and
    // letting each sector re-add the whole tax stack would charge the carrier
    // for the same YQ twice on every round trip.
    const full = resolveBasis(ticket, winner.award.basis ?? ["base_fare"]);
    const parts = allocate(full.basis, weights);

    notes.push(
      halves.length === 1
        ? "one-way journey priced as a single sector"
        : usedFareCalc
          ? "priced per half round trip; fare split from the fare calculation"
          : "priced per half round trip; fare split evenly between the two directions",
    );

    let total = zero(ticket.currency);
    const trace: BasisTrace[] = [];
    let ambiguous = false;

    halves.forEach((half, i) => {
      const table = winner.award.rateTable;
      const resolved = table
        ? rateFromTable(table, half.coupons)
        : { rate: winner.award.rate ?? "0", ambiguous: false, note: `${winner.award.rate}%` };

      const classes = [...new Set(half.coupons.map((c) => c.rbd))].join("/");
      notes.push(`${half.label}: ${resolved.note}`);

      if (resolved.rate === null) {
        if (resolved.ambiguous) ambiguous = true;
        trace.push({
          component: `${half.label} (${classes})`,
          amount: parts[i],
          included: false,
          reason: resolved.note,
        });
        return;
      }

      const earned = applyRate(parts[i], resolved.rate, defaultRounding);
      total = add(total, earned);
      trace.push({
        component: `${half.label} (${classes})`,
        amount: parts[i],
        included: true,
        reason: `${resolved.rate}% → ${formatMoney(earned)}`,
      });
    });

    return {
      layer: "carrier_to_host",
      outcome: ambiguous ? "AMBIGUOUS" : isZero(total) ? "NIL" : "CALCULATED",
      ruleId: winner.id,
      ruleVersion: winner.version,
      clause: winner.source?.clause,
      basis: full.basis,
      basisTrace: [...full.trace, ...trace],
      commission: ambiguous ? zero(ticket.currency) : total,
      conditions: selection.evaluation.traces,
      rejected: selection.rejected,
      notes,
      rate: winner.award.rate,
      rule: winner,
    };
  }

  if ((winner.scope ?? "ticket") === "coupon") {
    // Per-coupon evaluation against a prorated base.
    const fullBasis = resolveBasis(ticket, winner.award.basis ?? ["base_fare"]);
    const { parts, method } = prorateBasis(ticket, fullBasis.basis);
    notes.push(
      method === "equal"
        ? "coupon-scoped rule; base fare prorated equally (no fare-calc weights available)"
        : "coupon-scoped rule; base fare prorated from the fare calculation",
    );
    let total = zero(ticket.currency);
    let basisTotal = zero(ticket.currency);
    const conditions: ConditionTrace[] = [];
    const trace: BasisTrace[] = [];

    ticket.coupons.forEach((coupon: Coupon, i: number) => {
      const sel = selectRule(pool, ticket, ctx, coupon);
      if (sel.kind !== "matched") {
        notes.push(`coupon ${coupon.n} (${coupon.origin}–${coupon.destination}): no clause`);
        return;
      }
      const rule = sel.evaluation.rule;
      const table = rule.award.rateTable;
      const resolved = table
        ? rateFromTable(table, [coupon])
        : { rate: rule.award.rate ?? "0", ambiguous: false, note: `${rule.award.rate}%` };

      conditions.push(...sel.evaluation.traces);
      basisTotal = add(basisTotal, parts[i]);

      if (resolved.rate === null) {
        trace.push({
          component: `coupon ${coupon.n} ${coupon.origin}–${coupon.destination}`,
          amount: parts[i], included: false, reason: resolved.note,
        });
        notes.push(`coupon ${coupon.n}: ${resolved.note}`);
        return;
      }

      const earned = applyRate(parts[i], resolved.rate, defaultRounding);
      total = add(total, earned);
      trace.push({
        component: `coupon ${coupon.n} ${coupon.origin}–${coupon.destination}`,
        amount: parts[i], included: true,
        reason: `${rule.id} at ${resolved.rate}% → ${formatMoney(earned)}`,
      });
    });

    return {
      layer: "carrier_to_host",
      outcome: isZero(total) ? "NIL" : "CALCULATED",
      ruleId: winner.id,
      ruleVersion: winner.version,
      clause: winner.source?.clause,
      basis: basisTotal,
      basisTrace: [...fullBasis.trace, ...trace],
      commission: total,
      conditions,
      rejected: selection.rejected,
      notes,
      rate: winner.award.rate,
      rule: winner,
    };
  }

  const result = applyAward(
    winner.award,
    ticket,
    { defaultRounding },
    undefined,
    undefined,
    ticket.coupons.length,
  );

  return {
    layer: "carrier_to_host",
    outcome: result.ambiguous
      ? "AMBIGUOUS"
      : winner.award.kind === "nil" || (result.nil && !result.accrual)
        ? "NIL"
        : "CALCULATED",
    ruleId: winner.id,
    ruleVersion: winner.version,
    clause: winner.source?.clause,
    basis: result.basis,
    basisTrace: result.basisTrace,
    commission: result.commission,
    accrual: result.accrual,
    conditions: selection.evaluation.traces,
    rejected: selection.rejected,
    notes: [...notes, ...result.notes],
    rate: result.rateUsed ?? winner.award.rate,
    rule: winner,
  };
}

/**
 * A void reverses the whole of it.
 *
 * A ticket voided inside the void window was never sold, so the commission was
 * never earned. The original entry is not deleted — it is reversed — so the
 * ledger still shows that the sale happened and was undone.
 */
function voidReversal(
  ticket: TicketDocument,
  layer: LayerResult & { rate?: string },
): LayerResult & { rate?: string } {
  const prior =
    ticket.refund?.originalCommission ?? ticket.exchange?.originalCommission ?? null;

  if (prior === null || prior === undefined) {
    return {
      ...layer,
      gross: layer.commission,
      commission: zero(ticket.currency),
      outcome: "INCOMPLETE",
      notes: [
        ...(layer.notes ?? []),
        "this document voids a ticket but does not say what commission that " +
          "ticket had taken, so there is nothing to reverse against",
      ],
    };
  }

  return {
    ...layer,
    gross: layer.commission,
    priorCommission: prior,
    commission: negate(prior),
    outcome: isZero(prior) ? layer.outcome : "CALCULATED",
    notes: [
      ...(layer.notes ?? []),
      `void: the whole of ${formatMoney(prior)} recognised on ` +
        `${ticket.refund?.originalTicket ?? ticket.ticketNumber} is reversed`,
    ],
  };
}

/**
 * A refund reverses commission on the fare actually given back.
 *
 * Two things make this more than a sign flip. A partial refund returns only
 * part of the fare, so only that part of the commission comes back — and the
 * split has to be exact, because a clawback that rounds the other way from the
 * entry it reverses leaves a permanent cent behind on every refunded ticket.
 * And the cancellation penalty is fare the carrier keeps, so it is excluded
 * from the refunded base rather than clawed back with it.
 */
function refundReversal(
  ticket: TicketDocument,
  layer: LayerResult & { rate?: string },
  rules: readonly Rule[],
  opts: CalculationOptions,
): LayerResult & { rate?: string } {
  const notes = [...(layer.notes ?? [])];
  const r = ticket.refund;

  // A document that already carries negative amounts reverses itself: the rate
  // applies to a negative basis and rounds by magnitude, so it mirrors the
  // entry it reverses exactly.
  if (!r) {
    if (ticket.baseFare.units < 0n) {
      notes.push("refund priced directly from the negative amounts on the document");
      return { ...layer, gross: layer.commission, notes };
    }
    if (isZero(layer.commission)) return { ...layer, gross: layer.commission, notes };
    return {
      ...layer,
      gross: layer.commission,
      commission: zero(ticket.currency),
      outcome: "INCOMPLETE",
      notes: [
        ...notes,
        "this document is a refund but carries no record of the ticket it " +
          "refunds, so commission already taken cannot be reversed",
      ],
    };
  }

  if (r.penalty && !isZero(r.penalty)) {
    notes.push(
      `penalty of ${formatMoney(r.penalty)} retained by the carrier and excluded ` +
        "from the refunded fare — it is not commissionable",
    );
  }

  const prior = r.originalCommission;
  if (prior === null || prior === undefined) {
    // Derive it, but say that it was derived: a figure the document stated and
    // a figure we recomputed are not the same kind of fact.
    const asIssued: TicketDocument = {
      ...ticket,
      documentType: "TKT",
      baseFare: r.originalBase,
      refund: null,
    };
    const recomputed = computeCarrierGross(asIssued, rules, opts);
    if (recomputed.outcome !== "CALCULATED" && recomputed.outcome !== "NIL") {
      return {
        ...layer,
        gross: layer.commission,
        commission: zero(ticket.currency),
        outcome: "INCOMPLETE",
        notes: [...notes, "the refunded ticket's own commission could not be established"],
      };
    }
    notes.push(
      `the refunded ticket's commission of ${formatMoney(recomputed.commission)} was ` +
        "recomputed from the contract, not read off the document",
    );
    return finishRefund(layer, recomputed.commission, r, notes);
  }

  return finishRefund(layer, prior, r, notes);
}

function finishRefund(
  layer: LayerResult & { rate?: string },
  prior: Money,
  r: NonNullable<TicketDocument["refund"]>,
  notes: string[],
): LayerResult & { rate?: string } {
  if (r.originalBase.units === 0n) {
    return {
      ...layer,
      gross: layer.commission,
      commission: negate(prior),
      outcome: isZero(prior) ? layer.outcome : "CALCULATED",
      priorCommission: prior,
      notes: [...notes, `full reversal of ${formatMoney(prior)}`],
    };
  }

  const full = r.refundedBase.units >= r.originalBase.units;
  if (full) {
    notes.push(`full refund: the whole of ${formatMoney(prior)} is reversed`);
    return {
      ...layer,
      gross: layer.commission,
      priorCommission: prior,
      commission: negate(prior),
      outcome: isZero(prior) ? layer.outcome : "CALCULATED",
      notes,
    };
  }

  // Pro-rata on the refunded share of the base. `allocate` splits the original
  // commission into the refunded part and the retained part so the two are
  // guaranteed to sum back to it — a clawback that does not is a cent that
  // never comes home.
  const retained = r.originalBase.units - r.refundedBase.units;
  const [refunded] = allocate(prior, [r.refundedBase.units, retained]);
  notes.push(
    `partial refund: ${formatMoney(r.refundedBase)} of ${formatMoney(r.originalBase)} ` +
      `returned, so ${formatMoney(refunded)} of the ${formatMoney(prior)} recognised ` +
      "is reversed",
  );
  return {
    ...layer,
    gross: layer.commission,
    priorCommission: prior,
    commission: negate(refunded),
    outcome: isZero(refunded) ? layer.outcome : "CALCULATED",
    notes,
  };
}

/**
 * Carrier → host agency, with a reissue netted against the ticket it replaces.
 *
 * A reissue carries the fare of the ticket it replaces plus whatever was
 * collected on top. Commissioning the whole new fare pays a second time on
 * every dollar carried over, so the commission already recognised on the
 * original is reversed here. The Amadeus FO element states that figure
 * (`/C0.00`, `/C100.00`) precisely so it can be.
 *
 * Where the original figure is missing the engine says so rather than
 * assuming zero: assuming zero is what produces the double payment.
 */
export function calculateCarrierLayer(
  ticket: TicketDocument,
  rules: readonly Rule[],
  opts: CalculationOptions = {},
): LayerResult & { rate?: string } {
  const layer = computeCarrierGross(ticket, rules, opts);
  const { rule, ...rest } = layer;

  if (ticket.documentType === "VOID") return voidReversal(ticket, rest);
  if (ticket.documentType === "RFND") return refundReversal(ticket, rest, rules, opts);
  if (ticket.documentType !== "EXCH") return rest;

  const treatment = rule?.exchangeTreatment ?? "net_of_original";
  const notes = [...(rest.notes ?? [])];
  const gross = rest.commission;

  if (treatment === "full_fare") {
    notes.push(
      "reissue commissioned on the full new fare; this contract does not net " +
        "against the ticket it replaces",
    );
    return { ...rest, gross, notes };
  }

  if (!ticket.exchange) {
    // An exchange with nothing to net against. The parser raises this too, but
    // the calculation must not quietly pay on the whole fare because of it.
    if (!isZero(gross)) {
      notes.push(
        "this document is a reissue but carries no record of the ticket it " +
          "replaces, so commission already taken on that ticket cannot be reversed",
      );
      return { ...rest, gross, outcome: "INCOMPLETE", commission: zero(ticket.currency), notes };
    }
    return { ...rest, gross, notes };
  }

  if (treatment === "added_collection_only") {
    const added = ticket.exchange.additionalCollection;
    if (!added) {
      notes.push("this contract commissions the added collection, which the document does not state");
      return { ...rest, gross, outcome: "INCOMPLETE", commission: zero(ticket.currency), notes };
    }
    const ratio = ticket.baseFare.units === 0n
      ? 0n
      : (gross.units * added.units) / ticket.baseFare.units;
    const commission = { units: ratio, currency: ticket.currency };
    notes.push(
      `commissioned on the added collection of ${formatMoney(added)} rather than ` +
        `the full fare of ${formatMoney(ticket.baseFare)}`,
    );
    return { ...rest, gross, commission, notes };
  }

  const prior = ticket.exchange.originalCommission;
  if (prior === null || prior === undefined) {
    notes.push(
      `commission already taken on ${ticket.exchange.originalTicket} is not stated, ` +
        "so this reissue cannot be netted without paying twice on the carried-over fare",
    );
    return { ...rest, gross, outcome: "INCOMPLETE", commission: zero(ticket.currency), notes };
  }

  const commission = subtract(gross, prior);
  notes.push(
    `reissue: ${formatMoney(gross)} on the new fare less ${formatMoney(prior)} already ` +
      `taken on ${ticket.exchange.originalTicket}`,
  );
  return {
    ...rest,
    gross,
    priorCommission: prior,
    commission,
    // A clawback is a computed amount, not an absence of one. Leaving the
    // outcome at NIL beside a non-zero figure invites a reader to trust the
    // label over the number.
    outcome: isZero(commission) ? rest.outcome : "CALCULATED",
    notes,
  };
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

/**
 * A fee line should read like the invoice line it becomes, not like a rule id.
 * Falls back to the document type the clause is gated on, which is how
 * transaction fees (exchange, refund, void) name themselves.
 */
function feeLabel(rule: Rule): string {
  if (rule.award.direction === "credit_subagent") return "credit to sub-agent";
  const dt = rule.match.documentType;
  const codes =
    dt && typeof dt === "object" && dt.in ? dt.in.map((c) => c.toUpperCase()) : [];
  if (codes.includes("EXCH")) return "exchange fee";
  if (codes.includes("RFND")) return "refund fee";
  if (codes.includes("VOID")) return "void fee";
  if (codes.includes("ADM")) return "ADM handling fee";
  if (codes.includes("EMD")) return "EMD fee";
  if (rule.award.basisOf === "ticket_total" && rule.award.rate) return "merchant fee";
  return "fee charged to sub-agent";
}

export interface WaterfallInput {
  readonly ticket: TicketDocument;
  readonly rules: readonly Rule[];
  readonly subAgentId?: string | null;
}

/**
 * The full two-layer calculation: carrier commission, the sub-agent's share of
 * it, the fees the host charges, and what each party is left holding.
 */
export function calculate(
  input: WaterfallInput,
  opts: CalculationOptions = {},
): Waterfall {
  const { ticket, rules } = input;
  const currency = ticket.currency;
  const geo = opts.geo ?? DEFAULT_GEO;
  const defaultRounding = opts.defaultRounding ?? "half_up";
  const subAgentId = input.subAgentId ?? ticket.subAgentId ?? null;

  const carrier = calculateCarrierLayer(ticket, rules, { geo, defaultRounding });

  const flags: { code: Waterfall["flags"][number]["code"]; message: string }[] = [];
  if (carrier.outcome !== "CALCULATED" && carrier.outcome !== "NIL") {
    flags.push({
      code: carrier.outcome,
      message: carrier.notes?.[0] ?? "carrier layer could not be calculated",
    });
  }
  if (carrier.priorCommission && isNegative(carrier.commission)) {
    // Commission going back out is legitimate on a void, a refund or a reissue
    // to a cheaper fare — and it must reach a human before it lands on a
    // statement as a negative line.
    const kind =
      ticket.documentType === "VOID" ? "void"
      : ticket.documentType === "RFND" ? "refund"
      : "reissue";
    flags.push({
      code: "REVIEW",
      message:
        `${kind} reverses ${formatMoney(negate(carrier.commission))} ${currency} against ` +
        `${formatMoney(carrier.priorCommission)} previously recognised — commission is owed back`,
    });
  }
  if (carrier.accrual && !isZero(carrier.accrual)) {
    flags.push({
      code: "REVIEW",
      message: `PLB accrual of ${formatMoney(carrier.accrual)} ${currency} pending period settlement`,
    });
  }

  if (!subAgentId) {
    return {
      ticketNumber: ticket.ticketNumber,
      currency,
      engineVersion: ENGINE_VERSION,
      ticketTotal: ticket.total,
      baseFare: ticket.baseFare,
      carrier,
      fees: [],
      hostSpread: carrier.commission,
      netToSubAgent: zero(currency),
      flags,
    };
  }

  // A fee gated on `upstreamCommission: "nil"` may only fire where the host has
  // *established* that it earns nothing — a contract clause that asserts nil, or
  // one that computed to zero. A carrier layer that found no rule at all has
  // established nothing, and billing a sub-agent off that is inventing a charge.
  const upstreamEstablished =
    carrier.outcome === "NIL" || carrier.outcome === "CALCULATED";
  const upstreamNil = upstreamEstablished && isZero(carrier.commission);
  const ctx: MatchContext = { geo, upstreamCommissionIsNil: upstreamNil };
  const pool = rules.filter(
    (r) => r.layer === "host_to_subagent" && r.subAgentId === subAgentId,
  );

  const shareRules = pool.filter((r) => r.award.kind !== "fee");
  const feeRules = pool.filter((r) => r.award.kind === "fee");

  // --- the sub-agent's share -------------------------------------------------
  let subAgent: LayerResult;
  const shareSelection = selectRule(shareRules, ticket, ctx);

  if (shareSelection.kind === "matched") {
    const rule = shareSelection.evaluation.rule;
    // Points shares are resolved against the carrier rate that actually fired,
    // so "7 of 8" becomes "7 of 6" by itself when the carrier contract changes.
    const needsCarrierRate =
      rule.award.kind === "share_of_upstream" &&
      (rule.award.mode ?? "points") === "points";
    const award: Award = needsCarrierRate
      ? { ...rule.award, denominator: rule.award.denominator ?? carrier.rate ?? "0" }
      : rule.award;

    const r = applyAward(
      award,
      ticket,
      { defaultRounding },
      carrier.commission,
      undefined,
      ticket.coupons.length,
      undefined,
      carrier.basis,
      carrier.gross ?? carrier.commission,
    );
    subAgent = {
      layer: "host_to_subagent",
      outcome: r.nil ? "NIL" : "CALCULATED",
      ruleId: rule.id,
      ruleVersion: rule.version,
      clause: rule.source?.clause,
      commission: r.commission,
      conditions: shareSelection.evaluation.traces,
      rejected: shareSelection.rejected,
      notes: r.notes,
    };
  } else if (shareSelection.kind === "none") {
    subAgent = emptyLayer(
      "host_to_subagent",
      currency,
      upstreamNil ? "NIL" : "NO_RULE",
      upstreamNil
        ? ["carrier layer awarded nothing, so there is no share to divide"]
        : !upstreamEstablished
          ? ["carrier layer is unresolved, so no share can be computed"]
          : [`no revenue-share clause found for sub-agent ${subAgentId}`],
      shareSelection.rejected,
    );
    if (!upstreamNil && upstreamEstablished) {
      flags.push({
        code: "NO_RULE",
        message: `carrier commission of ${formatMoney(carrier.commission)} ${currency} has no sub-agent share clause`,
      });
    }
  } else if (shareSelection.kind === "ambiguous") {
    subAgent = emptyLayer(
      "host_to_subagent",
      currency,
      "AMBIGUOUS",
      [
        "two sub-agent clauses match equally: " +
          shareSelection.candidates.map((c) => c.rule.id).join(" / "),
      ],
      shareSelection.rejected,
    );
    flags.push({ code: "AMBIGUOUS", message: subAgent.notes![0] });
  } else {
    subAgent = emptyLayer(
      "host_to_subagent",
      currency,
      "INCOMPLETE",
      ["sub-agent clause needs geography this ticket could not resolve"],
      shareSelection.rejected,
    );
    flags.push({ code: "INCOMPLETE", message: subAgent.notes![0] });
  }

  // --- fees ------------------------------------------------------------------
  // Every matching fee clause applies; fees are cumulative, not exclusive.
  const fees: { ruleId: string; clause?: string; label: string; amount: Money }[] = [];
  for (const rule of feeRules) {
    const evaluation = selectRule([rule], ticket, ctx);
    if (evaluation.kind !== "matched") continue;
    const r = applyAward(
      rule.award,
      ticket,
      { defaultRounding },
      carrier.commission,
      undefined,
      ticket.coupons.length,
      undefined,
      carrier.basis,
      carrier.gross ?? carrier.commission,
    );
    if (isZero(r.commission)) continue;
    fees.push({
      ruleId: rule.id,
      clause: rule.source?.clause,
      label: feeLabel(rule),
      amount: r.commission,
    });
  }

  // Subtraction, not a second rate calculation: this is what makes
  // share + spread === carrier commission true to the minor unit, always.
  const hostSpread = subtract(carrier.commission, subAgent.commission);
  if (isNegative(hostSpread)) {
    // The sub-agent agreement promises more than the carrier contract delivers.
    // That is a real conflict between two signed documents, not an arithmetic
    // problem, so the engine reports it instead of quietly resolving it.
    flags.push({
      code: "REVIEW",
      message:
        `sub-agent share of ${formatMoney(subAgent.commission)} ${currency} exceeds the ` +
        `carrier commission of ${formatMoney(carrier.commission)} ${currency} — the host ` +
        `pays ${formatMoney(negate(hostSpread))} out of pocket`,
    });
  }
  const netToSubAgent = add(
    subAgent.commission,
    sum(fees.map((f) => f.amount), currency),
  );

  return {
    ticketNumber: ticket.ticketNumber,
    currency,
    engineVersion: ENGINE_VERSION,
    ticketTotal: ticket.total,
    baseFare: ticket.baseFare,
    carrier,
    subAgent,
    fees,
    hostSpread,
    netToSubAgent,
    flags,
  };
}
