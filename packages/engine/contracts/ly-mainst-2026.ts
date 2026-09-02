/**
 * EL AL Agency Commission Letter 2026 — Main St Travel (IATA 33535983)
 * Source: Main_St_ELAL_Commission_Letter_2026.pdf, signed S. Newton Smith, SVP Americas.
 * Validity: tickets issued 15 Jan 2026 – 31 Dec 2026.
 *
 * Every rule below cites the clause it came from. Where the letter does not
 * determine an answer, the rule says so rather than picking one — see
 * OPEN_QUESTIONS at the foot of this file. Nothing here is approved: these
 * rules carry `approved: false` and cannot fire until a human confirms the
 * readings, which is the §11 rule for contract extraction.
 */

import type { Rule } from "../src/types.js";

const DOC = "Main_St_ELAL_Commission_Letter_2026.pdf";
const CONTRACT = "ct_ly_mainst_2026";

/** Issue-date window. Clause: "ticket sales from January 15th, 2026, through
 *  December 31st, 2026" and VALIDITY. Note this bounds the SALE, not travel —
 *  the letter places no limit on travel dates. */
const VALIDITY = { issuedBetween: { from: "2026-01-15", to: "2026-12-31" } };

/**
 * Attachment A — commission by booking class.
 *
 * Note the shape of this table: the discounted business buckets I, D and Z pay
 * 9% while C and J pay 6%. A ticket sold in D earns half again what the same
 * cabin earns in C, which is worth knowing at the point of sale, not only at
 * reconciliation.
 */
export const ATTACHMENT_A: Record<string, string> = {
  I: "9.00", D: "9.00", Z: "9.00",
  K: "7.00", V: "7.00", S: "7.00", L: "7.00", H: "7.00", N: "7.00",
  C: "6.00", J: "6.00", Q: "6.00", B: "6.00", P: "6.00",
  W: "5.00", Y: "5.00", M: "5.00",
  G: "3.00", O: "3.00", U: "3.00",
};

/**
 * The commission itself.
 *
 * Clause 3   rate is set by the ticket RBD, per Attachment A
 * Clause 12.1 applied per half round-trip sector on the class booked
 * Clause 2/7 travel must ORIGINATE in the USA or Canada
 * Clause 4   transatlantic flights must be marketed by EL AL (LY)
 * Clause 10  paid and issued in the USA or Canada
 * Clause 11  validated on EL AL stock (114)
 * Clause 14  the tour code 0NYZE71545 must be present
 */
export const LY_MAINST_COMMISSION: Rule = {
  id: "LY-MAINST-2026-ATTACH-A",
  layer: "carrier_to_host",
  contractId: CONTRACT,
  version: 1,
  priority: 500,
  scope: "half_rt",
  approved: false,
  effective: VALIDITY,
  match: {
    validatingCarrier: "LY",
    marketingCarrier: { in: ["LY"] },
    originIn: ["US", "CA"],
    posCountry: { in: ["US", "CA"] },
    // Clause 14 inverts the usual reading of a tour code. Here it is mandatory
    // and its absence forfeits the commission outright.
    tourCode: { in: ["0NYZE71545"] },
    fareType: { in: ["published"] },
  },
  award: {
    kind: "percent",
    rateTable: { by: "rbd", rates: ATTACHMENT_A, otherwise: "nil" },
    // NOT STATED IN THE LETTER. Base fare alone is the industry default and is
    // what this assumes; see OPEN_QUESTIONS #1. If EL AL computes on base + YQ,
    // every figure this rule produces is understated.
    basis: ["base_fare"],
    rounding: { mode: "half_up" },
  },
  source: { document: DOC, clause: "§3, §12.1, Attachment A", extractedBy: "ai" },
};

/**
 * Clause 7 — "For all flights with travel originating outside the territory no
 * commission will apply."
 *
 * Modelled as an explicit nil rather than left to fall through. A ticket
 * originating in Tel Aviv earns nothing *because the contract says so*, which
 * is a different fact from a ticket no clause covers, and only the first of
 * those is safe to act on.
 */
export const LY_MAINST_ORIGIN_EXCLUSION: Rule = {
  id: "LY-MAINST-2026-NON-US-ORIGIN",
  layer: "carrier_to_host",
  contractId: CONTRACT,
  version: 1,
  priority: 900,
  approved: false,
  effective: VALIDITY,
  match: { validatingCarrier: "LY", originNotIn: ["US", "CA"] },
  award: { kind: "nil" },
  source: { document: DOC, clause: "§7" },
};

/** Clause 14 — no tour code, no commission. Kept separate so the reconciliation
 *  queue can count exactly how much was forfeited to a missing tour code. */
