/**
 * The agency's own term: the consolidator keeps one point.
 *
 * These tests pin what that means in money, on the classes that actually
 * appear on their tickets.
 */

import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { formatMoney, parseMoney } from "../src/money.js";
import type { TicketDocument } from "../src/types.js";
import { ATTACHMENT_A, LY_MAINST_2026 } from "../contracts/ly-mainst-2026.js";
import { AAPPEL_2026, SUB_AGENT_ID, rateCard } from "../contracts/subagent-aappel-2026.js";

const f = formatMoney;
const usd = (d: string) => parseMoney(d, "USD");
const CARRIER = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));
const ALL = [...CARRIER, ...AAPPEL_2026];

function ticket(rbd: string, base: string): TicketDocument {
  return {
    ticketNumber: "114-2400000001", documentType: "TKT", validatingCarrier: "LY",
    iataNumber: "33535983", issueDate: "2026-03-02", posCountry: "US", currency: "USD",
    baseFare: usd(base), taxes: [{ code: "IL", amount: usd("100.00") }],
    total: usd(base), fareType: "published", paxType: "ADT",
    tourCode: "0NYZE71545", subAgentId: SUB_AGENT_ID,
    coupons: [
      { n: 1, origin: "JFK", destination: "TLV", marketingCarrier: "LY", rbd,
        fareBasis: `${rbd}RTUS`, departureDate: "2026-04-14", status: "OK" },
      { n: 2, origin: "TLV", destination: "JFK", marketingCarrier: "LY", rbd,
        fareBasis: `${rbd}RTUS`, departureDate: "2026-04-28", status: "OK" },
    ],
  };
}

describe("the rate card", () => {
  it("gives the sub-agent one point less than Attachment A, in every class", () => {
    for (const row of rateCard()) {
      expect(Number(row.carrierRate) - Number(row.subAgentRate), `RBD ${row.rbd}`).toBeCloseTo(1, 10);
    }
  });

  it("reads the way an agent would want it at the point of sale", () => {
    const by = Object.fromEntries(rateCard().map((r) => [r.rbd, r.subAgentRate]));
    expect(by.D).toBe("8.00");   // 9% carrier
    expect(by.I).toBe("8.00");
    expect(by.Z).toBe("8.00");
    expect(by.S).toBe("6.00");   // 7%
    expect(by.H).toBe("6.00");
    expect(by.C).toBe("5.00");   // 6%
    expect(by.J).toBe("5.00");
    expect(by.Y).toBe("4.00");   // 5%
    expect(by.W).toBe("4.00");
    expect(by.G).toBe("2.00");   // 3%
  });

  it("covers every class the carrier contract lists", () => {
    expect(rateCard()).toHaveLength(Object.keys(ATTACHMENT_A).length);
  });
});

describe("what a ticket actually pays", () => {
  it("splits a D-class fare 8 to the agent, 1 to the consolidator", () => {
    const w = calculate({ ticket: ticket("D", "2000.00"), rules: ALL });
    expect(f(w.carrier.commission)).toBe("180.00");   // 9%
    expect(f(w.subAgent!.commission)).toBe("160.00"); // 8%
    expect(f(w.hostSpread)).toBe("20.00");            // 1 point
  });

  it("keeps the consolidator at exactly one point whatever the class", () => {
    for (const [rbd, rate] of Object.entries(ATTACHMENT_A)) {
      const w = calculate({ ticket: ticket(rbd, "2000.00"), rules: ALL });
      expect(f(w.hostSpread), `RBD ${rbd} at ${rate}%`).toBe("20.00");
    }
  });

  it("never promises the agent more than EL AL paid", () => {
    // The failure mode of the other wording. A residual cannot produce it.
    for (const rbd of Object.keys(ATTACHMENT_A)) {
      const w = calculate({ ticket: ticket(rbd, "2000.00"), rules: ALL });
      expect(w.subAgent!.commission.units).toBeLessThanOrEqual(w.carrier.commission.units);
      expect(w.hostSpread.units).toBeGreaterThanOrEqual(0n);
    }
  });

  it("tracks a carrier rate cut without touching the sub-agent agreement", () => {
    const cut = CARRIER.map((r) =>
      r.id === "LY-MAINST-2026-ATTACH-A" && r.award.rateTable
        ? { ...r, award: { ...r.award, rateTable: { ...r.award.rateTable, rates: { D: "6.00" } } } }
        : r);
    const w = calculate({ ticket: ticket("D", "2000.00"), rules: [...cut, ...AAPPEL_2026] });
    expect(f(w.carrier.commission)).toBe("120.00");   // 6%
    expect(f(w.subAgent!.commission)).toBe("100.00"); // 5% — moved by itself
    expect(f(w.hostSpread)).toBe("20.00");            // still one point
  });
});

describe("the classes that appear on their real tickets", () => {
  it("pays 6% on the S-class EWR–TLV, once the tour code is there", () => {
    const t: TicketDocument = {
      ...ticket("S", "1496.00"),
      coupons: [ticket("S", "1496.00").coupons[0]!],
    };
    const carrier = calculateCarrierLayer(t, CARRIER);
    const w = calculate({ ticket: t, rules: ALL });
    expect(f(carrier.commission)).toBe("104.72");     // 7% of 1496.00
    expect(f(w.subAgent!.commission)).toBe("89.76");  // 6%
    expect(f(w.hostSpread)).toBe("14.96");            // 1 point
  });

  it("pays 4% on the Y-class JFK–TLV–JFK", () => {
    const w = calculate({ ticket: ticket("Y", "3608.00"), rules: ALL });
    expect(f(w.carrier.commission)).toBe("180.40");   // 5%
    expect(f(w.subAgent!.commission)).toBe("144.32"); // 4%
    expect(f(w.hostSpread)).toBe("36.08");
  });

  it("pays nothing where EL AL pays the consolidator nothing", () => {
    const noTourCode = { ...ticket("D", "2000.00"), tourCode: null };
    const w = calculate({ ticket: noTourCode, rules: ALL });
    expect(f(w.carrier.commission)).toBe("0.00");
    expect(f(w.subAgent!.commission)).toBe("0.00");
    expect(w.subAgent!.notes![0]).toMatch(/nothing to pass through|no share to pass through/);
  });
});
