/**
 * Main St. Travel — Sub-Agent / Outside Agent Supplier Agreement.
 * Between Main St. Travel ("MST") and Ari Appel, A Appel and co ("Agent").
 * Effective 1 February 2026, month to month.
 *
 * This is the second half of the picture. The El Al letter
 * (ly-mainst-2026.ts) says what the airline pays MST; this says what MST keeps
 * before passing the rest on. Neither is meaningful alone: the Agent's income
 * is the first minus the second, and it can be negative.
 *
 * Three things in the signed schedule changed the model:
 *
 *  1. MST's fee on a commissionable fare is a percentage OF THE BASE FARE
 *     ("2% of the base fare, 1% on LY fares"), not a share of the commission.
 *     On LY that is the "one point" the Agent described, and it happens to
 *     coincide with a point of commission only because the El Al rates are
 *     also struck on the base fare. If either contract ever moves its basis,
 *     they stop coinciding — hence `residual` on the basis, not a fraction of
 *     the commission.
 *
 *  2. A ticket that earns no commission is not free. "Non-commissionable
 *     Fares: $10 per ticket" and the reserved right to "apply a minimum fee of
 *     $10 per ticket when the commission earned is less than $10" mean a
 *     zero-commission ticket costs the Agent money. Every one of the five real
 *     records supplied earns nothing under the El Al letter, so this clause,
 *     not the commission clause, is what governs them.
 *
 *  3. Net and bulk fares are charged a flat fee by cabin, not a percentage.
 *     Four of those five records are bulk fares.
 *
 * Where the schedule depends on something an AIR file does not carry — whether
 * a booking is corporate, whether a waiver was used, whether MST staff touched
 * it — the rule is written but left unapproved, and listed in OPEN_QUESTIONS.
 * The engine will not spend an unapproved rule; it queues the document.
 */

import type { Rule } from "../src/types.js";

export const MST_CONTRACT_ID = "ct_mst_subagent_2026";
export const MST_IATA = "33535983";
const EFFECTIVE = { issuedBetween: { from: "2026-02-01" } };

/**
 * Cabin by booking class, for the fee rows that price by cabin.
 *
 * NOT from the agreement — the agreement names cabins and leaves the mapping
 * to the carrier's own fare structure. This is the conventional El Al
 * allocation and it decides a $15 fee from a $50 one, so it is exported to be
 * corrected rather than buried. See OPEN_QUESTIONS[1].
 */
export const CABIN_BY_RBD = {
  business: ["J", "C", "D", "I", "Z"],
  premium: ["W"],
  // Everything else files as economy, including the classes El Al lists in
  // Attachment A at the lower rates (G, O, U) and any class not filed at all.
  economy: [
    "Y", "B", "M", "H", "K", "L", "Q", "N", "G", "O", "U", "S", "V", "T",
    "X", "E", "R", "P", "A",
  ],
} as const;

const base = {
  layer: "host_to_subagent",
  contractId: MST_CONTRACT_ID,
  version: 1,
  subAgentId: "subagent",
  effective: EFFECTIVE,
} as const;

const cite = (clause: string, text: string) => ({
  document: "MST Sub-Agent Agreement, effective 2026-02-01",
  clause,
  text,
});

// ---------------------------------------------------------------------------
// §3 — the commission share
// ---------------------------------------------------------------------------

/**
 * "Commissionable Published fares — 2% of the base fare, 1% on LY fares."
 *
 * Written as a residual (MST keeps one point, the Agent takes what is left)
 * rather than as points to the Agent. The distinction is not cosmetic: if El
 * Al moves S class from 7% to 6%, a residual gives the Agent 5 and a points
 * clause would still promise 7 — and the engine would then flag MST as paying
 * out of pocket on every ticket. The signed words are "MST Fee", so residual
 * is also the literal reading.
 */
export const MST_LY_SHARE: Rule = {
  ...base,
  id: "MST-SHARE-LY",
  priority: 600,
  approved: true,
  match: { validatingCarrier: "LY", fareType: { in: ["published"] } },
  award: {
    kind: "share_of_upstream",
    mode: "residual",
    hostRetainsPoints: "1.00",
    whenUpstreamNil: "fee_only",
  },
  source: cite("3 — Commissionable Published fares", "1% on LY fares"),
};

