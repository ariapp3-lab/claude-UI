/**
 * §13 — the MST sub-agent agreement, clause by clause.
 *
 * Every case here is a row of the signed fee schedule, worked by hand from the
 * two contracts together: El Al pays MST, MST keeps its fee, the Agent takes
 * the rest. The numbers are checked against arithmetic done on paper, because
 * the point of the system is that the Agent can argue with a statement.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { formatMoney, parseMoney } from "../src/money.js";
import { LY_MAINST_2026 } from "../contracts/ly-mainst-2026.js";
import { MST_SUBAGENT_2026 } from "../contracts/mst-subagent-2026.js";
import type { Rule, TicketDocument } from "../src/types.js";

/**
 * The El Al letter is filed unapproved until someone confirms the terms, so a
 * test that exercises the fee schedule has to approve it first — otherwise the
 * carrier layer finds no rule and every fee row below is testing nothing. The
 * MST clauses keep their own approval flags: MST-FEE-MINIMUM stays off, which
 * is exactly what the last block here checks.
 */
const RULES: Rule[] = [
  ...LY_MAINST_2026.map((r) => ({ ...r, approved: true })),
  ...MST_SUBAGENT_2026,
];

/** A ticket that satisfies every El Al condition, so the fee rows are isolated. */
function commissionable(over: Partial<TicketDocument> = {}): TicketDocument {
  const baseFare = parseMoney("1000.00", "USD");
  return {
    ticketNumber: "114-2500000001",
    documentType: "TKT",
    validatingCarrier: "LY",
    issueDate: "2026-03-02",
    posCountry: "US",
    currency: "USD",
    baseFare,
    taxes: [{ code: "YQ", amount: parseMoney("300.00", "USD") }],
    total: parseMoney("1300.00", "USD"),
    fareType: "published",
    paxType: "ADT",
    // El Al clause 14 makes the tour code mandatory; without it nothing is due.
    tourCode: "0NYZE71545",
    subAgentId: "subagent",
    coupons: [
      { n: 1, origin: "JFK", destination: "TLV", marketingCarrier: "LY", rbd: "S", fareBasis: "SRT", departureDate: "2026-04-01", status: "OK" },
      { n: 2, origin: "TLV", destination: "JFK", marketingCarrier: "LY", rbd: "S", fareBasis: "SRT", departureDate: "2026-04-15", status: "OK" },
    ],
    ...over,
  };
}

const run = (t: TicketDocument) => calculate({ ticket: t, rules: RULES, subAgentId: "subagent" });

describe("§3 — the commission share", () => {
  it("keeps exactly one point on an LY published fare", () => {
    // El Al files S class at 7% of $1,000 = $70. MST keeps 1% of $1,000 = $10.
    const w = run(commissionable());
    expect(formatMoney(w.carrier.commission)).toBe("70.00");
    expect(formatMoney(w.subAgent!.commission)).toBe("60.00");
    expect(formatMoney(w.hostSpread)).toBe("10.00");
    expect(formatMoney(w.netToSubAgent)).toBe("60.00");
  });

  it("self-corrects when the airline moves the rate", () => {
    // W class files at 5%, not 7%. A residual gives the Agent 4 points without
    // anyone editing the sub-agent contract; a points clause would still say 6.
    const w = run(commissionable({
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd: "W" })),
    }));
    expect(formatMoney(w.carrier.commission)).toBe("50.00");
    expect(formatMoney(w.subAgent!.commission)).toBe("40.00");
    expect(formatMoney(w.hostSpread)).toBe("10.00");
  });

  it("never lets the host keep more than the airline paid", () => {
    // G class files at 3%: $30 to MST, of which MST keeps $10.
    const w = run(commissionable({
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd: "G" })),
    }));
    expect(formatMoney(w.carrier.commission)).toBe("30.00");
    expect(formatMoney(w.subAgent!.commission)).toBe("20.00");
    expect(w.hostSpread.units).toBeLessThanOrEqual(w.carrier.commission.units);
  });
});

