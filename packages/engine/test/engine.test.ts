import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { explain } from "../src/explain.js";
import { formatMoney, parseMoney } from "../src/money.js";
import type { Rule, TicketDocument } from "../src/types.js";
import {
  AA_DOMESTIC_NIL, ALL_RULES, LY_ECONOMY, LY_PREMIUM,
  SA4471_DOMESTIC_FEE, SA4471_LY_SHARE,
  TICKET_AA_DOMESTIC, TICKET_LY_BUSINESS, TICKET_LY_NET_FARE,
} from "./fixtures.js";

const f = formatMoney;

describe("§6 example 1 — LY business, commissionable", () => {
  const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: ALL_RULES });

  it("reproduces the specification's figures to the cent", () => {
    expect(f(w.carrier.basis!)).toBe("2140.00");
    expect(f(w.carrier.commission)).toBe("171.20");
    expect(f(w.subAgent!.commission)).toBe("149.80");
    expect(f(w.hostSpread)).toBe("21.40");
    expect(f(w.netToSubAgent)).toBe("149.80");
  });

  it("excludes YQ from the basis and says so", () => {
    const yq = w.carrier.basisTrace!.find((t) => t.component === "YQ")!;
    expect(yq.included).toBe(false);
    expect(f(yq.amount)).toBe("386.00");
    expect(yq.reason).toMatch(/carrier-imposed/);
    // If YQ had been included the answer would have been 202.08, not 171.20.
    expect(f(w.carrier.commission)).not.toBe("202.08");
  });

  it("cites the clause it applied", () => {
    expect(w.carrier.ruleId).toBe("LY-US-IL-J-2026H1");
    expect(w.carrier.ruleVersion).toBe(3);
    expect(w.carrier.clause).toBe("§4.2(a)");
  });

  it("prefers the premium clause over the economy one on specificity", () => {
    expect(w.carrier.rejected!.map((r) => r.ruleId)).toContain("LY-US-IL-Y-2026H1");
  });

  it("resolves the round trip as a US–IL market, not US–US", () => {
    const market = w.carrier.conditions!.find((c) => c.field === "market")!;
    expect(market.actual).toBe("JFK(US) → TLV(IL)");
    expect(market.passed).toBe(true);
  });

  it("raises no flags", () => {
    expect(w.flags).toEqual([]);
  });
});

describe("§6 example 2 — AA domestic, nil commission with a fee", () => {
  const w = calculate({ ticket: TICKET_AA_DOMESTIC, rules: ALL_RULES });

  it("asserts nil rather than failing to find a rule", () => {
    expect(w.carrier.outcome).toBe("NIL");
    expect(w.carrier.ruleId).toBe("AA-US-DOM-NIL");
    expect(f(w.carrier.commission)).toBe("0.00");
  });

  it("charges the issuing fee and nets the sub-agent negative", () => {
    expect(w.fees).toHaveLength(1);
    expect(w.fees[0]!.ruleId).toBe("SA4471-FEE-DOM");
    expect(f(w.fees[0]!.amount)).toBe("-10.00");
    expect(f(w.netToSubAgent)).toBe("-10.00");
  });

  it("pays no share when there is nothing to share", () => {
    expect(f(w.subAgent!.commission)).toBe("0.00");
    expect(w.subAgent!.notes![0]).toMatch(/no share to divide/);
  });
});

describe("the fee must not fire on commissionable business", () => {
  it("charges no fee on the LY ticket even though the fee rule exists", () => {
    const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: ALL_RULES });
    expect(w.fees).toEqual([]);
  });

  it("charges no fee when the carrier rule is merely missing", () => {
    // A US domestic ticket on a carrier we hold no contract for. The host has
    // not established that it earns nothing — it has established nothing at
    // all — so billing the sub-agent would be inventing a fee.
    const unknownCarrier: TicketDocument = {
      ...TICKET_AA_DOMESTIC,
      ticketNumber: "016-2400000001",
      validatingCarrier: "UA",
      coupons: [{ ...TICKET_AA_DOMESTIC.coupons[0]!, marketingCarrier: "UA" }],
    };
    const w = calculate({ ticket: unknownCarrier, rules: ALL_RULES });
    expect(w.carrier.outcome).toBe("NO_RULE");
    expect(w.fees).toEqual([]);
    expect(w.flags.some((x) => x.code === "NO_RULE")).toBe(true);
  });
});

describe("net fares", () => {
  it("does not pay commission on a ticket carrying a tour code", () => {
    const w = calculate({ ticket: TICKET_LY_NET_FARE, rules: ALL_RULES });
    expect(w.carrier.outcome).toBe("NO_RULE");
  });

  it("rejects on the tour code alone, even where everything else qualifies", () => {
    // Isolate the condition: identical to the qualifying business ticket in
    // every respect except that a tour code is present.
    const tourCodeOnly: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      ticketNumber: "114-2401234998",
      tourCode: "IT6LY12",
    };
    const w = calculateCarrierLayer(tourCodeOnly, [LY_PREMIUM]);
    expect(w.outcome).toBe("NO_RULE");
    expect(w.rejected![0]!.failedOn!.field).toBe("tourCode");
  });
});

