/**
 * Refunds and voids.
 *
 * A refund is not a sign flip. Only the fare actually given back is reversed,
 * the cancellation penalty is fare the carrier keeps and is not commissionable,
 * and the split has to be exact — a clawback that rounds the other way from the
 * entry it reverses leaves a permanent cent behind on every refunded ticket.
 */

import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { add, formatMoney, parseMoney } from "../src/money.js";
import type { TicketDocument } from "../src/types.js";
import { LY_PREMIUM, SA4471_LY_RESIDUAL, TICKET_LY_BUSINESS } from "./fixtures.js";

const f = formatMoney;
const usd = (d: string) => parseMoney(d, "USD");
const RULES = [LY_PREMIUM];

/** The ticket being refunded earned 171.20 — 2140.00 at 8%. */
const ORIGINAL_BASE = usd("2140.00");
const ORIGINAL_COMMISSION = usd("171.20");

function refund(over: Partial<NonNullable<TicketDocument["refund"]>> = {}): TicketDocument {
  return {
    ...TICKET_LY_BUSINESS,
    ticketNumber: "114-2409990001",
    documentType: "RFND",
    inRespectOf: "114-2401234567",
    refund: {
      originalTicket: "114-2401234567",
      originalBase: ORIGINAL_BASE,
      originalCommission: ORIGINAL_COMMISSION,
      refundedBase: ORIGINAL_BASE,
      ...over,
    },
  };
}

describe("a full refund reverses the whole of it", () => {
  const w = calculateCarrierLayer(refund(), RULES);

  it("claws back exactly what was recognised", () => {
    expect(f(w.priorCommission!)).toBe("171.20");
    expect(f(w.commission)).toBe("-171.20");
  });

  it("nets an issue and its refund to nothing", () => {
    const issued = calculateCarrierLayer(TICKET_LY_BUSINESS, RULES).commission;
    expect(add(issued, w.commission).units).toBe(0n);
  });

  it("reads as a computed amount, not as nil", () => {
    expect(w.outcome).toBe("CALCULATED");
  });
});

describe("a partial refund reverses only the fare given back", () => {
  // 1070.00 of a 2140.00 fare returned — exactly half.
  const half = calculateCarrierLayer(refund({ refundedBase: usd("1070.00"), partial: true }), RULES);

  it("claws back the refunded share", () => {
    expect(f(half.commission)).toBe("-85.60"); // half of 171.20
  });

  it("says what it reversed and against what", () => {
    expect(half.notes!.some((n) =>
      /1070\.00 of 2140\.00 returned, so 85\.60 of the 171\.20 recognised is reversed/.test(n),
    )).toBe(true);
  });

  it("never loses a cent, at any split", () => {
    // The refunded and retained halves must always sum back to the original.
    for (const part of ["0.01", "1.00", "713.33", "1069.99", "2139.99"]) {
      const w = calculateCarrierLayer(
        refund({ refundedBase: usd(part), partial: true }), RULES,
      );
      const retained = calculateCarrierLayer(
        refund({
          refundedBase: usd(formatMoney({
            units: ORIGINAL_BASE.units - usd(part).units, currency: "USD",
          })),
          partial: true,
        }),
        RULES,
      );
      expect(
        -(w.commission.units + retained.commission.units),
        `split at ${part}`,
      ).toBe(ORIGINAL_COMMISSION.units);
    }
  });
});

describe("the cancellation penalty is not commissionable", () => {
  it("is excluded from the refunded fare and reported", () => {
    // 2140.00 fare, 300.00 penalty retained, 1840.00 returned.
    const w = calculateCarrierLayer(
      refund({ refundedBase: usd("1840.00"), penalty: usd("300.00"), partial: true }),
      RULES,
    );
    expect(f(w.commission)).toBe("-147.20"); // 171.20 × 1840/2140
    expect(w.notes!.some((n) => /penalty of 300\.00 retained by the carrier/.test(n))).toBe(true);
  });

  it("leaves the commission on the retained penalty standing", () => {
    const w = calculateCarrierLayer(
      refund({ refundedBase: usd("1840.00"), penalty: usd("300.00"), partial: true }),
      RULES,
    );
    // 171.20 taken, 147.20 reversed, 24.00 kept — the commission on the fare
    // the carrier kept. Reversing the whole 171.20 would hand back commission
    // on fare that was never refunded.
    expect(ORIGINAL_COMMISSION.units + w.commission.units).toBe(2400n);
  });
});

describe("when the document does not say what was earned", () => {
  it("recomputes it from the contract, and says that it did", () => {
    const w = calculateCarrierLayer(refund({ originalCommission: null }), RULES);
    expect(f(w.commission)).toBe("-171.20");
    expect(w.notes!.some((n) => /recomputed from the contract, not read off the document/.test(n)))
      .toBe(true);
  });

  it("refuses a refund with no record of the ticket it refunds", () => {
    const orphan: TicketDocument = {
      ...TICKET_LY_BUSINESS, documentType: "RFND", refund: null,
    };
    const w = calculateCarrierLayer(orphan, RULES);
    expect(w.outcome).toBe("INCOMPLETE");
    expect(f(w.commission)).toBe("0.00");
  });

  it("still prices a document that already carries negative amounts", () => {
    // Some feeds hand over a refund as a negative ticket rather than a
    // reference. Rounding by magnitude makes that mirror the issue exactly.
    const negative: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      documentType: "RFND",
      baseFare: { units: -214000n, currency: "USD" },
      taxes: TICKET_LY_BUSINESS.taxes.map((t) => ({
        code: t.code, amount: { units: -t.amount.units, currency: "USD" },
      })),
      total: { units: -288430n, currency: "USD" },
    };
    const w = calculateCarrierLayer(negative, RULES);
    expect(f(w.commission)).toBe("-171.20");
  });
});

describe("voids", () => {
  const voided: TicketDocument = {
    ...TICKET_LY_BUSINESS,
    ticketNumber: "114-2409990002",
    documentType: "VOID",
    refund: {
      originalTicket: "114-2401234567",
      originalBase: ORIGINAL_BASE,
      originalCommission: ORIGINAL_COMMISSION,
      refundedBase: ORIGINAL_BASE,
    },
  };

  it("reverses the whole of it — the sale never happened", () => {
    const w = calculateCarrierLayer(voided, RULES);
    expect(f(w.commission)).toBe("-171.20");
    expect(w.notes!.some((n) => /the whole of 171\.20 .* is reversed/.test(n))).toBe(true);
  });

  it("refuses when the voided ticket's commission is unknown", () => {
    const w = calculateCarrierLayer({ ...voided, refund: null }, RULES);
    expect(w.outcome).toBe("INCOMPLETE");
    expect(f(w.commission)).toBe("0.00");
  });
});

describe("the reversal reaches the sub-agent and the flags", () => {
  it("takes the share back too, and the two still sum to the whole", () => {
    const w = calculate({ ticket: refund(), rules: [LY_PREMIUM, SA4471_LY_RESIDUAL] });
    expect(f(w.carrier.commission)).toBe("-171.20");
    expect(f(w.subAgent!.commission)).toBe("-149.80");
    expect(f(w.hostSpread)).toBe("-21.40");
    expect(w.subAgent!.commission.units + w.hostSpread.units).toBe(w.carrier.commission.units);
  });

  it("names the reversal as a refund, not as a reissue", () => {
    const w = calculate({ ticket: refund(), rules: [LY_PREMIUM, SA4471_LY_RESIDUAL] });
    expect(w.flags.some((x) => /^refund reverses 171\.20/.test(x.message))).toBe(true);
  });
});
