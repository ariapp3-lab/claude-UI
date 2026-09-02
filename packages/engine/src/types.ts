/**
 * The canonical domain model.
 *
 * Every ingestion adapter — ARC, GDS, print-stream, PDF, manual — produces
 * these shapes and nothing else. Nothing downstream of `parsers/` knows where
 * a ticket came from.
 */

import type { Money, RoundingMode } from "./money.js";

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export type DocumentType =
  | "TKT"    // original issue
  | "EXCH"   // exchange / reissue
  | "RFND"   // refund, full or partial
  | "VOID"   // voided inside the void window
  | "EMD"    // electronic miscellaneous document
  | "ADM"    // agency debit memo
  | "ACM";   // agency credit memo

export type FareType = "published" | "private" | "group" | "consolidator";

export type PaxType = "ADT" | "CHD" | "INF" | "SRC" | "STU" | "MIL" | "LBR";

export type CouponStatus = "OK" | "USED" | "VOID" | "RFND" | "EXCH" | "OPEN";

export interface TaxItem {
  /** ISO/IATA tax code: US, ZP, XF, AY, YQ, YR, IL, GB … */
  readonly code: string;
  readonly amount: Money;
}

export interface Coupon {
  /** 1-based coupon number as printed on the stock. */
  readonly n: number;
  readonly origin: string;
  readonly destination: string;
  readonly marketingCarrier: string;
  readonly operatingCarrier?: string;
  readonly flightNumber?: string;
  /** Reservation booking designator — the single letter in the PNR. */
  readonly rbd: string;
  readonly fareBasis: string;
  readonly departureDate: string; // ISO yyyy-mm-dd
  readonly status: CouponStatus;
  /**
   * Base fare attributable to this coupon. Populated by the prorate step
   * for coupon-scoped rules; null when the ticket is evaluated at ticket scope.
   */
  readonly proratedBase?: Money | null;
  /**
   * Relative weight used to prorate, normally the NUC amount lifted from the
   * fare calculation string. Falls back to equal weighting when absent.
   */
  readonly fareCalcWeight?: bigint | null;
}

export interface TicketDocument {
  /** "114-2401234567" — 3-digit carrier code, hyphen, 10-digit serial. */
  readonly ticketNumber: string;
  readonly documentType: DocumentType;
  /** Ticket number of the primary stock when this is a conjunction. */
  readonly conjunctionOf?: string | null;
  /** Document this one replaces or reverses (exchange, refund, void). */
  readonly inRespectOf?: string | null;

  readonly validatingCarrier: string;
  readonly iataNumber?: string;
  readonly issueDate: string;      // ISO yyyy-mm-dd
  readonly posCountry: string;     // ISO-3166 alpha-2
  readonly currency: string;

  readonly baseFare: Money;
  readonly taxes: readonly TaxItem[];
  readonly total: Money;

  readonly fareCalc?: string | null;
  readonly tourCode?: string | null;
  readonly ticketDesignator?: string | null;
  readonly fareType: FareType;
  readonly paxType: PaxType;

  /** Commission the agent reported, when the source tells us. */
  readonly reportedCommission?: Money | null;
  /** Penalty retained on a refund — normally non-commissionable. */
  readonly penalty?: Money | null;

  readonly coupons: readonly Coupon[];

