/**
 * Money. Integer minor units only — no floating point ever touches an amount.
 *
 * A `Money` is a bigint count of the currency's minor unit (cents for USD)
 * paired with an ISO-4217 code. Every arithmetic helper here is exact; the
 * only place rounding occurs is `applyRate`, and it takes the rounding mode
 * from the contract clause rather than assuming one.
 */

export type CurrencyCode = string;

export interface Money {
  readonly units: bigint;
  readonly currency: CurrencyCode;
}

/** Minor-unit exponent per currency. Defaults to 2; the exceptions are real. */
const MINOR_EXPONENT: Readonly<Record<string, number>> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, XOF: 0, XAF: 0, XPF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

export function minorExponent(currency: CurrencyCode): number {
  return MINOR_EXPONENT[currency.toUpperCase()] ?? 2;
}

export function money(units: bigint | number, currency: CurrencyCode): Money {
  if (typeof units === "number" && !Number.isInteger(units)) {
    throw new MoneyError(`money() needs whole minor units, received ${units}`);
  }
  return { units: BigInt(units), currency: currency.toUpperCase() };
}

export function zero(currency: CurrencyCode): Money {
  return { units: 0n, currency: currency.toUpperCase() };
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Parse a decimal string ("2140.00", "-10.5", "1,234.00") into minor units.
 *
 * Strings, not numbers, are the input format everywhere in this engine:
 * `0.07 * 100` is not 7 in IEEE 754, and a ticket file that says "2140.00"
 * should never become 2139.9999999999998 on its way in.
 */
export function parseMoney(decimal: string, currency: CurrencyCode): Money {
  const exp = minorExponent(currency);
  const cleaned = decimal.trim().replace(/,/g, "").replace(/\s/g, "");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new MoneyError(`cannot parse "${decimal}" as an amount`);
  }
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = m[2] === "" ? "0" : m[2];
  const frac = m[3] ?? "";
  if (frac.length > exp) {
    // More precision than the currency has. Refuse rather than silently round:
    // an input file with sub-cent precision is a data problem, not a rounding one.
    const excess = frac.slice(exp);
    if (/[^0]/.test(excess)) {
      throw new MoneyError(
        `"${decimal}" has more precision than ${currency} supports (${exp} dp)`,
      );
    }
  }
  const padded = (frac + "0".repeat(exp)).slice(0, exp);
  return { units: sign * BigInt(whole + padded), currency: currency.toUpperCase() };
}

/** Render minor units back to a plain decimal string. No grouping, no symbol. */
export function formatMoney(m: Money): string {
  const exp = minorExponent(m.currency);
  const neg = m.units < 0n;
  const abs = (neg ? -m.units : m.units).toString().padStart(exp + 1, "0");
  const whole = abs.slice(0, abs.length - exp) || "0";
  const frac = exp === 0 ? "" : "." + abs.slice(abs.length - exp);
  return `${neg ? "-" : ""}${whole}${frac}`;
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { units: a.units + b.units, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { units: a.units - b.units, currency: a.currency };
}

export function negate(a: Money): Money {
  return { units: -a.units, currency: a.currency };
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency));
}

export function isZero(a: Money): boolean {
  return a.units === 0n;
}

export function isNegative(a: Money): boolean {
  return a.units < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export type RoundingMode = "half_up" | "half_even" | "down" | "up";

/**
 * Divide `numerator` by `denominator` (both scaled integers) applying the
 * given rounding mode. Kept separate from `applyRate` so that share splits,
 * prorates and percentage awards all round through one audited code path.
 */
function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) throw new MoneyError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const q = n / d;
  const r = n % d;
  if (r === 0n) return negative ? -q : q;

  let roundAway: boolean;
  switch (mode) {
    case "down":
      roundAway = false;
      break;
    case "up":
      roundAway = true;
      break;
    case "half_even": {
      const twice = r * 2n;
      roundAway = twice > d || (twice === d && q % 2n === 1n);
      break;
    }
    case "half_up":
    default:
      roundAway = r * 2n >= d;
      break;
  }
  const result = roundAway ? q + 1n : q;
  return negative ? -result : result;
}

/**
 * Apply a percentage rate expressed as a decimal string ("8.00", "7.5").
 *
 * The rate is parsed to an exact integer scaled by 1e6, so 8.00% is
 * 8_000_000 / 100_000_000 of the basis. No float, no drift.
 *
 * `half_up` on the *magnitude* is the ARC/BSP convention: -0.005 rounds to
 * -0.01, matching the way a clawback mirrors the entry it reverses.
 */
const RATE_SCALE = 1_000_000n;

export function parseRate(rate: string): bigint {
  const cleaned = rate.trim().replace(/%$/, "");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new MoneyError(`cannot parse "${rate}" as a rate`);
  }
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = m[2] === "" ? "0" : m[2];
  const frac = ((m[3] ?? "") + "000000").slice(0, 6);
  if ((m[3] ?? "").length > 6) {
    throw new MoneyError(`rate "${rate}" exceeds 6 decimal places`);
  }
  return sign * BigInt(whole + frac);
}

export function applyRate(
  basis: Money,
  rate: string,
  mode: RoundingMode = "half_up",
): Money {
  const scaled = parseRate(rate);
  return {
    units: divideRounded(basis.units * scaled, 100n * RATE_SCALE, mode),
    currency: basis.currency,
  };
}

/**
 * Take `numerator/denominator` of an amount — used for share splits
 * ("7 points of 8") and pro-rata clawbacks.
 */
export function applyFraction(
  amount: Money,
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "half_up",
): Money {
  return {
    units: divideRounded(amount.units * numerator, denominator, mode),
    currency: amount.currency,
  };
}

/**
 * Split an amount into weighted parts whose sum is exactly the original.
 *
 * Used for prorating a base fare across coupons. Largest-remainder
 * allocation: floor every part, then hand the leftover minor units out one
 * at a time in descending remainder order. The invariant that the parts sum
 * to the whole is what keeps a per-coupon rule from inventing or losing a cent.
 */
export function allocate(amount: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new MoneyError("allocate() needs weights");
  if (weights.some((w) => w < 0n)) {
    throw new MoneyError("allocate() weights must be non-negative");
  }
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n) throw new MoneyError("allocate() weights sum to zero");

  const negative = amount.units < 0n;
  const abs = negative ? -amount.units : amount.units;

  const parts = weights.map((w) => (abs * w) / total);
  let remainder = abs - parts.reduce((a, b) => a + b, 0n);

  const order = weights
    .map((w, i) => ({ i, rem: (abs * w) % total }))
    .sort((a, b) => (b.rem === a.rem ? a.i - b.i : b.rem > a.rem ? 1 : -1));

  for (let k = 0; remainder > 0n; k++, remainder--) {
    parts[order[k % order.length].i] += 1n;
  }

  return parts.map((u) => ({
    units: negative ? -u : u,
    currency: amount.currency,
  }));
}
