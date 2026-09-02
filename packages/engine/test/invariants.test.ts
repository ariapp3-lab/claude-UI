/**
 * §12.2 — invariants that must hold for every input, not just the examples.
 *
 * The generator is seeded and deterministic: a failure here reproduces exactly,
 * and the seed is printed with the case so it can be turned into a fixture.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { add, formatMoney, money, parseMoney, sum, zero } from "../src/money.js";
import type { Money, Rule, TicketDocument } from "../src/types.js";
import { LY_PREMIUM, SA4471_LY_SHARE } from "./fixtures.js";

/** xorshift32 — small, deterministic, adequate for shaping test inputs. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const RATES = ["8.00", "5.00", "7.00", "1.00", "0.50", "12.50", "3.33", "0.01"];
const POINTS = ["7.00", "5.00", "1.00", "0.50", "6.75", "0.01"];

function makeTicket(r: () => number, i: number): TicketDocument {
  // Odd cents on purpose: whole dollars hide rounding bugs.
  const base = money(BigInt(1 + Math.floor(r() * 900_000)), "USD");
  const yq = money(BigInt(Math.floor(r() * 60_000)), "USD");
  const tax = money(BigInt(Math.floor(r() * 40_000)), "USD");
  return {
    ticketNumber: `114-24${String(i).padStart(8, "0")}`,
    documentType: "TKT",
    validatingCarrier: "LY",
    issueDate: "2026-02-11",
    posCountry: "US",
    currency: "USD",
    baseFare: base,
    taxes: [
      { code: "YQ", amount: yq },
      { code: "IL", amount: tax },
    ],
    total: add(add(base, yq), tax),
    fareType: "published",
    paxType: "ADT",
    tourCode: null,
    subAgentId: "sa_4471",
    coupons: [
      {
        n: 1, origin: "JFK", destination: "TLV", marketingCarrier: "LY",
        rbd: "C", fareBasis: "CRTUS", departureDate: "2026-03-14", status: "OK",
      },
      {
        n: 2, origin: "TLV", destination: "JFK", marketingCarrier: "LY",
        rbd: "C", fareBasis: "CRTUS", departureDate: "2026-03-28", status: "OK",
      },
    ],
  };
}

const CASES = 500;

describe("invariants over generated tickets", () => {
  it("share + spread always equals the carrier commission, to the minor unit", () => {
    const r = rng(20260211);
    for (let i = 0; i < CASES; i++) {
      const ticket = makeTicket(r, i);
      const carrierRate = RATES[Math.floor(r() * RATES.length)]!;
      const points = POINTS[Math.floor(r() * POINTS.length)]!;
      const rules: Rule[] = [
        { ...LY_PREMIUM, award: { ...LY_PREMIUM.award, rate: carrierRate } },
        { ...SA4471_LY_SHARE, award: { ...SA4471_LY_SHARE.award, points } },
      ];
      const w = calculate({ ticket, rules });
      const recombined = add(w.subAgent!.commission, w.hostSpread);
      expect(
        recombined.units,
        `seed case ${i}: rate ${carrierRate}, points ${points}, base ${formatMoney(ticket.baseFare)}`,
      ).toBe(w.carrier.commission.units);
    }
  });

  it("never computes commission on a tax code outside the rule's basis", () => {
    const r = rng(70701);
    for (let i = 0; i < CASES; i++) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: [LY_PREMIUM, SA4471_LY_SHARE] });
      // The rule's basis is base_fare alone, so the answer must be reproducible
      // from the base fare with no knowledge of the tax stack at all.
      const included = w.carrier.basisTrace!.filter((t) => t.included);
      expect(included.map((t) => t.component)).toEqual(["base_fare"]);
      expect(w.carrier.basis!.units).toBe(ticket.baseFare.units);
    }
  });

  it("net to sub-agent is exactly their share plus every fee applied", () => {
    const r = rng(4471);
    for (let i = 0; i < CASES; i++) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: [LY_PREMIUM, SA4471_LY_SHARE] });
      const expected = add(
        w.subAgent!.commission,
        sum(w.fees.map((x) => x.amount), "USD"),
      );
      expect(w.netToSubAgent.units).toBe(expected.units);
    }
  });

  it("is deterministic — the same ticket calculates identically every time", () => {
    const ticket = makeTicket(rng(99), 1);
    const rules = [LY_PREMIUM, SA4471_LY_SHARE];
    const runs = Array.from({ length: 5 }, () => calculate({ ticket, rules }));
    for (const w of runs) {
      expect(w.carrier.commission.units).toBe(runs[0]!.carrier.commission.units);
      expect(w.subAgent!.commission.units).toBe(runs[0]!.subAgent!.commission.units);
      expect(w.netToSubAgent.units).toBe(runs[0]!.netToSubAgent.units);
    }
  });

  it("scales linearly: commission on 2× the base is 2× the commission", () => {
    // Not true of every award shape — a cap or a flat amount breaks it — but it
    // must hold for a plain percentage, and catches rounding applied twice.
    const r = rng(2026);
    for (let i = 0; i < 200; i++) {
      const t1 = makeTicket(r, i);
      const doubled: TicketDocument = {
        ...t1,
        baseFare: money(t1.baseFare.units * 2n, "USD"),
      };
      const rules = [LY_PREMIUM];
      const a = calculate({ ticket: t1, rules }).carrier.commission;
      const b = calculate({ ticket: doubled, rules }).carrier.commission;
      // Doubling the basis before rounding can differ from doubling after by
      // at most one minor unit; more than that is a bug.
      const drift = b.units - a.units * 2n;
      expect(drift >= -1n && drift <= 1n).toBe(true);
    }
  });

  it("a zero base fare yields zero commission, never a rounding artefact", () => {
    const ticket: TicketDocument = {
      ...makeTicket(rng(1), 0),
      baseFare: zero("USD"),
    };
    const w = calculate({ ticket, rules: [LY_PREMIUM, SA4471_LY_SHARE] });
    expect(w.carrier.commission.units).toBe(0n);
    expect(w.subAgent!.commission.units).toBe(0n);
    expect(w.netToSubAgent.units).toBe(0n);
  });

  it("commission on a refund mirrors the issue it reverses", () => {
    const r = rng(555);
    for (let i = 0; i < 200; i++) {
      const issued = makeTicket(r, i);
      const refund: TicketDocument = {
        ...issued,
        documentType: "RFND",
        baseFare: money(-issued.baseFare.units, "USD"),
        taxes: issued.taxes.map((t) => ({
          code: t.code,
          amount: money(-t.amount.units, "USD") as Money,
        })),
        total: money(-issued.total.units, "USD"),
      };
      const rules = [{ ...LY_PREMIUM, match: { ...LY_PREMIUM.match } }];
      const a = calculate({ ticket: issued, rules }).carrier.commission;
      const b = calculate({ ticket: refund, rules }).carrier.commission;
      // Issue then full refund must net to nothing. A clawback that rounds the
      // other way leaves a permanent cent behind on every reversed ticket.
      expect(a.units + b.units).toBe(0n);
    }
  });

  it("stays exact at magnitudes where float arithmetic degrades", () => {
    const huge: TicketDocument = {
      ...makeTicket(rng(7), 0),
      baseFare: parseMoney("99999999999.99", "USD"),
    };
    const w = calculate({ ticket: huge, rules: [LY_PREMIUM] });
    // 99,999,999,999.99 × 8% = 7,999,999,999.9992 → 7,999,999,999.9992 rounds
    // half-up at two decimal places to 8,000,000,000.00.
    expect(formatMoney(w.carrier.basis!)).toBe("99999999999.99");
    expect(formatMoney(w.carrier.commission)).toBe("8000000000.00");
  });

  it("keeps a whole batch reconciling to the cent", () => {
    // The real test of a rounding scheme is not one ticket, it is four thousand:
    // a half-cent bias that is invisible per ticket is $20 a week at this volume.
    const r = rng(880811);
    let carrierTotal = 0n;
    let shareTotal = 0n;
    let spreadTotal = 0n;
    for (let i = 0; i < 4000; i++) {
      const w = calculate({
        ticket: makeTicket(r, i),
        rules: [LY_PREMIUM, SA4471_LY_SHARE],
      });
      carrierTotal += w.carrier.commission.units;
      shareTotal += w.subAgent!.commission.units;
      spreadTotal += w.hostSpread.units;
    }
    expect(shareTotal + spreadTotal).toBe(carrierTotal);
  });
});
