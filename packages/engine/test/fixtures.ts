/**
 * Fixtures mirroring the worked examples in §6 of the specification.
 *
 * These are the reference cases: if the engine ever stops reproducing them
 * exactly, the specification and the code have diverged and one of them is
 * wrong. Real golden data from the agency's own tickets lands in
 * `fixtures/golden/` and is loaded the same way.
 */

import { parseMoney } from "../src/money.js";
import type { Rule, TicketDocument } from "../src/types.js";

const usd = (d: string) => parseMoney(d, "USD");

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** El Al → host agency: 8% of base fare on US–Israel premium cabins. */
export const LY_PREMIUM: Rule = {
  id: "LY-US-IL-J-2026H1",
  layer: "carrier_to_host",
  contractId: "ct_ly_host_2026",
  version: 3,
  priority: 700,
  scope: "ticket",
  approved: true,
  effective: {
    issuedBetween: { from: "2026-01-01", to: "2026-06-30" },
    travelBetween: { from: "2026-01-01", to: "2026-12-31" },
  },
  match: {
    validatingCarrier: "LY",
    posCountry: "US",
    market: { from: "US", to: "IL", direction: "either" },
    rbd: { in: ["J", "C", "D", "I"] },
    fareBasis: { matches: "^[JCDI]", notMatches: "(PROMO|GRP|IT)" },
    tourCode: { absent: true },
    fareType: { in: ["published"] },
    paxType: { in: ["ADT", "CHD"] },
  },
  award: {
    kind: "percent",
    rate: "8.00",
    basis: ["base_fare"], // YQ deliberately excluded
    rounding: { mode: "half_up" },
  },
  source: { document: "LY-HOST-2026.pdf", clause: "§4.2(a)", page: 7 },
};

/** El Al economy on the same market, at a lower rate — tests specificity. */
export const LY_ECONOMY: Rule = {
  ...LY_PREMIUM,
  id: "LY-US-IL-Y-2026H1",
  priority: 600,
  match: {
    ...LY_PREMIUM.match,
    rbd: { in: ["Y", "B", "M", "H", "K", "L", "Q", "W", "S"] },
    fareBasis: { notMatches: "(PROMO|GRP|IT)" },
  },
  award: { kind: "percent", rate: "5.00", basis: ["base_fare"] },
  source: { document: "LY-HOST-2026.pdf", clause: "§4.2(b)", page: 7 },
};

/** American domestic: nil commission, asserted rather than absent. */
export const AA_DOMESTIC_NIL: Rule = {
  id: "AA-US-DOM-NIL",
  layer: "carrier_to_host",
  contractId: "ct_aa_host_2026",
  version: 1,
  priority: 500,
  approved: true,
  match: {
    validatingCarrier: "AA",
    market: { from: "US", to: "US" },
    fareType: { in: ["published"] },
  },
  award: { kind: "nil" },
  source: { document: "AA-HOST-2026.pdf", clause: "§2.1" },
};

// ---------------------------------------------------------------------------
// Sub-agent 4471
// ---------------------------------------------------------------------------

/** Seven points of whatever El Al awarded the host — expressed relatively. */
export const SA4471_LY_SHARE: Rule = {
  id: "SA4471-LY-DEFAULT",
  layer: "host_to_subagent",
  contractId: "ct_sa4471",
  version: 1,
  priority: 500,
  subAgentId: "sa_4471",
  approved: true,
  match: { validatingCarrier: "LY" },
  award: {
    kind: "share_of_upstream",
    mode: "points",
    points: "7.00",
    whenUpstreamNil: "no_share",
  },
};

/** $10 issuing fee, but only where the host earned nothing. */
export const SA4471_DOMESTIC_FEE: Rule = {
  id: "SA4471-FEE-DOM",
  layer: "host_to_subagent",
  contractId: "ct_sa4471",
  version: 1,
  priority: 600,
  subAgentId: "sa_4471",
  approved: true,
  match: {
    market: { from: "US", to: "US" },
    upstreamCommission: "nil",
  },
  award: {
    kind: "fee",
    amount: "10.00",
    currency: "USD",
    per: "ticket",
    direction: "debit_subagent",
  },
};

export const ALL_RULES: Rule[] = [
  LY_PREMIUM,
  LY_ECONOMY,
  AA_DOMESTIC_NIL,
  SA4471_LY_SHARE,
  SA4471_DOMESTIC_FEE,
];

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/** §6 example 1 — LY JFK–TLV–JFK in C. Expect 171.20 / 149.80 / 21.40. */
export const TICKET_LY_BUSINESS: TicketDocument = {
  ticketNumber: "114-2401234567",
  documentType: "TKT",
  validatingCarrier: "LY",
  iataNumber: "05512345",
  issueDate: "2026-02-11",
  posCountry: "US",
  currency: "USD",
  baseFare: usd("2140.00"),
  taxes: [
    { code: "YQ", amount: usd("386.00") },
    { code: "US", amount: usd("45.80") },
    { code: "AY", amount: usd("11.20") },
    { code: "XF", amount: usd("4.50") },
    { code: "IL", amount: usd("296.80") },
  ],
  total: usd("2884.30"),
  fareType: "published",
  paxType: "ADT",
  tourCode: null,
  subAgentId: "sa_4471",
  coupons: [
    {
      n: 1, origin: "JFK", destination: "TLV",
      marketingCarrier: "LY", operatingCarrier: "LY", flightNumber: "LY028",
      rbd: "C", fareBasis: "CRTUS", departureDate: "2026-03-14", status: "OK",
    },
    {
      n: 2, origin: "TLV", destination: "JFK",
      marketingCarrier: "LY", operatingCarrier: "LY", flightNumber: "LY027",
      rbd: "C", fareBasis: "CRTUS", departureDate: "2026-03-28", status: "OK",
    },
  ],
};

/** §6 example 2 — AA JFK–MIA domestic. Nil commission, $10 fee. */
export const TICKET_AA_DOMESTIC: TicketDocument = {
  ticketNumber: "001-2409876543",
  documentType: "TKT",
  validatingCarrier: "AA",
  issueDate: "2026-02-11",
  posCountry: "US",
  currency: "USD",
  baseFare: usd("218.00"),
  taxes: [
    { code: "ZP", amount: usd("10.20") },
    { code: "AY", amount: usd("11.20") },
    { code: "XF", amount: usd("9.00") },
    { code: "US", amount: usd("16.20") },
  ],
  total: usd("264.60"),
  fareType: "published",
  paxType: "ADT",
  subAgentId: "sa_4471",
  coupons: [
    {
      n: 1, origin: "JFK", destination: "MIA",
      marketingCarrier: "AA", rbd: "Q", fareBasis: "QA21ANE",
      departureDate: "2026-04-02", status: "OK",
    },
  ],
};

/** Same LY market, but sold on a net fare — tour code present, nil commission. */
export const TICKET_LY_NET_FARE: TicketDocument = {
  ...TICKET_LY_BUSINESS,
  ticketNumber: "114-2401234999",
  tourCode: "IT6LY12",
  fareType: "private",
};
