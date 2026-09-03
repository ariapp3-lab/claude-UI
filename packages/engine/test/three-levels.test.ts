/**
 * §15 - the three levels priced together.
 *
 * The structure the whole system rests on:
 *
 *   1  airline -> host IATA      varies by route AND class
 *   2  host    -> THIS sub-agent varies by carrier, and per sub-agent
 *   3  host    -> THIS sub-agent fees, by transaction type
 *
 * Level 2 being per sub-agent is the part a single number on the office cannot
 * express: the same host on the same airline keeps two points from one agent
 * and four from another. Level 3 is separate from level 2 because a fee bites
 * whether or not the split paid anything - which is the entire point of a
 * charge on a non-commissionable ticket.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { formatMoney, parseMoney } from "../src/money.js";
import {
  type CarrierContract, type StoredConsolidator, type SubAgentAgreement,
  carrierRulesFor, compileSubAgentRules, newId,
} from "../contracts/config.js";
import type { Coupon, TicketDocument } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function contract(over: Partial<CarrierContract> = {}): CarrierContract {
  return {
    id: "ct-ly",
    carrier: "LY",
    title: "EL AL 2026",
    issuedFrom: "2026-01-01",
    issuedTo: "2026-12-31",
    rates: { Y: "5.00", C: "5.00" },
    includeYq: false,
    requiredTourCode: "",
    originIn: [],
    scope: "ticket",
    excludeFareTypes: [],
    notes: "",
    files: [],
    ...over,
  };
}

function split(over: Partial<SubAgentAgreement["splits"][number]> = {}) {
  return {
    id: newId("sp"), carrier: "*", mode: "residual" as const,
    hostRetainsPoints: "1.00", points: "0.00",
    numerator: "1", denominator: "1", notes: "",
    ...over,
  };
}

function fee(over: Partial<SubAgentAgreement["fees"][number]> = {}) {
  return {
    id: newId("fe"), label: "fee", trigger: "every_ticket" as const,
    carrier: "", fareTypes: [], rbds: [],
    amount: "0", rate: "", basisOf: "commission" as const,
    threshold: "", approved: true, notes: "",
    ...over,
  };
}

function office(over: Partial<StoredConsolidator> = {}): StoredConsolidator {
  return {
    id: "mst", name: "Main St Travel", tenantId: "t1", agency: "Main St Travel",
    iata: "33535983", retainsPoints: "1.00", contracts: [contract()], notes: "",
    ...over,
  };
}

function coupons(rbd: string, from = "JFK", to = "TLV"): Coupon[] {
  return [
    { n: 1, origin: from, destination: to, marketingCarrier: "LY", rbd, fareBasis: "X", departureDate: "2026-04-01", status: "OK" },
    { n: 2, origin: to, destination: from, marketingCarrier: "LY", rbd, fareBasis: "X", departureDate: "2026-04-10", status: "OK" },
  ];
}

function ticket(over: Partial<TicketDocument> = {}): TicketDocument {
  return {
    ticketNumber: "114-2500000001",
    documentType: "TKT",
    validatingCarrier: "LY",
    issueDate: "2026-03-02",
    posCountry: "US",
    currency: "USD",
    baseFare: parseMoney("1000.00", "USD"),
    taxes: [{ code: "YQ", amount: parseMoney("300.00", "USD") }],
    total: parseMoney("1300.00", "USD"),
    fareType: "published",
    paxType: "ADT",
    tourCode: null,
    iataNumber: "33535983",
    subAgentId: "sa",
    coupons: coupons("Y"),
    ...over,
  };
}

const price = (o: StoredConsolidator, t: TicketDocument, subAgentId: string) =>
  calculate({
    ticket: t,
    rules: [...carrierRulesFor(o), ...compileSubAgentRules(o, subAgentId)],
    subAgentId,
  });

// ---------------------------------------------------------------------------

describe("level 2 - two sub-agents, one host, one airline", () => {
  // The case as described: this agent keeps a 2-point split, that one 4.
  const o = office({
    subAgents: [
      {
        id: "ag-a", subAgentId: "appel", name: "A. Appel and Co",
        splits: [split({ carrier: "LY", hostRetainsPoints: "2.00" })],
        fees: [], notes: "", files: [],
      },
      {
        id: "ag-b", subAgentId: "other", name: "Another agency",
        splits: [split({ carrier: "LY", hostRetainsPoints: "4.00" })],
        fees: [], notes: "", files: [],
      },
    ],
  });

  it("pays each sub-agent on its own split", () => {
    // El Al pays 5% of 1,000 = 50. The host keeps 2 from one, 4 from the other.
    const a = price(o, ticket(), "appel");
    const b = price(o, ticket(), "other");

    expect(formatMoney(a.carrier.commission)).toBe("50.00");
    expect(formatMoney(a.subAgent!.commission)).toBe("30.00");
    expect(formatMoney(a.hostSpread)).toBe("20.00");

    expect(formatMoney(b.carrier.commission)).toBe("50.00");
    expect(formatMoney(b.subAgent!.commission)).toBe("10.00");
    expect(formatMoney(b.hostSpread)).toBe("40.00");
  });

  it("keeps the invariant on both", () => {
    for (const id of ["appel", "other"]) {
      const w = price(o, ticket(), id);
      expect(w.subAgent!.commission.units + w.hostSpread.units)
        .toBe(w.carrier.commission.units);
    }
  });

  it("falls back to the office retention for a sub-agent with no agreement", () => {
    const w = price(o, ticket(), "someone-new");
    expect(formatMoney(w.hostSpread)).toBe("10.00");   // office retainsPoints 1.00
  });

  it("cites the split it used, so the number can be checked", () => {
    const w = price(o, ticket(), "appel");
    expect(w.subAgent!.clause).toContain("2.00");
  });
});

describe("level 2 - a split that varies by carrier", () => {
  const o = office({
    contracts: [
      contract(),
      contract({ id: "ct-lh", carrier: "LH", title: "Lufthansa 2026", rates: { Y: "6.00" } }),
    ],
    subAgents: [{
      id: "ag", subAgentId: "appel", name: "A. Appel and Co",
      splits: [
        split({ carrier: "*", hostRetainsPoints: "3.00" }),
        split({ carrier: "LY", hostRetainsPoints: "1.00" }),
      ],
      fees: [], notes: "", files: [],
    }],
  });

  it("prefers the carrier-specific split over the default", () => {
    const ly = price(o, ticket(), "appel");
    expect(formatMoney(ly.hostSpread)).toBe("10.00");   // LY: 1 point
  });

  it("uses the default where no carrier split exists", () => {
    const lh = price(o, ticket({
      validatingCarrier: "LH",
      coupons: coupons("Y").map((c) => ({ ...c, marketingCarrier: "LH" })),
    }), "appel");
    expect(formatMoney(lh.carrier.commission)).toBe("60.00");
    expect(formatMoney(lh.hostSpread)).toBe("30.00");   // default: 3 points
  });

  it("does not leave the two splits tied", () => {
    // A tie would make the engine refuse rather than choose, correctly - so the
    // carrier-specific clause must genuinely outrank the default.
    const w = price(o, ticket(), "appel");
    expect(w.subAgent!.outcome).toBe("CALCULATED");
  });
});

describe("level 3 - fees are independent of the split", () => {
  const o = office({
    contracts: [contract({ requiredTourCode: "0NYZE71545" })],
    subAgents: [{
      id: "ag", subAgentId: "appel", name: "A. Appel and Co",
      splits: [split({ carrier: "LY", hostRetainsPoints: "1.00" })],
      fees: [
        // Scoped to published fares. A net fare is charged the cabin fee below
        // INSTEAD, which is how the real schedule reads -- leaving this
        // unscoped stacks both and quietly bills $60.
        fee({ id: "nc", label: "non-commissionable ticket", trigger: "non_commissionable",
              fareTypes: ["published"], amount: "10.00" }),
        fee({ id: "ex", label: "exchange", trigger: "exchange", amount: "25.00" }),
        fee({ id: "even", label: "even exchange", trigger: "even_exchange", amount: "0.00" }),
        fee({ id: "rf", label: "refund", trigger: "refund", amount: "25.00" }),
        fee({ id: "biz", label: "net fare, business", trigger: "every_ticket",
              fareTypes: ["net"], rbds: ["J", "C", "D", "I", "Z"], amount: "50.00" }),
      ],
      notes: "", files: [],
    }],
  });

  it("charges the non-commissionable fee where the contract established nil", () => {
    // No tour code: the contract forfeits the commission, so nothing is earned
    // and the fee still applies. The agent is down 10.
    const w = price(o, ticket(), "appel");
    expect(w.carrier.outcome).toBe("NIL");
    expect(formatMoney(w.subAgent!.commission)).toBe("0.00");
    expect(formatMoney(w.netToSubAgent)).toBe("-10.00");
  });

  it("charges nothing where the document could not be priced at all", () => {
    // The distinction the fee layer turns on. An unpriced document has
    // established nothing, and billing off it invents a charge.
    const w = price(o, ticket({ validatingCarrier: "XX" }), "appel");
    expect(w.carrier.outcome).toBe("NO_RULE");
    expect(w.fees).toEqual([]);
  });

  it("nets the split and the fee together on a commissionable ticket", () => {
    // Earns 5% of 1,000 = 50, host keeps 1 point = 10, agent gets 40. Business
    // net-fare fee does not apply to a published Y fare.
    const w = price(o, ticket({ tourCode: "0NYZE71545" }), "appel");
    expect(formatMoney(w.subAgent!.commission)).toBe("40.00");
    expect(formatMoney(w.netToSubAgent)).toBe("40.00");
  });

  it("charges the cabin fee on a bulk fare in business", () => {
    const w = price(o, ticket({ fareType: "net", coupons: coupons("J") }), "appel");
    expect(w.fees.map((f) => f.ruleId)).toContain("ag-FEE-biz");
    expect(formatMoney(w.netToSubAgent)).toBe("-50.00");
  });

  it("stacks every matching fee, so overlapping ones must be scoped", () => {
    // Fees are cumulative by design - an exchange fee and a refund fee are
    // genuinely separate charges. The consequence is that two fees which could
    // both describe one ticket will both bill it, and it is the agreement's job
    // to scope them. Pinned here because the failure mode is a silent
    // double-charge rather than an error.
    const unscoped = office({
      contracts: [contract({ requiredTourCode: "0NYZE71545" })],
      subAgents: [{
        id: "ag3", subAgentId: "appel", name: "A. Appel and Co",
        splits: [split({ carrier: "LY" })],
        fees: [
          fee({ id: "nc", label: "non-commissionable", trigger: "non_commissionable", amount: "10.00" }),
          fee({ id: "biz", label: "net fare, business", trigger: "every_ticket",
                fareTypes: ["net"], rbds: ["J"], amount: "50.00" }),
        ],
        notes: "", files: [],
      }],
    });
    const w = price(unscoped, ticket({ fareType: "net", coupons: coupons("J") }), "appel");
    expect(w.fees).toHaveLength(2);
    expect(formatMoney(w.netToSubAgent)).toBe("-60.00");
  });

  it("charges the exchange fee only where something was collected", () => {
    const exch = (collected: string) => ticket({
      documentType: "EXCH",
      tourCode: "0NYZE71545",
      exchange: {
        originalTicket: "114-2500000000",
        originalBase: parseMoney("800.00", "USD"),
        originalCommission: parseMoney("40.00", "USD"),
        additionalCollection: parseMoney(collected, "USD"),
      },
    });
    expect(price(o, exch("200.00"), "appel").fees.map((f) => f.ruleId))
      .toContain("ag-FEE-ex");
    expect(price(o, exch("0.00"), "appel").fees.map((f) => f.ruleId))
      .not.toContain("ag-FEE-ex");
  });

  it("holds an unapproved fee back as exposure", () => {
    const reserved = office({
      contracts: [contract({ requiredTourCode: "0NYZE71545" })],
      subAgents: [{
        id: "ag2", subAgentId: "appel", name: "A. Appel and Co",
        splits: [split({ carrier: "LY" })],
        fees: [fee({ id: "min", label: "minimum fee", trigger: "non_commissionable",
                     amount: "10.00", approved: false })],
        notes: "", files: [],
      }],
    });
    const w = price(reserved, ticket(), "appel");
    expect(w.fees).toEqual([]);
    expect(formatMoney(w.netToSubAgent)).toBe("0.00");
  });
});

describe("level 1 - a rate that varies by route as well as class", () => {
  const o = office({
    contracts: [contract({
      rates: { Y: "5.00", C: "5.00" },
      routeRates: [{
        id: "b1", from: "US", to: "IL", bothWays: true,
        rates: { C: "10.00" }, flatRate: "7.00", notes: "",
      }],
    })],
  });

  it("prices the named market above the general table", () => {
    // "7% on this route, 10% in this class" - the route band wins on JFK-TLV.
    const y = price(o, ticket({ coupons: coupons("Y") }), "x");
    expect(formatMoney(y.carrier.commission)).toBe("70.00");

    const c = price(o, ticket({ coupons: coupons("C") }), "x");
    expect(formatMoney(c.carrier.commission)).toBe("100.00");
  });

  it("falls back to the general table off that market", () => {
    const other = price(o, ticket({ coupons: coupons("Y", "JFK", "LHR") }), "x");
    expect(formatMoney(other.carrier.commission)).toBe("50.00");
  });

  it("covers the reverse direction when the band says both ways", () => {
    const inbound = price(o, ticket({ coupons: coupons("Y", "TLV", "JFK") }), "x");
    expect(formatMoney(inbound.carrier.commission)).toBe("70.00");
  });

  it("does not cover the reverse direction when it does not", () => {
    const oneWay = office({
      contracts: [contract({
        routeRates: [{ id: "b1", from: "US", to: "IL", bothWays: false,
                       rates: {}, flatRate: "7.00", notes: "" }],
      })],
    });
    const inbound = price(oneWay, ticket({ coupons: coupons("Y", "TLV", "JFK") }), "x");
    expect(formatMoney(inbound.carrier.commission)).toBe("50.00");
  });

  it("cites the band, not just a rate", () => {
    const w = price(o, ticket({ coupons: coupons("C") }), "x");
    expect(w.carrier.clause).toContain("C 10.00%");
  });
});

describe("a stated fallback rate on a rate table", () => {
  // "J/C 10%, all others 5%" - how a letter usually reads. Without a fallback
  // every class has to be listed, and any class nobody thought of earns nothing.
  const o = office({
    contracts: [contract({
      rates: {},
      routeRates: [{
        id: "b1", from: "US", to: "IL", bothWays: true,
        rates: { J: "10.00", C: "10.00" }, flatRate: "5.00", notes: "",
      }],
    })],
  });

  it("uses the listed rate for a listed class", () => {
    expect(formatMoney(price(o, ticket({ coupons: coupons("J") }), "x").carrier.commission))
      .toBe("100.00");
  });

  it("uses the fallback for a class nobody listed", () => {
    expect(formatMoney(price(o, ticket({ coupons: coupons("Q") }), "x").carrier.commission))
      .toBe("50.00");
  });

  it("still refuses a sector that genuinely mixes two rates", () => {
    // J at 10 and Q at 5 in one priced sector is undefined by the contract, and
    // a fallback rate does not make it defined.
    const mixed = [
      { ...coupons("J")[0]! },
      { ...coupons("Q")[1]! },
    ];
    const w = price(o, ticket({ coupons: mixed }), "x");
    expect(w.carrier.outcome).toBe("AMBIGUOUS");
  });

  it("says when a rate came from the fallback rather than the table", () => {
    const w = price(o, ticket({ coupons: coupons("Q") }), "x");
    expect(w.carrier.notes!.join(" ")).toContain("fallback");
  });
});