/** The same clause for every other carrier, where MST keeps two points. */
export const MST_DEFAULT_SHARE: Rule = {
  ...base,
  id: "MST-SHARE-DEFAULT",
  priority: 500,
  approved: true,
  match: { validatingCarrier: { notIn: ["LY"] }, fareType: { in: ["published"] } },
  award: {
    kind: "share_of_upstream",
    mode: "residual",
    hostRetainsPoints: "2.00",
    whenUpstreamNil: "fee_only",
  },
  source: cite("3 — Commissionable Published fares", "2% of the base fare"),
};

/**
 * "Exchange Commission Fares — 2% of the Fare Balance, 1% on LY fares."
 *
 * The same points, struck on the fare balance rather than the whole new fare.
 * The engine already nets a reissue against the ticket it replaces, so the
 * residual is taken on what this document actually earned; that is the fare
 * balance by construction.
 */
export const MST_LY_EXCHANGE_SHARE: Rule = {
  ...base,
  id: "MST-SHARE-LY-EXCH",
  priority: 700,
  approved: true,
  exchangeTreatment: "net_of_original",
  match: {
    validatingCarrier: "LY",
    documentType: { in: ["EXCH"] },
    fareType: { in: ["published"] },
  },
  award: {
    kind: "share_of_upstream",
    mode: "residual",
    hostRetainsPoints: "1.00",
    whenUpstreamNil: "fee_only",
  },
  source: cite("3 — Exchange Commission Fares", "1% on LY fares, of the Fare Balance"),
};

// ---------------------------------------------------------------------------
// §3 — flat fees on net and bulk fares
// ---------------------------------------------------------------------------

/**
 * "Net fares issued on LY — $15 (Economy) $30 (Premium) $50 (Business).
 *  Minimum per ticket based on published fare."
 *
 * These fire on net and bulk fares, where there is no published commission to
 * share: the agent marks the fare up and keeps the markup, and MST is paid for
 * the ticketing rather than out of the airline's money.
 *
 * The cabin figure is a FLOOR, not the fee. Footnote 2 says "if MST's fee for a
 * published fare is higher than the net-fare fee, the higher fee will apply" —
 * MST takes what it would have earned had the same fare been issued published
 * with commission, and the cabin figure applies only where that comes to less.
 *
 * So the fee is max(the published-fare point on this fare, the cabin figure),
 * which is exactly what `rate` plus `minimum` computes. On a $12,378 bulk
 * business fare the point is $123.79 and the $50 floor never binds; on a $900
 * economy fare the point is $9.00 and the $15 floor does.
 *
 * The rate is the same point MST keeps on a published fare, because that is
 * precisely what the clause measures — one point on LY, two elsewhere.
 */
function netFareFee(
  carrier: "LY" | "other",
  cabin: "economy" | "premium" | "business",
  floor: string,
  priority: number,
): Rule {
  const publishedRate = carrier === "LY" ? "1.00" : "2.00";
  return {
    ...base,
    id: `MST-FEE-NET-${carrier}-${cabin.toUpperCase()}`,
    priority,
    approved: true,
    match: {
      validatingCarrier: carrier === "LY" ? "LY" : { notIn: ["LY"] },
      fareType: { in: ["bulk", "net"] },
      documentType: { in: ["TKT"] },
      rbd: { in: [...CABIN_BY_RBD[cabin]] },
    },
    award: {
      kind: "fee",
      rate: publishedRate,
      basisOf: "base_fare",
      minimum: floor,
      currency: "USD",
      per: "ticket",
      direction: "debit_subagent",
    },
    source: cite(
      carrier === "LY" ? "3 — Net fares issued on LY" : "3 — Net fares",
      `${publishedRate}% of the fare as if published, minimum $${floor} (${cabin})`,
    ),
  };
}