describe("§3 — a fare that earns nothing still costs money", () => {
  it("charges $10 on a published fare with no commission due", () => {
    // No tour code: El Al clause 14 forfeits the commission entirely.
    const w = run(commissionable({ tourCode: null }));
    expect(w.carrier.outcome).toBe("NIL");
    expect(formatMoney(w.carrier.commission)).toBe("0.00");
    expect(formatMoney(w.netToSubAgent)).toBe("-10.00");
    expect(w.fees.map((f) => f.ruleId)).toContain("MST-FEE-NONCOMM");
  });

  it("charges $15 on an LY bulk fare in economy, not the $10", () => {
    const w = run(commissionable({ fareType: "bulk", tourCode: null }));
    expect(formatMoney(w.netToSubAgent)).toBe("-15.00");
    expect(w.fees.map((f) => f.ruleId)).toEqual(["MST-FEE-NET-LY-ECONOMY"]);
  });

  it("charges $50 on an LY bulk fare in business", () => {
    const w = run(commissionable({
      fareType: "bulk",
      tourCode: null,
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd: "J" })),
    }));
    expect(formatMoney(w.netToSubAgent)).toBe("-50.00");
  });

  it("charges $20, not $15, on a bulk fare on any other carrier", () => {
    const w = run(commissionable({
      fareType: "bulk",
      validatingCarrier: "LH",
      tourCode: null,
      coupons: commissionable().coupons.map((c) => ({ ...c, marketingCarrier: "LH" })),
    }));
    expect(formatMoney(w.netToSubAgent)).toBe("-20.00");
  });

  it("bills nothing on a document it could not price", () => {
    // The distinction the whole fee layer turns on: a fare established as
    // non-commissionable is billable, a fare nobody has priced is not.
    const w = calculate({
      ticket: commissionable({ validatingCarrier: "XX" }),
      rules: MST_SUBAGENT_2026,
      subAgentId: "subagent",
    });
    expect(w.carrier.outcome).toBe("NO_RULE");
    expect(w.fees).toEqual([]);
    expect(formatMoney(w.netToSubAgent)).toBe("0.00");
  });
});

describe("§3 — per-transaction fees", () => {
  const exchange = (collected: string): TicketDocument =>
    commissionable({
      documentType: "EXCH",
      exchange: {
        originalTicket: "114-2500000000",
        originalBase: parseMoney("800.00", "USD"),
        originalCommission: parseMoney("56.00", "USD"),
        additionalCollection: parseMoney(collected, "USD"),
      },
    });

  it("charges $25 on an exchange that collected a fare difference", () => {
    const w = run(exchange("200.00"));
    expect(w.fees.map((f) => f.ruleId)).toContain("MST-FEE-EXCHANGE");
    expect(formatMoney(w.fees.find((f) => f.ruleId === "MST-FEE-EXCHANGE")!.amount))
      .toBe("-25.00");
  });

  it("charges nothing on an even exchange", () => {
    const w = run(exchange("0.00"));
    expect(w.fees.map((f) => f.ruleId)).not.toContain("MST-FEE-EXCHANGE");
  });

  it("does not read a plain issue as an even exchange", () => {
    // No exchange block at all must not satisfy `additionalCollection: zero`.
    const w = run(commissionable());
    expect(w.fees.map((f) => f.ruleId)).not.toContain("MST-FEE-EXCHANGE");
  });

  it("charges $25 on a refund", () => {
    const t = commissionable({
      documentType: "RFND",
      refund: {
        originalTicket: "114-2500000000",
        originalBase: parseMoney("1000.00", "USD"),
        originalCommission: parseMoney("70.00", "USD"),
        refundedBase: parseMoney("1000.00", "USD"),
      },
    });
    const w = run(t);
    expect(w.fees.map((f) => f.ruleId)).toContain("MST-FEE-REFUND");
  });

  it("nets the exchange share on the fare balance, not the whole new fare", () => {
    // $1,000 new fare against an $800 original already commissioned at $56.
    // El Al owes 7% of 1,000 = $70, less $56 recognised = $14 on this document.
    // MST's point scales to what the document earned, not to a full $10.
    const w = run(exchange("200.00"));
    expect(formatMoney(w.carrier.commission)).toBe("14.00");
    expect(w.subAgent!.commission.units).toBeLessThan(w.carrier.commission.units);
    expect(w.subAgent!.commission.units + w.hostSpread.units)
      .toBe(w.carrier.commission.units);
  });
});