describe("the carrier rate flows through to the sub-agent", () => {
  it("moves seven-of-eight to seven-of-six when the contract changes", () => {
    const reduced: Rule = {
      ...LY_PREMIUM,
      id: "LY-US-IL-J-2026H2",
      version: 4,
      award: { ...LY_PREMIUM.award, rate: "6.00" },
    };
    const w = calculate({
      ticket: TICKET_LY_BUSINESS,
      rules: [reduced, SA4471_LY_SHARE],
    });
    // 2140.00 × 6% = 128.40; seven points of six is 128.40 × 7/6 — which is
    // more than the host earned, so the contract as written is now impossible.
    expect(f(w.carrier.commission)).toBe("128.40");
    expect(f(w.subAgent!.commission)).toBe("149.80");
    expect(w.hostSpread.units).toBeLessThan(0n);
  });

  it("keeps the sub-agent whole at a raised carrier rate", () => {
    const raised: Rule = {
      ...LY_PREMIUM, id: "LY-RAISED", version: 5,
      award: { ...LY_PREMIUM.award, rate: "10.00" },
    };
    const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: [raised, SA4471_LY_SHARE] });
    expect(f(w.carrier.commission)).toBe("214.00");
    expect(f(w.subAgent!.commission)).toBe("149.80"); // 214.00 × 7/10
    expect(f(w.hostSpread)).toBe("64.20");
  });
});

describe("ambiguity is refused, not resolved", () => {
  it("returns AMBIGUOUS when two clauses tie on priority and specificity", () => {
    const twin: Rule = { ...LY_PREMIUM, id: "LY-TWIN", version: 1 };
    const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: [LY_PREMIUM, twin] });
    expect(w.carrier.outcome).toBe("AMBIGUOUS");
    expect(f(w.carrier.commission)).toBe("0.00");
    expect(w.flags.some((x) => x.code === "AMBIGUOUS")).toBe(true);
  });

  it("returns INCOMPLETE for an airport the geography table cannot place", () => {
    const unknown: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      coupons: [
        { ...TICKET_LY_BUSINESS.coupons[0]!, origin: "ZZZ" },
        TICKET_LY_BUSINESS.coupons[1]!,
      ],
    };
    const w = calculate({ ticket: unknown, rules: ALL_RULES });
    expect(["INCOMPLETE", "NO_RULE"]).toContain(w.carrier.outcome);
    expect(f(w.carrier.commission)).toBe("0.00");
  });

  it("never fires an unapproved rule", () => {
    const draft: Rule = { ...LY_PREMIUM, approved: false };
    const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: [draft] });
    expect(w.carrier.outcome).toBe("NO_RULE");
    expect(w.carrier.rejected![0]!.reason).toMatch(/not approved/);
  });
});

describe("effective dating", () => {
  it("declines a ticket issued outside the contract window", () => {
    const late: TicketDocument = { ...TICKET_LY_BUSINESS, issueDate: "2026-08-01" };
    const w = calculateCarrierLayer(late, [LY_PREMIUM]);
    expect(w.outcome).toBe("NO_RULE");
    expect(w.rejected![0]!.failedOn!.field).toBe("issueDate");
  });

  it("declines a ticket whose travel straddles the window", () => {
    const straddle: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      coupons: [
        TICKET_LY_BUSINESS.coupons[0]!,
        { ...TICKET_LY_BUSINESS.coupons[1]!, departureDate: "2027-01-04" },
      ],
    };
    const w = calculateCarrierLayer(straddle, [LY_PREMIUM]);
    expect(w.outcome).toBe("NO_RULE");
    expect(w.rejected![0]!.failedOn!.field).toBe("travelDates");
  });
});

const ECONOMY_TICKET: TicketDocument = {
  ...TICKET_LY_BUSINESS,
  ticketNumber: "114-2401111111",
  baseFare: parseMoney("880.00", "USD"),
  coupons: TICKET_LY_BUSINESS.coupons.map((c) => ({
    ...c, rbd: "M", fareBasis: "MLXRTIL",
  })),
};

describe("economy fallback", () => {
  it("applies the 5% clause to an economy ticket on the same market", () => {
    const w = calculate({ ticket: ECONOMY_TICKET, rules: ALL_RULES });
    expect(w.carrier.ruleId).toBe("LY-US-IL-Y-2026H1");
    expect(f(w.carrier.commission)).toBe("44.00"); // 880.00 × 5%
  });

  it("flags the conflict when a 7-point sub-agent sits under a 5-point contract", () => {
    // 880.00 × 7% is 61.60 against a carrier commission of 44.00. The two
    // signed agreements contradict each other; the engine says so rather than
    // choosing a winner.
    const w = calculate({ ticket: ECONOMY_TICKET, rules: ALL_RULES });
    expect(f(w.subAgent!.commission)).toBe("61.60");
    expect(f(w.hostSpread)).toBe("-17.60");
    expect(w.flags.some((x) => /out of pocket/.test(x.message))).toBe(true);
  });

  it("caps the share at the carrier commission when the clause says to", () => {
    const capped: Rule = {
      ...SA4471_LY_SHARE,
      award: { ...SA4471_LY_SHARE.award, capAtUpstream: true },
    };
    const w = calculate({
      ticket: ECONOMY_TICKET,
      rules: [LY_PREMIUM, LY_ECONOMY, capped],
    });
    expect(f(w.subAgent!.commission)).toBe("44.00");
    expect(f(w.hostSpread)).toBe("0.00");
    expect(w.flags).toEqual([]);
  });
});

describe("explanation", () => {
  it("renders a waterfall a human can check against the contract", () => {
    const text = explain(calculate({ ticket: TICKET_LY_BUSINESS, rules: ALL_RULES }));
    expect(text).toContain("114-2401234567");
    expect(text).toContain("2140.00");
    expect(text).toContain("171.20");
    expect(text).toContain("149.80");
    expect(text).toContain("§4.2(a)");
    expect(text).toContain("YQ 386.00");
  });
});

describe("rules unused by these cases still typecheck as a set", () => {
  it("exposes every fixture rule", () => {
    expect(ALL_RULES).toContain(AA_DOMESTIC_NIL);
    expect(ALL_RULES).toContain(SA4471_DOMESTIC_FEE);
    expect(ALL_RULES).toContain(LY_ECONOMY);
  });
});