export const MST_NET_FARE_FEES: Rule[] = [
  netFareFee("LY", "economy", "15.00", 820),
  netFareFee("LY", "premium", "30.00", 821),
  netFareFee("LY", "business", "50.00", 822),
  netFareFee("other", "economy", "20.00", 810),
  netFareFee("other", "premium", "30.00", 811),
  netFareFee("other", "business", "50.00", 812),
];

// ---------------------------------------------------------------------------
// §3 — per-transaction fees
// ---------------------------------------------------------------------------

/** "Exchanges — $25 each (even exchange: $0)." */
export const MST_EXCHANGE_FEE: Rule = {
  ...base,
  id: "MST-FEE-EXCHANGE",
  priority: 900,
  approved: true,
  match: { documentType: { in: ["EXCH"] }, additionalCollection: "nonzero" },
  award: {
    kind: "fee",
    amount: "25.00",
    currency: "USD",
    per: "ticket",
    direction: "debit_subagent",
  },
  source: cite("3 — Exchanges", "$25 each (even exchange: $0)"),
};

/**
 * "Refunds — $25."
 *
 * Footnote 4 adds $10 "if MST agents handled the Booking", which no AIR file
 * records. The base $25 is charged; the surcharge is OPEN_QUESTIONS[3].
 */
export const MST_REFUND_FEE: Rule = {
  ...base,
  id: "MST-FEE-REFUND",
  priority: 900,
  approved: true,
  match: { documentType: { in: ["RFND"] } },
  award: {
    kind: "fee",
    amount: "25.00",
    currency: "USD",
    per: "ticket",
    direction: "debit_subagent",
  },
  source: cite("3 — Refunds", "$25"),
};

/**
 * "Non-commissionable Fares — $10 per ticket."
 *
 * Gated on the carrier layer having ESTABLISHED that nothing is due — a clause
 * that asserted nil, or a rate that computed to zero. A document the engine
 * could not price is not a non-commissionable fare; it is an unpriced one, and
 * billing $10 off it would be inventing a charge.
 *
 * This is the clause that governs all five of the real records supplied: none
 * carries the tour code El Al clause 14 requires, so each earns nothing and
 * costs $10 — unless the net-fare fee above applies instead, which it does on
 * the four bulk fares.
 */
export const MST_NON_COMMISSIONABLE_FEE: Rule = {
  ...base,
  id: "MST-FEE-NONCOMM",
  priority: 850,
  approved: true,
  match: {
    documentType: { in: ["TKT"] },
    fareType: { in: ["published"] },
    upstreamCommission: "nil",
  },
  award: {
    kind: "fee",
    amount: "10.00",
    currency: "USD",
    per: "ticket",
    direction: "debit_subagent",
  },
  source: cite("3 — Non-commissionable Fares", "$10 per ticket"),
};

/**
 * "Apply a minimum fee of $10 per ticket when the commission earned is less
 * than $10."
 *
 * Filed under "MST Reserves the Right to", not under what MST commits to — so
 * it is discretionary, and the Agent may or may not see it on a statement. It
 * is left UNAPPROVED for that reason: the engine will surface it as an
 * exposure rather than book it as a certainty, which is the right treatment
 * for a charge the host may levy but has not promised to.
 *
 * Note it does not stack with the $10 non-commissionable fee above: that one
 * fires only at exactly zero, this one on a commission between zero and $10.
 */
export const MST_MINIMUM_FEE: Rule = {
  ...base,
  id: "MST-FEE-MINIMUM",
  priority: 860,
  approved: false,
  match: {
    documentType: { in: ["TKT"] },
    upstreamCommission: "nonzero",
    upstreamCommissionBelow: "10.00",
  },
  award: {
    kind: "fee",
    amount: "10.00",
    currency: "USD",
    per: "ticket",
    direction: "debit_subagent",
  },
  source: cite(
    "2 — MST Reserves the Right to",
    "Apply a minimum fee of $10 per ticket when the commission earned is less than $10",
  ),
};