describe("clauses that are not yet safe to spend", () => {
  it("does not apply the discretionary $10 minimum fee", () => {
    // A $150 fare in G class earns 3% = $4.50, under the $10 threshold. The
    // clause is filed under rights reserved, so it is modelled but unapproved.
    const w = run(commissionable({
      baseFare: parseMoney("150.00", "USD"),
      total: parseMoney("450.00", "USD"),
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd: "G" })),
    }));
    expect(formatMoney(w.carrier.commission)).toBe("4.50");
    expect(w.fees.map((f) => f.ruleId)).not.toContain("MST-FEE-MINIMUM");
  });

  it("would charge it once approved, and only under the threshold", () => {
    const approved = RULES.map((r) =>
      r.id === "MST-FEE-MINIMUM" ? { ...r, approved: true } : r,
    );
    const small = commissionable({
      baseFare: parseMoney("150.00", "USD"),
      total: parseMoney("450.00", "USD"),
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd: "G" })),
    });
    const under = calculate({ ticket: small, rules: approved, subAgentId: "subagent" });
    expect(under.fees.map((f) => f.ruleId)).toContain("MST-FEE-MINIMUM");
    // $4.50 earned, MST keeps $1.50 of it, then charges $10: the Agent is down.
    expect(under.netToSubAgent.units).toBeLessThan(0n);

    const large = calculate({ ticket: commissionable(), rules: approved, subAgentId: "subagent" });
    expect(large.fees.map((f) => f.ruleId)).not.toContain("MST-FEE-MINIMUM");
  });
});

describe("§3 footnote 2 — the cabin figure is a floor, not the fee", () => {
  /**
   * On a net or bulk fare the agent marks the fare up and keeps the markup, and
   * MST takes what it would have made had the same fare gone out published with
   * commission. The $15/$30/$50 cabin figures apply only where that comes to
   * less. Getting this backwards understates the charge on every large fare —
   * $50 instead of $123.79 on the sample business ticket.
   */
  const bulk = (base: string, rbd: string): TicketDocument =>
    commissionable({
      fareType: "bulk",
      tourCode: null,
      baseFare: parseMoney(base, "USD"),
      total: parseMoney(base, "USD"),
      coupons: commissionable().coupons.map((c) => ({ ...c, rbd })),
    });

  it("takes the published-fare point where it exceeds the floor", () => {
    // 1% of 12,378.75 = 123.7875 → 123.79 half-up.
    expect(formatMoney(run(bulk("12378.75", "C")).netToSubAgent)).toBe("-123.79");
  });

  it("falls back to the cabin floor on a small fare", () => {
    // 1% of 900.00 = 9.00, under the $15 economy floor.
    expect(formatMoney(run(bulk("900.00", "Y")).netToSubAgent)).toBe("-15.00");
  });

  it("uses the right floor for each cabin", () => {
    // A fare small enough that the floor binds in every cabin.
    expect(formatMoney(run(bulk("100.00", "Y")).netToSubAgent)).toBe("-15.00");
    expect(formatMoney(run(bulk("100.00", "W")).netToSubAgent)).toBe("-30.00");
    expect(formatMoney(run(bulk("100.00", "J")).netToSubAgent)).toBe("-50.00");
  });

  it("takes two points, not one, on a carrier that is not LY", () => {
    const other = run(commissionable({
      fareType: "bulk",
      validatingCarrier: "LH",
      tourCode: null,
      baseFare: parseMoney("10000.00", "USD"),
      total: parseMoney("10000.00", "USD"),
      coupons: commissionable().coupons.map((c) => ({ ...c, marketingCarrier: "LH" })),
    }));
    expect(formatMoney(other.netToSubAgent)).toBe("-200.00");
  });

  it("cites the row of the schedule the charge came from", () => {
    // Traceability is the point: an agent disputing $123.79 needs to land on
    // the net-fares row, not on a bare number.
    const w = run(bulk("12378.75", "C"));
    expect(w.fees[0]!.clause).toContain("Net fares");
  });
});