  /** Sub-agent this ticket was issued for, when applicable. */
  readonly subAgentId?: string | null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleLayer = "carrier_to_host" | "host_to_subagent";

/**
 * The unit a rule is applied to.
 *
 *   ticket   one rate for the whole document (the common case)
 *   coupon   a rate per flight coupon, against a prorated base
 *   half_rt  a rate per direction of travel — the outbound half and the
 *            return half each priced on their own booking class. EL AL's
 *            2026 letter states this explicitly at clause 12.1.
 */
export type RuleScope = "ticket" | "coupon" | "half_rt";

export interface StringCondition {
  readonly in?: readonly string[];
  readonly notIn?: readonly string[];
  /** Anchored at neither end — use ^ and $ explicitly. Case-insensitive. */
  readonly matches?: string;
  readonly notMatches?: string;
  readonly absent?: boolean;
  readonly present?: boolean;
}

export interface MarketCondition {
  /** Country code, region code (see geo.ts), or specific airport. */
  readonly from: string;
  readonly to: string;
  /** "either" treats the pair as unordered — the common case in contracts. */
  readonly direction?: "outbound" | "either";
}

export interface DateWindow {
  readonly from?: string; // ISO, inclusive
  readonly to?: string;   // ISO, inclusive
}

/**
 * A rate that depends on a field of the ticket rather than being one number.
 * Carrier commission letters are written this way — a table of booking class
 * against percentage — so the rule is stored the same way the contract is.
 */
export interface RateTable {
  readonly by: "rbd";
  /** Booking class → decimal rate string, e.g. { D: "9.00", W: "5.00" }. */
  readonly rates: Readonly<Record<string, string>>;
  /**
   * What a class absent from the table earns. "nil" is the safe reading of a
   * commission letter: a class the airline did not list is not a class it
   * agreed to pay on. "ambiguous" queues it for a human instead.
   */
  readonly otherwise?: "nil" | "ambiguous";
}

export interface RuleMatch {
  readonly validatingCarrier?: string | StringCondition;
  /**
   * Countries or regions the journey must ORIGINATE in. Distinct from
   * `market`, which tests a pair: a contract that pays only on travel
   * originating in the USA and Canada does not pay on the reverse journey.
   */
  readonly originIn?: readonly string[];
  /** The mirror: a journey originating in any of these does NOT match. */
  readonly originNotIn?: readonly string[];
  readonly marketingCarrier?: string | StringCondition;
  readonly posCountry?: string | StringCondition;
  readonly market?: MarketCondition;
  readonly rbd?: StringCondition;
  readonly fareBasis?: StringCondition;
  readonly tourCode?: StringCondition;
  readonly ticketDesignator?: StringCondition;
  readonly fareType?: StringCondition;
  readonly paxType?: StringCondition;
  readonly documentType?: StringCondition;
  /**
   * Layer-2 only: gate a rule on what the carrier layer produced. This is how
   * a service fee fires only where the host earned nothing.
   */
  readonly upstreamCommission?: "nil" | "nonzero" | "any";
}

export type AwardKind =
  | "percent"
  | "flat"
  | "nil"
  | "plb"
  | "share_of_upstream"
  | "fee";

/** Which components of the ticket the percentage is taken on. */
export type BasisComponent = "base_fare" | "yq" | "yr" | { readonly tax: string };

export interface Rounding {
  readonly mode: RoundingMode;
}

export interface Award {
  readonly kind: AwardKind;

  /** percent | plb — decimal string, e.g. "8.00". */
  readonly rate?: string;
  /** percent — a rate that varies by booking class, as filed in the contract. */
  readonly rateTable?: RateTable;
  /** percent — components summed to form the commissionable basis. */
  readonly basis?: readonly BasisComponent[];
  /** percent — optional bounds applied after rounding. */
  readonly cap?: string;
  readonly floor?: string;

  /** flat | fee — decimal string plus currency. */
  readonly amount?: string;
  readonly currency?: string;
  readonly per?: "ticket" | "coupon" | "passenger";
  /** fee — which way the money moves. */
  readonly direction?: "debit_subagent" | "credit_subagent";
  /**
   * fee — what a percentage fee is taken on. Merchant-account fees are a
   * percentage of the ticket total; a handling fee may be a percentage of the
   * commission. Set `rate` instead of `amount` to use these.
   */
  readonly basisOf?: "ticket_total" | "base_fare" | "commission";
  /** fee — a percentage fee may still be bounded. */
  readonly minimum?: string;

