/**
 * §12.3 — the same invariants, over the shapes that actually arrive.
 *
 * The generator in invariants.test.ts proves a great deal about one ticket: a
 * published USD round trip, JFK–TLV, C class, no tour code, always an issue.
 * Not one of the five real records looks like that. Four are bulk fares, two
 * originate outside the US, three are exchanges, none carries the tour code —
 * and the browser crashed on a record with no coupons at all.
 *
 * So this generator varies every dimension the real folder varies on, and runs
 * against the real El Al contract rather than a single-rate fixture, because a
 * rate table reaches code paths a flat percentage never does.
 *
 * The assertions here are the ones that must hold no matter what comes out:
 * money that reconciles, a basis that bounds the commission, a reversal that
 * actually reverses, and — above all — no throw. Amounts are the other suites'
 * job; universality is this one's.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "../src/calculate.js";
import { add, formatMoney, money, sum, zero } from "../src/money.js";
import { LY_MAINST_2026, ATTACHMENT_A } from "../contracts/ly-mainst-2026.js";
import type { Coupon, Rule, TicketDocument } from "../src/types.js";
import { SA4471_LY_SHARE } from "./fixtures.js";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T =>
  xs[Math.floor(r() * xs.length)]!;

/** Every class in Attachment A, plus classes the table does not list. */
const RBDS = [...Object.keys(ATTACHMENT_A), "X", "T", "E", "R"] as const;
const DOC_TYPES = ["TKT", "EXCH", "RFND", "VOID", "EMD"] as const;
const FARE_TYPES = ["published", "net", "private", "group"] as const;
const CURRENCIES = ["USD", "EUR", "ILS"] as const;
/** Origins inside and outside the contract's US/CA origination rule. */
const ORIGINS = ["JFK", "EWR", "LAX", "YYZ", "TLV", "ZRH", "LHR", "CDG"] as const;
const TOUR_CODES = [null, "0NYZE71545", "0NYZE00000", ""] as const;

function makeCoupons(r: () => number, currency: string): Coupon[] {
  // Zero coupons is a real shape — an EMD, or a record part that arrived alone.
  const legs = Math.floor(r() * 5);
  const origin = pick(r, ORIGINS);
  const coupons: Coupon[] = [];
  let from = origin;
  for (let n = 1; n <= legs; n += 1) {
    const to = pick(r, ORIGINS);
    coupons.push({
      n,
      origin: from,
      destination: to,
      marketingCarrier: pick(r, ["LY", "LH", "UA"] as const),
      rbd: pick(r, RBDS),
      fareBasis: "GEN",
      departureDate: "2026-03-14",
      status: pick(r, ["OK", "RQ"] as const) as Coupon["status"],
    });
    from = to;
  }
  void currency;
  return coupons;
}

function makeTicket(r: () => number, i: number): TicketDocument {
  const currency = pick(r, CURRENCIES);
  const documentType = pick(r, DOC_TYPES);
  const reversal = documentType === "RFND" || documentType === "VOID";
  const sign = reversal ? -1n : 1n;

  const base = money(sign * BigInt(Math.floor(r() * 900_000)), currency);
  const yq = money(sign * BigInt(Math.floor(r() * 60_000)), currency);
  const tax = money(sign * BigInt(Math.floor(r() * 40_000)), currency);

  return {
    ticketNumber: `114-25${String(i).padStart(8, "0")}`,
    documentType,
    validatingCarrier: pick(r, ["LY", "LH"] as const),
    issueDate: "2026-02-11",
    posCountry: pick(r, ["US", "CA", "IL", "CH"] as const),
    currency,
    baseFare: base,
    taxes: [{ code: "YQ", amount: yq }, { code: "IL", amount: tax }],
    total: add(add(base, yq), tax),
    fareType: pick(r, FARE_TYPES),
    paxType: pick(r, ["ADT", "CHD", "INF"] as const),
    tourCode: pick(r, TOUR_CODES),
    subAgentId: "sa_4471",
    coupons: makeCoupons(r, currency),
  };
}

const RULES: Rule[] = [...LY_MAINST_2026, SA4471_LY_SHARE];
const CASES = 2000;

