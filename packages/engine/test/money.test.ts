import { describe, expect, it } from "vitest";
import {
  add, allocate, applyFraction, applyRate, formatMoney, MoneyError,
  parseMoney, parseRate, subtract, sum, zero,
} from "../src/money.js";

const usd = (d: string) => parseMoney(d, "USD");

describe("parsing and formatting", () => {
  it("round-trips decimal strings exactly", () => {
    for (const d of ["0.00", "0.01", "2140.00", "-10.00", "999999.99", "0.07"]) {
      expect(formatMoney(usd(d))).toBe(d === "-10.00" ? "-10.00" : d);
    }
  });

  it("accepts grouped input from report files", () => {
    expect(usd("1,234.56").units).toBe(123456n);
  });

  it("handles zero-decimal and three-decimal currencies", () => {
    expect(parseMoney("1500", "JPY").units).toBe(1500n);
    expect(formatMoney(parseMoney("1500", "JPY"))).toBe("1500");
    expect(parseMoney("12.345", "KWD").units).toBe(12345n);
  });

  it("refuses precision the currency cannot hold rather than rounding it away", () => {
    expect(() => usd("10.005")).toThrow(MoneyError);
    expect(() => usd("not a number")).toThrow(MoneyError);
  });

  it("refuses to mix currencies", () => {
    expect(() => add(usd("1.00"), parseMoney("1.00", "EUR"))).toThrow(MoneyError);
  });
});

describe("rates", () => {
  it("parses percentages exactly, without float drift", () => {
    expect(parseRate("8.00")).toBe(8_000_000n);
    expect(parseRate("7.5")).toBe(7_500_000n);
    expect(parseRate("0.125")).toBe(125_000n);
  });

  it("computes the reference case to the cent", () => {
    // The whole system exists to get this line right.
    expect(formatMoney(applyRate(usd("2140.00"), "8.00"))).toBe("171.20");
  });

  it("is immune to the classic float error", () => {
    // 0.07 * 8290 is 580.2999999999999 in IEEE 754.
    expect(formatMoney(applyRate(usd("8290.00"), "7.00"))).toBe("580.30");
  });

  it("applies the rounding mode the contract states", () => {
    // 1.005 rounds up under half_up, down under half_even (to even).
    const basis = usd("20.10");
    expect(formatMoney(applyRate(basis, "5.00", "half_up"))).toBe("1.01");
    expect(formatMoney(applyRate(basis, "5.00", "half_even"))).toBe("1.00");
    expect(formatMoney(applyRate(basis, "5.00", "down"))).toBe("1.00");
    expect(formatMoney(applyRate(basis, "5.00", "up"))).toBe("1.01");
  });

  it("rounds a clawback by magnitude so it mirrors the entry it reverses", () => {
    const forward = applyRate(usd("20.10"), "5.00", "half_up");
    const reverse = applyRate(usd("-20.10"), "5.00", "half_up");
    expect(reverse.units).toBe(-forward.units);
  });
});

describe("fractions", () => {
  it("splits seven points of eight exactly", () => {
    const commission = usd("171.20");
    expect(formatMoney(applyFraction(commission, 7n, 8n))).toBe("149.80");
  });

  it("never loses a cent between share and spread", () => {
    // 0.01 shared 7/8 is 0.00875 — someone has to absorb the fraction.
    const commission = usd("0.01");
    const share = applyFraction(commission, 7n, 8n);
    const spread = subtract(commission, share);
    expect(add(share, spread).units).toBe(commission.units);
  });
});

describe("allocate", () => {
  it("always sums back to the original amount", () => {
    const cases: Array<[string, bigint[]]> = [
      ["100.00", [1n, 1n]],
      ["100.00", [1n, 1n, 1n]],       // 33.34 / 33.33 / 33.33
      ["0.01", [1n, 1n, 1n]],
      ["2140.00", [1345n, 795n]],
      ["-100.00", [1n, 1n, 1n]],
    ];
    for (const [amount, weights] of cases) {
      const total = usd(amount);
      const parts = allocate(total, weights);
      expect(sum(parts, "USD").units).toBe(total.units);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it("hands leftover units to the largest remainders first", () => {
    expect(allocate(usd("100.00"), [1n, 1n, 1n]).map(formatMoney))
      .toEqual(["33.34", "33.33", "33.33"]);
  });

  it("refuses degenerate weightings instead of guessing", () => {
    expect(() => allocate(usd("10.00"), [])).toThrow(MoneyError);
    expect(() => allocate(usd("10.00"), [0n, 0n])).toThrow(MoneyError);
  });
});

describe("sums", () => {
  it("adds an empty list to zero of the stated currency", () => {
    expect(sum([], "USD")).toEqual(zero("USD"));
  });
});
