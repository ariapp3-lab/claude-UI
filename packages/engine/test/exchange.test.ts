/**
 * Reissues.
 *
 * A reissue carries the fare of the ticket it replaces plus whatever was
 * collected on top. Commissioning the whole new fare pays a second time on
 * every dollar carried over — invisibly, because the figure it produces is a
 * perfectly plausible commission on a perfectly real fare.
 */

import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { formatMoney, parseMoney } from "../src/money.js";
import type { Rule, TicketDocument } from "../src/types.js";
import { LY_PREMIUM, SA4471_LY_RESIDUAL, TICKET_LY_BUSINESS } from "./fixtures.js";

const f = formatMoney;
const usd = (d: string) => parseMoney(d, "USD");

/** Original: 2140.00 base at 8% = 171.20, already taken. */
const ORIGINAL_COMMISSION = usd("171.20");

/** Reissued to a 2480.00 fare — 340.00 collected on top. */
function reissue(over: Partial<TicketDocument> = {}): TicketDocument {
  return {
    ...TICKET_LY_BUSINESS,
    ticketNumber: "114-2405550001",
    documentType: "EXCH",
    inRespectOf: "114-2401234567",
    baseFare: usd("2480.00"),
    total: usd("3224.30"),
    exchange: {
      originalTicket: "114-2401234567",
      originalBase: usd("2140.00"),
      originalTax: usd("744.30"),
      originalCommission: ORIGINAL_COMMISSION,
      additionalCollection: usd("340.00"),
      changeFee: usd("25.00"),
    },
    ...over,
  };
}

describe("commission is owed on the difference, not the whole new fare", () => {
  const w = calculateCarrierLayer(reissue(), [LY_PREMIUM]);

  it("nets the commission already taken on the replaced ticket", () => {
    // 2480.00 × 8% = 198.40 gross, less the 171.20 already recognised.
    expect(f(w.gross!)).toBe("198.40");
    expect(f(w.priorCommission!)).toBe("171.20");
    expect(f(w.commission)).toBe("27.20");
  });

  it("agrees with commissioning the added collection directly", () => {
    // 340.00 × 8% = 27.20. At an unchanged rate the two readings coincide,
    // which is the check that the netting is doing what it claims.
    expect(f(w.commission)).toBe("27.20");
  });

  it("would have paid 198.40 without netting — 171.20 too much", () => {
    const unnetted: Rule = { ...LY_PREMIUM, exchangeTreatment: "full_fare" };
    const bad = calculateCarrierLayer(reissue(), [unnetted]);
    expect(f(bad.commission)).toBe("198.40");
    expect(bad.commission.units - w.commission.units).toBe(17120n);
  });

  it("says in the trace what it netted and against which ticket", () => {
    expect(w.notes!.some((n) => /less 171\.20 already taken on 114-2401234567/.test(n))).toBe(true);
  });
});

describe("a reissue to a cheaper fare owes commission back", () => {
  const cheaper = reissue({
    baseFare: usd("1200.00"),
    exchange: { ...reissue().exchange!, additionalCollection: null },
  });

  it("produces a negative commission rather than clamping to zero", () => {
    // 1200.00 × 8% = 96.00 against 171.20 already taken.
    const w = calculateCarrierLayer(cheaper, [LY_PREMIUM]);
    expect(f(w.gross!)).toBe("96.00");
    expect(f(w.commission)).toBe("-75.20");
  });

  it("raises it for a human before it lands on a statement", () => {
    const w = calculate({ ticket: cheaper, rules: [LY_PREMIUM, SA4471_LY_RESIDUAL] });
    expect(w.flags.some((x) => /commission is owed back/.test(x.message))).toBe(true);
  });
});

describe("what it refuses to do", () => {
  it("will not pay on a reissue that does not say what the original earned", () => {
    const unknown = reissue({
      exchange: { ...reissue().exchange!, originalCommission: null },
    });
    const w = calculateCarrierLayer(unknown, [LY_PREMIUM]);
    // Assuming zero here is exactly what produces the double payment.
    expect(w.outcome).toBe("INCOMPLETE");
    expect(f(w.commission)).toBe("0.00");
    expect(f(w.gross!)).toBe("198.40");
    expect(w.notes!.some((n) => /cannot be netted without paying twice/.test(n))).toBe(true);
  });

  it("will not pay on a reissue with no record of the replaced ticket at all", () => {
    const orphan = reissue({ exchange: null });
    const w = calculateCarrierLayer(orphan, [LY_PREMIUM]);
    expect(w.outcome).toBe("INCOMPLETE");
    expect(f(w.commission)).toBe("0.00");
  });

  it("stays silent when there was nothing to pay anyway", () => {
    // A reissue that earns nothing needs no netting and raises no incompleteness.
    const nil = reissue({ tourCode: "IT-NET", exchange: null });
    const w = calculateCarrierLayer(nil, [LY_PREMIUM]);
    expect(w.outcome).not.toBe("INCOMPLETE");
    expect(f(w.commission)).toBe("0.00");
  });
});

describe("contracts that commission the added collection instead", () => {
  const addedOnly: Rule = { ...LY_PREMIUM, exchangeTreatment: "added_collection_only" };

  it("applies the rate to the fare difference alone", () => {
    const w = calculateCarrierLayer(reissue(), [addedOnly]);
    expect(f(w.commission)).toBe("27.20"); // 340.00 × 8%
    expect(w.notes!.some((n) => /added collection of 340\.00/.test(n))).toBe(true);
  });

  it("diverges from netting once the rate has changed since the original", () => {
    // The original earned 171.20 at 8%; the reissue is priced at 6%.
    // Netting:           2480.00 × 6% − 171.20 = −22.40, a clawback.
    // Added collection:   340.00 × 6% =  20.40, a payment.
    const atSix = { ...LY_PREMIUM, award: { ...LY_PREMIUM.award, rate: "6.00" } };
    const netted = calculateCarrierLayer(reissue(), [atSix]);
    const added = calculateCarrierLayer(reissue(), [
      { ...atSix, exchangeTreatment: "added_collection_only" },
    ]);
    expect(f(netted.commission)).toBe("-22.40");
    expect(f(added.commission)).toBe("20.40");
  });

  it("refuses when the added collection is not stated", () => {
    const noAdd = reissue({ exchange: { ...reissue().exchange!, additionalCollection: null } });
    const w = calculateCarrierLayer(noAdd, [addedOnly]);
    expect(w.outcome).toBe("INCOMPLETE");
  });
});

describe("the sub-agent's share follows the netted figure", () => {
  it("splits 27.20, not 198.40", () => {
    const w = calculate({ ticket: reissue(), rules: [LY_PREMIUM, SA4471_LY_RESIDUAL] });
    expect(f(w.carrier.commission)).toBe("27.20");
    expect(f(w.subAgent!.commission)).toBe("23.80"); // 7 of 8 points
    expect(f(w.hostSpread)).toBe("3.40");
    expect(w.subAgent!.commission.units + w.hostSpread.units).toBe(w.carrier.commission.units);
  });
});

describe("a straight issue is untouched", () => {
  it("carries gross equal to commission and nets nothing", () => {
    const w = calculateCarrierLayer(TICKET_LY_BUSINESS, [LY_PREMIUM]);
    expect(f(w.commission)).toBe("171.20");
    expect(w.priorCommission).toBeUndefined();
    expect(w.notes!.some((n) => /reissue/.test(n))).toBe(false);
  });
});