export const LY_MAINST_MISSING_TOUR_CODE: Rule = {
  id: "LY-MAINST-2026-NO-TOUR-CODE",
  layer: "carrier_to_host",
  contractId: CONTRACT,
  version: 1,
  priority: 950,
  approved: false,
  effective: VALIDITY,
  match: {
    validatingCarrier: "LY",
    originIn: ["US", "CA"],
    tourCode: { notIn: ["0NYZE71545"] },
  },
  award: { kind: "nil" },
  source: { document: DOC, clause: "§14" },
};

/**
 * Clause 13 — categories the commission does not apply to.
 * (a) Groups (b) Classified Private Fares (c) Award (d) Free
 * (e) Cash & Points (f) Denied Boarding (g) EMDs and ancillaries
 * (h) anything EL AL designates as limited from time to time
 *
 * (h) is open-ended by design, so the excluded fare bases are data the agency
 * maintains as EL AL issues notices, not a code change.
 */
export const LY_MAINST_EXCLUSIONS: Rule = {
  id: "LY-MAINST-2026-EXCLUSIONS",
  layer: "carrier_to_host",
  contractId: CONTRACT,
  version: 1,
  priority: 980,
  approved: false,
  effective: VALIDITY,
  match: {
    validatingCarrier: "LY",
    fareType: { in: ["group", "private", "consolidator"] },
  },
  award: { kind: "nil" },
  source: { document: DOC, clause: "§13(a),(b)" },
};

export const LY_MAINST_EMD_EXCLUSION: Rule = {
  id: "LY-MAINST-2026-EMD",
  layer: "carrier_to_host",
  contractId: CONTRACT,
  version: 1,
  priority: 990,
  approved: false,
  effective: VALIDITY,
  match: { validatingCarrier: "LY", documentType: { in: ["EMD"] } },
  award: { kind: "nil" },
  source: { document: DOC, clause: "§13(g)" },
};

export const LY_MAINST_2026: Rule[] = [
  LY_MAINST_EMD_EXCLUSION,
  LY_MAINST_EXCLUSIONS,
  LY_MAINST_MISSING_TOUR_CODE,
  LY_MAINST_ORIGIN_EXCLUSION,
  LY_MAINST_COMMISSION,
];

/**
 * What the letter does not settle. Each of these changes real money and none
 * can be resolved by reading the document again.
 */
export const OPEN_QUESTIONS = [
  {
    id: 1,
    severity: "high",
    question: "Is the commission computed on the base fare alone, or on base + YQ/YR?",
    why:
      "The letter never names a basis. On a fare with a 386.00 YQ at 9%, the " +
      "difference is 34.74 per ticket. Across a few thousand tickets a week " +
      "this is the largest single number in the system.",
    assumed: "base fare only",
  },
  {
    id: 2,
    severity: "high",
    question:
      "Clause 8 permits claiming commission at ticketing only, with no retroactive " +
      "settlement. Does that make post-hoc reconciliation unrecoverable for EL AL?",
    why:
      "If so, the product's job is to check tickets BEFORE the ARC report is " +
      "filed, not to find shortfalls afterwards. It changes when the software runs.",
    assumed: "yes — commission not taken at issue is lost",
  },
  {
    id: 3,
    severity: "high",
    question: "How is a half round-trip sector's share of the base fare determined?",
    why:
      "Clause 12.1 prices per half but does not say how to split the fare. An " +
      "even split and a fare-calculation split disagree on any one-way-priced " +
      "or open-jaw itinerary.",
    assumed: "even split unless the fare calculation supplies weights",
  },
  {
    id: 4,
    severity: "medium",
    question: "What governs a half round trip booked in two different classes?",
    why:
      "Clause 12.1 says the rate follows 'the RBD booked', which is undefined " +
      "when a sector mixes classes — common with the domestic add-ons clauses " +
      "5 and 6 expressly permit.",
    assumed: "nothing — the engine reports it rather than choosing",
  },
  {
    id: 5,
    severity: "medium",
    question: "What happens to commission on a refund, exchange or void?",
    why:
      "The letter is silent. Clause 8's ticketing-time rule suggests commission " +
      "follows the coupon, but a full refund almost certainly claws it back.",
    assumed: "pro-rata clawback on the refunded base",
  },
  {
    id: 6,
    severity: "medium",
    question:
      "Clause 5 suspends the whole ticket if coupons are used out of sequence. " +
      "Does EL AL recover commission by debit memo when that happens?",
    why: "If so, commission on a flown ticket is not final until the last coupon is used.",
    assumed: "yes — treat as an ADM risk, not a settled entry",
  },
  {
    id: 7,
    severity: "low",
    question: "Does this letter cover the branch locations in Attachment B?",
    why: "Attachment B was not included in the file supplied.",
    assumed: "yes, all branches under IATA 33535983",
  },
] as const;