/**
 * "Commissionable Corporate bookings — 40% of total commission."
 *
 * Unapproved: footnote 1 defines these as PNRs created under an MST affiliate
 * office, which is a property of the booking path, not of the ticket. Nothing
 * in an AIR file distinguishes one. Written so that it is ready the moment
 * something marks them.
 */
export const MST_CORPORATE_SHARE: Rule = {
  ...base,
  id: "MST-SHARE-CORPORATE",
  priority: 950,
  approved: false,
  match: { ticketDesignator: { matches: "^CORP" } },
  award: {
    kind: "share_of_upstream",
    mode: "fraction",
    numerator: "60",
    denominator: "100",
    whenUpstreamNil: "no_share",
  },
  source: cite("3 — Commissionable Corporate bookings", "40% of total commission"),
};

// ---------------------------------------------------------------------------

/** Every clause, in the order the schedule lists them. */
export const MST_SUBAGENT_2026: Rule[] = [
  MST_LY_EXCHANGE_SHARE,
  MST_LY_SHARE,
  MST_DEFAULT_SHARE,
  MST_CORPORATE_SHARE,
  ...MST_NET_FARE_FEES,
  MST_EXCHANGE_FEE,
  MST_REFUND_FEE,
  MST_NON_COMMISSIONABLE_FEE,
  MST_MINIMUM_FEE,
];

/**
 * What the signed agreement does not settle. Each of these is money, and each
 * needs an answer from MST rather than a guess from me.
 */
export const OPEN_QUESTIONS = [
  {
    id: "MST-Q1",
    severity: "high",
    clause: "3 — Commissionable Published fares",
    question:
      "Is MST's 1% struck on the base fare alone, or on base plus YQ/YR? The row " +
      "says 'of the base fare', but El Al's own letter never states its basis, so " +
      "the two contracts may not agree on what the fare is. On a $2,000 ticket " +
      "with $300 of YQ the difference is $3 a ticket to MST and the same to the Agent.",
  },
  {
    id: "MST-Q2",
    severity: "high",
    clause: "3 — Net fares issued on LY",
    question:
      "Which booking classes count as Economy, Premium and Business for the " +
      "$15/$30/$50 rows? The mapping in CABIN_BY_RBD is conventional, not contractual, " +
      "and it decides a $15 fee from a $50 one on every net fare.",
  },
  {
    id: "MST-Q3",
    severity: "high",
    clause: "3 — Net fares, footnote 2",
    question:
      "'Minimum per ticket based on published fare' is now modelled as the point MST " +
      "keeps on a published fare, applied to the fare sold, with the cabin figure as a " +
      "floor. What remains open is the BASIS: is that point taken on the SELLING fare " +
      "(what the passenger paid, which is what the ticket carries) or on the NET fare " +
      "before markup? On a bulk fare with a large markup the two differ substantially — " +
      "on the $12,378 sample with $2,475 of markup, $123.79 against $99.03.",
  },
  {
    id: "MST-Q4",
    severity: "medium",
    clause: "3 — Refunds, footnote 4",
    question:
      "The extra $10 applies 'if MST agents handled the Booking'. Nothing in the " +
      "ticket records who handled it. Is this flagged on the statement?",
  },
  {
    id: "MST-Q5",
    severity: "medium",
    clause: "2 — MST Reserves the Right to",
    question:
      "Is the $10 minimum fee on sub-$10 commission applied automatically, or only " +
      "at MST's discretion? It is filed under rights reserved rather than commitments, " +
      "so it is modelled as an exposure and left unapproved until confirmed.",
  },
  {
    id: "MST-Q6",
    severity: "medium",
    clause: "3 — Promotional net fares",
    question:
      "'50/50 split based on discount' — split of what against what baseline? " +
      "Nothing marks a fare as promotional in the ticket record.",
  },
  {
    id: "MST-Q7",
    severity: "low",
    clause: "2 — MST Commits to",
    question:
      "Commissions are paid Monthly, but statements arrive weekly. Are the weekly " +
      "statements informational, with the month-end settlement authoritative? That " +
      "decides whether a weekly short-payment is a genuine shortfall or just timing.",
  },
] as const;
