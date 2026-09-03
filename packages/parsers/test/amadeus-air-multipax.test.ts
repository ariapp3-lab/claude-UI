/**
 * One record, three tickets.
 *
 * An AIR record describes one priced itinerary but can carry many passengers,
 * each with their own ticket number. Reading the first T- element and stopping
 * is the difference between reconciling a week's volume and reconciling a third
 * of it — and the shortfall is invisible, because every ticket it does report
 * is correct.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculate, formatMoney } from "@commission/engine";
import { LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { parseAmadeusAir } from "../src/amadeus-air.js";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("./samples/amadeus-air-ly-multipax.air", import.meta.url)),
  "utf8",
);
const r = parseAmadeusAir(SAMPLE);
const f = formatMoney;
const LIVE = LY_MAINST_2026.map((x) => ({ ...x, approved: true }));

describe("every passenger gets a ticket", () => {
  it("reads three tickets, not one", () => {
    expect(r.tickets).toHaveLength(3);
    expect(r.tickets.map((t) => t.ticketNumber)).toEqual([
      "114-7507450808", "114-7507450809", "114-7507450810",
    ]);
  });

  it("keys them to their passenger references", () => {
    expect(r.passengers.map((p) => p.ref)).toEqual(["02", "03", "04"]);
  });

  it("gives every ticket the same itinerary and fare", () => {
    for (const t of r.tickets) {
      expect(t.coupons.map((c) => `${c.origin}-${c.destination} ${c.rbd}`)).toEqual([
        "JFK-TLV Y", "TLV-JFK Y",
      ]);
      expect(f(t.baseFare)).toBe("3608.00");
      expect(f(t.total)).toBe("3725.00");
    }
  });

  it("reads all three as children", () => {
    expect(r.tickets.map((t) => t.paxType)).toEqual(["CHD", "CHD", "CHD"]);
    expect(r.tickets[0].ticketDesignator).toBe("CH");
  });
});

describe("the record is a fragment", () => {
  it("knows it is part 2 of 3 and says the rest is missing", () => {
    expect(r.part).toEqual({ index: 2, of: 3 });
    expect(r.warnings.some((w) => /part 2 of 3/.test(w))).toBe(true);
  });

  it("reconciles the passenger count against the segment status", () => {
    // Segments read OK03 — held for three passengers — and three tickets are
    // present in this part. The other two of the five in the B- element are in
    // the sibling parts.
    expect(r.warnings.filter((w) => /segments are held for/.test(w))).toEqual([]);
    expect(r.tickets).toHaveLength(3);
  });
});

describe("fare basis and ticket designator are two fields", () => {
  it("splits YPRPF3R from CH rather than concatenating them", () => {
    // The M- element reads "YPRPF3R  CH". A fare-basis pattern in a contract
    // clause would never match "YPRPF3R  CH".
    expect(r.tickets[0].coupons[0].fareBasis).toBe("YPRPF3R");
    expect(r.tickets[0].ticketDesignator).toBe("CH");
  });
});

describe("a bulk fare sold at cost", () => {
  it("has no markup: net and selling are identical", () => {
    expect(f(r.tickets[0].netFare!)).toBe("3608.00");
    expect(f(r.tickets[0].baseFare)).toBe("3608.00");
    expect(f(r.passengers[0].markup)).toBe("0.00");
  });

  it("is still a bulk fare, and still earns nothing", () => {
    expect(r.tickets[0].bulk).toBe(true);
    expect(r.tickets[0].fareType).toBe("net");
    expect(r.tickets[0].tourCode).toBeNull();
  });

  it("reads FM*F*0.00 as zero dollars, not zero per cent", () => {
    expect(r.passengers[0].reportedFM).toMatchObject({ kind: "amount" });
    expect(f(r.passengers[0].reportedFM!.amount)).toBe("0.00");
  });
});

describe("what the EL AL contract makes of the three", () => {
  it("pays nothing on any of them, and the file agrees", () => {
    for (const [i, ticket] of r.tickets.entries()) {
      const w = calculate({ ticket, rules: LIVE });
      expect(f(w.carrier.commission), ticket.ticketNumber).toBe("0.00");
      expect(f(r.passengers[i].reportedFM!.amount)).toBe("0.00");
    }
  });

  it("pays nothing because there is no tour code, despite qualifying otherwise", () => {
    // This is the one sample that originates in the USA, is marketed by LY and
    // is in a listed booking class. Y earns 5% under Attachment A — 180.40 on
    // this fare. Clause 14 forfeits all of it for the missing tour code.
    const w = calculate({ ticket: r.tickets[0], rules: LIVE });
    expect(w.carrier.ruleId).toBe("LY-MAINST-2026-NO-TOUR-CODE");
    expect(w.carrier.clause).toBe("§14");
  });

  it("quantifies what the missing tour code costs across all three", () => {
    // Y at 5% of 3608.00 is 180.40 per ticket, were the ticket compliant.
    const withCode = r.tickets.map(
      (t) => calculate({ ticket: { ...t, tourCode: "0NYZE71545", fareType: "published", bulk: false }, rules: LIVE })
        .carrier.commission.units,
    );
    expect(withCode).toEqual([18040n, 18040n, 18040n]);
    expect(withCode.reduce((a, b) => a + b, 0n)).toBe(54120n); // 541.20 across three
  });
});

describe('passenger names', () => {
  it('reads a name per passenger, not one for the record', () => {
    // The sample is redacted, but the shape is the real one: a two-digit
    // passenger reference, the name surname-first, then a type in brackets.
    expect(r.tickets.map((t) => t.passengerName)).toEqual([
      'TESTPAX/ONE', 'TESTPAX/TWO', 'TESTPAX/THREE',
    ]);
  });

  it('splits the title off the given name so a name search still matches', () => {
    // "TESTPAX/ONEMSTR(CHD)" runs the title into the name with no separator.
    expect(r.tickets[0].passengerTitle).toBe('MSTR');
    expect(r.tickets[0].passengerName).not.toMatch(/MSTR/);
  });

  it('does not mistake the passenger type for part of the name', () => {
    expect(r.tickets.every((t) => !/CHD/.test(t.passengerName ?? ''))).toBe(true);
    expect(r.tickets.every((t) => t.paxType === 'CHD')).toBe(true);
  });
});
