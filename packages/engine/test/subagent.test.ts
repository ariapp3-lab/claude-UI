/**
 * The sub-agent side: how the split is worded, and what the host charges.
 *
 * A sub-agent's real economics are the revenue share *minus* a fee schedule.
 * Getting the share right and ignoring the fees produces a number that is
 * confidently wrong on every transaction that is not a clean issue.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { explain } from "../src/explain.js";
import { formatMoney } from "../src/money.js";
import type { Rule, TicketDocument } from "../src/types.js";
import {
  LY_PREMIUM, SA4471_ADM_FEE, SA4471_EXCHANGE_FEE, SA4471_FEE_SCHEDULE,
  SA4471_LY_RESIDUAL, SA4471_LY_SHARE, SA4471_MERCHANT_FEE, SA4471_REFUND_FEE,
  TICKET_LY_BUSINESS, TICKET_LY_EXCHANGE,
} from "./fixtures.js";

const f = formatMoney;
const at = (rate: string): Rule => ({
  ...LY_PREMIUM, id: `LY-${rate}`, award: { ...LY_PREMIUM.award, rate },
});

describe('"you get 7" and "I keep 1" are not the same agreement', () => {
  it("agree exactly while the carrier pays 8", () => {
    const a = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at("8.00"), SA4471_LY_SHARE] });
    const b = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at("8.00"), SA4471_LY_RESIDUAL] });
    expect(f(a.subAgent!.commission)).toBe("149.80");
    expect(f(b.subAgent!.commission)).toBe("149.80");
  });

  it("diverge the moment the carrier cuts the rate", () => {
    const points = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at("6.00"), SA4471_LY_SHARE] });
    const residual = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at("6.00"), SA4471_LY_RESIDUAL] });

    // "You get 7 points" now promises more than the carrier granted.
    expect(f(points.carrier.commission)).toBe("128.40");
    expect(f(points.subAgent!.commission)).toBe("149.80");
    expect(f(points.hostSpread)).toBe("-21.40");
    expect(points.flags.some((x) => /out of pocket/.test(x.message))).toBe(true);

    // "I keep 1 point" self-corrects: 2140.00 × 5% = 107.00.
    expect(f(residual.subAgent!.commission)).toBe("107.00");
    expect(f(residual.hostSpread)).toBe("21.40");
    expect(residual.flags).toEqual([]);
  });

  it("leaves the sub-agent nothing when the carrier pays less than the host retains", () => {
    const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at("0.50"), SA4471_LY_RESIDUAL] });
    expect(f(w.carrier.commission)).toBe("10.70");
    expect(f(w.subAgent!.commission)).toBe("0.00");
    expect(w.subAgent!.notes![0]).toMatch(/nothing remains for the sub-agent/);
  });

  it("keeps the host's retention exactly one point at any carrier rate", () => {
    for (const rate of ["8.00", "7.00", "5.00", "3.00", "1.50"]) {
      const w = calculate({ ticket: TICKET_LY_BUSINESS, rules: [at(rate), SA4471_LY_RESIDUAL] });
      // One point of 2140.00 is 21.40, whatever the carrier pays.
      expect(f(w.hostSpread), `carrier at ${rate}%`).toBe("21.40");
    }
  });
});

describe("transaction fees", () => {
  const rules = [LY_PREMIUM, SA4471_LY_RESIDUAL, ...SA4471_FEE_SCHEDULE];

  it("charges an exchange fee on a reissue, and not on an issue", () => {
    const issued = calculate({ ticket: TICKET_LY_BUSINESS, rules });
    const exchanged = calculate({ ticket: TICKET_LY_EXCHANGE, rules });

    expect(issued.fees.map((x) => x.label)).toEqual(["merchant fee"]);
    expect(exchanged.fees.map((x) => x.label).sort()).toEqual(["exchange fee", "merchant fee"]);
    expect(f(exchanged.fees.find((x) => x.label === "exchange fee")!.amount)).toBe("-25.00");
  });

  it("stacks every matching fee rather than picking one", () => {
    const w = calculate({ ticket: TICKET_LY_EXCHANGE, rules });
    // 2.50% of 3224.30 = 80.6075 → 80.61, plus the 25.00 exchange fee.
    expect(f(w.fees.find((x) => x.label === "merchant fee")!.amount)).toBe("-80.61");
    const feeTotal = w.fees.reduce((a, x) => a + x.amount.units, 0n);
    expect(feeTotal).toBe(-10561n);
  });

  it("nets the sub-agent to share less every fee", () => {
    const w = calculate({ ticket: TICKET_LY_EXCHANGE, rules });
    // 2480.00 × 8% = 198.40 carrier; residual 7/8 = 173.60 to the sub-agent.
    expect(f(w.carrier.commission)).toBe("198.40");
    expect(f(w.subAgent!.commission)).toBe("173.60");
    expect(f(w.netToSubAgent)).toBe("67.99"); // 173.60 − 25.00 − 80.61 = 67.99
  });

  it("applies the minimum on a percentage fee", () => {
    const cheap: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      baseFare: { units: 4000n, currency: "USD" },
      taxes: [],
      total: { units: 4000n, currency: "USD" },
    };
    const w = calculate({ ticket: cheap, rules: [LY_PREMIUM, SA4471_MERCHANT_FEE] });
    // 2.50% of 40.00 is 1.00, below the 5.00 floor.
    expect(f(w.fees[0]!.amount)).toBe("-5.00");
    expect(w.subAgent).toBeDefined();
  });

  it("charges a fee on a refund rather than rebating one", () => {
    const refund: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      ticketNumber: "114-2405550002",
      documentType: "RFND",
      inRespectOf: "114-2401234567",
      baseFare: { units: -214000n, currency: "USD" },
      taxes: [{ code: "YQ", amount: { units: -38600n, currency: "USD" } }],
      total: { units: -252600n, currency: "USD" },
    };
    const w = calculate({ ticket: refund, rules: [...SA4471_FEE_SCHEDULE, LY_PREMIUM, SA4471_LY_RESIDUAL] });
    const refundFee = w.fees.find((x) => x.label === "refund fee")!;
    const merchant = w.fees.find((x) => x.label === "merchant fee")!;
    expect(f(refundFee.amount)).toBe("-35.00");
    // The merchant fee is taken on the magnitude: a refund still costs the
    // sub-agent the processing charge, it does not hand one back.
    expect(f(merchant.amount)).toBe("-63.15");
  });

  it("charges the ADM handling fee only on a debit memo", () => {
    const adm: TicketDocument = {
      ...TICKET_LY_BUSINESS,
      ticketNumber: "114-2405550003",
      documentType: "ADM",
      baseFare: { units: 0n, currency: "USD" },
      taxes: [],
      total: { units: 12000n, currency: "USD" },
    };
    const w = calculate({ ticket: adm, rules: [SA4471_ADM_FEE, SA4471_EXCHANGE_FEE, SA4471_REFUND_FEE] });
    expect(w.fees.map((x) => x.label)).toEqual(["ADM handling fee"]);
  });
});

describe("the sub-agent's own view", () => {
  it("shows the share and every deduction in one statement", () => {
    const text = explain(
      calculate({
        ticket: TICKET_LY_EXCHANGE,
        rules: [LY_PREMIUM, SA4471_LY_RESIDUAL, ...SA4471_FEE_SCHEDULE],
      }),
    );
    expect(text).toContain("exchange fee");
    expect(text).toContain("merchant fee");
    expect(text).toContain("-25.00");
    expect(text).toContain("67.99");
  });
});