describe("invariants over every shape that arrives", () => {
  it("never throws, whatever the document looks like", () => {
    const r = rng(31415);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      try {
        calculate({ ticket, rules: RULES });
      } catch (e) {
        throw new Error(
          `case ${i} threw: ${(e as Error).message}\n` +
            `  type=${ticket.documentType} fare=${ticket.fareType} ` +
            `ccy=${ticket.currency} coupons=${ticket.coupons.length} ` +
            `tour=${String(ticket.tourCode)} ` +
            `rbds=${ticket.coupons.map((c) => c.rbd).join("/") || "none"}`,
        );
      }
    }
  });

  it("share + spread equals the carrier commission, in every currency", () => {
    const r = rng(27182);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      if (!w.subAgent) continue;
      const recombined = add(w.subAgent.commission, w.hostSpread);
      expect(
        recombined.units,
        `case ${i}: ${ticket.documentType} ${ticket.currency} ` +
          `carrier=${formatMoney(w.carrier.commission)}`,
      ).toBe(w.carrier.commission.units);
    }
  });

  it("keeps every amount in the document's own currency", () => {
    const r = rng(16180);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      const amounts = [
        w.carrier.commission, w.hostSpread, w.netToSubAgent,
        ...(w.subAgent ? [w.subAgent.commission] : []),
        ...(w.carrier.basis ? [w.carrier.basis] : []),
        ...w.fees.map((f) => f.amount),
      ];
      for (const a of amounts) {
        expect(a.currency, `case ${i} (${ticket.currency})`).toBe(ticket.currency);
      }
    }
  });

  it("never pays more than the basis it was computed on", () => {
    const r = rng(14142);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      if (!w.carrier.basis) continue;
      const commission = w.carrier.commission.units;
      const basis = w.carrier.basis.units;
      // Commission is a fraction of the basis, so it can never exceed it, and
      // it always carries the basis's sign — a reversal must not pay out.
      expect(
        commission >= 0n ? commission <= (basis >= 0n ? basis : -basis) : true,
        `case ${i}: commission ${formatMoney(w.carrier.commission)} ` +
          `on basis ${formatMoney(w.carrier.basis)}`,
      ).toBe(true);
    }
  });

  it("pays nothing on a reversal and nothing negative on an issue", () => {
    const r = rng(17320);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      const c = w.carrier.commission.units;
      if (ticket.documentType === "RFND" || ticket.documentType === "VOID") {
        expect(c <= 0n, `case ${i}: ${ticket.documentType} paid ${formatMoney(w.carrier.commission)}`).toBe(true);
      } else if (ticket.baseFare.units >= 0n) {
        expect(c >= 0n, `case ${i}: ${ticket.documentType} paid ${formatMoney(w.carrier.commission)}`).toBe(true);
      }
    }
  });

  it("is deterministic across the whole space", () => {
    const r = rng(11235);
    for (let i = 0; i < 500; i += 1) {
      const ticket = makeTicket(r, i);
      const a = calculate({ ticket, rules: RULES });
      const b = calculate({ ticket, rules: RULES });
      expect(a.carrier.commission.units).toBe(b.carrier.commission.units);
      expect(a.carrier.outcome).toBe(b.carrier.outcome);
      expect(a.netToSubAgent.units).toBe(b.netToSubAgent.units);
    }
  });

  it("always says why, whatever it decided", () => {
    const r = rng(22360);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      // An outcome with no reasoning attached is one nobody can check against
      // the contract, which is the whole point of the system.
      expect(w.carrier.outcome, `case ${i}`).toBeTruthy();
      if (w.carrier.outcome === "CALCULATED" || w.carrier.outcome === "NIL") {
        expect(w.carrier.ruleId, `case ${i}: ${w.carrier.outcome} cites no rule`).toBeTruthy();
      }
    }
  });

  it("nets a fee schedule without ever inventing money", () => {
    const r = rng(1618);
    for (let i = 0; i < CASES; i += 1) {
      const ticket = makeTicket(r, i);
      const w = calculate({ ticket, rules: RULES });
      if (!w.subAgent) continue;
      const expected = add(
        w.subAgent.commission,
        sum(w.fees.map((f) => f.amount), ticket.currency),
      );
      expect(w.netToSubAgent.units, `case ${i}`).toBe(expected.units);
    }
  });

  it("a document with no coupons decides, rather than crashing", () => {
    // The exact record that white-screened the browser.
    const r = rng(404);
    for (let i = 0; i < 200; i += 1) {
      const ticket: TicketDocument = { ...makeTicket(r, i), coupons: [] };
      const w = calculate({ ticket, rules: RULES });
      expect(w.carrier.outcome).toBeTruthy();
      // With no sectors there is no market to match, so it must not pay.
      expect(w.carrier.commission.units).toBe(0n);
    }
  });

  it("a zero fare is zero in every currency and document type", () => {
    const r = rng(2718);
    for (let i = 0; i < 200; i += 1) {
      const t = makeTicket(r, i);
      const ticket: TicketDocument = {
        ...t,
        baseFare: zero(t.currency),
        taxes: t.taxes.map((x) => ({ code: x.code, amount: zero(t.currency) })),
        total: zero(t.currency),
      };
      const w = calculate({ ticket, rules: RULES });
      expect(w.carrier.commission.units, `case ${i} ${t.currency}`).toBe(0n);
      expect(w.netToSubAgent.units).toBe(0n);
    }
  });
});