  /**
   * share_of_upstream — how the split is expressed. These are NOT equivalent
   * once the carrier rate moves, and real agreements use both:
   *
   *   points    the sub-agent gets N points ("you get 7"). If the carrier
   *             later pays 6, the agreement promises more than the host earns.
   *   residual  the host keeps N points and the sub-agent gets the rest
   *             ("I keep 1"). Self-correcting: at 6% the sub-agent gets 5.
   *   fraction  a ratio of whatever the host earned.
   *   absolute  a flat rate independent of the carrier contract.
   */
  readonly mode?: "points" | "residual" | "fraction" | "absolute";
  /** points: the sub-agent's points, e.g. "7.00" of the carrier's 8. */
  readonly points?: string;
  /** residual: the points the HOST retains; the sub-agent takes the remainder. */
  readonly hostRetainsPoints?: string;
  /** fraction: numerator/denominator of upstream commission. */
  readonly numerator?: string;
  readonly denominator?: string;
  /** What to do when the carrier layer awarded nothing. */
  readonly whenUpstreamNil?: "no_share" | "fee_only";
  /**
   * Never pass through more than the host actually earned. Off by default:
   * the engine computes what the agreement says and flags the conflict, and
   * only an explicit clause silently caps it.
   */
  readonly capAtUpstream?: boolean;

  readonly rounding?: Rounding;
}

export interface RuleSource {
  readonly document?: string;
  readonly clause?: string;
  readonly page?: number;
  readonly extractedBy?: "human" | "ai";
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

export interface Rule {
  readonly id: string;
  readonly layer: RuleLayer;
  readonly contractId: string;
  readonly version: number;
  /** Higher wins. Ties fall through to specificity, then to AMBIGUOUS. */
  readonly priority: number;
  readonly scope?: RuleScope;

  /** Layer 2 only — which sub-agent this clause belongs to. */
  readonly subAgentId?: string;

  readonly effective?: {
    readonly issuedBetween?: DateWindow;
    readonly travelBetween?: DateWindow;
  };

  readonly match: RuleMatch;
  readonly award: Award;
  readonly source?: RuleSource;

  /** An unapproved rule never fires. */
  readonly approved?: boolean;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type Outcome =
  | "CALCULATED"
  | "NIL"          // a rule fired and asserted zero commission
  | "NO_RULE"      // nothing matched — never silently zero
  | "AMBIGUOUS"    // tied on priority and specificity
  | "INCOMPLETE";  // ticket is missing a field the rule needs

export interface ConditionTrace {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly passed: boolean;
}

export interface RejectedRule {
  readonly ruleId: string;
  readonly version: number;
  readonly reason: string;
  readonly failedOn?: ConditionTrace;
}

export interface BasisTrace {
  readonly component: string;
  readonly amount: Money;
  readonly included: boolean;
  readonly reason?: string;
}

export interface LayerResult {
  readonly layer: RuleLayer;
  readonly outcome: Outcome;
  readonly ruleId?: string;
  readonly ruleVersion?: number;
  readonly clause?: string;

  /** The amount the commissionable basis resolved to. */
  readonly basis?: Money;
  readonly basisTrace?: readonly BasisTrace[];
  /** Front-end commission awarded at this layer, payable on this ticket. */
  readonly commission: Money;
  /**
   * Amount accrued toward a target-based override (PLB). Accrues per ticket,
   * settles at period end — deliberately NOT part of `commission`.
   */
  readonly accrual?: Money;

  readonly conditions?: readonly ConditionTrace[];
  readonly rejected?: readonly RejectedRule[];
  readonly notes?: readonly string[];
}

export interface Waterfall {
  readonly ticketNumber: string;
  readonly currency: string;
  readonly engineVersion: string;

  readonly ticketTotal: Money;
  readonly baseFare: Money;

  /** Carrier → host agency. */
  readonly carrier: LayerResult;
  /** Host agency → sub-agent, absent when no sub-agent is involved. */
  readonly subAgent?: LayerResult;

  /** Fees the host charges the sub-agent, signed from the sub-agent's view. */
  readonly fees: readonly {
    readonly ruleId: string;
    readonly clause?: string;
    readonly label: string;
    readonly amount: Money;
  }[];

  /** What the host keeps: carrier commission less the sub-agent's share. */
  readonly hostSpread: Money;
  /** What the sub-agent is owed: their share less fees charged. */
  readonly netToSubAgent: Money;

  /** Anything a human must look at before this figure is trusted. */
  readonly flags: readonly {
    readonly code: Outcome | "REVIEW";
    readonly message: string;
  }[];
}
