/**
 * The first sample that claimed commission.
 *
 * Every earlier file paid zero, so the rate table and clause 12.1 had only ever
 * been tested against tickets written for the purpose. This one is real money:
 * a published one-way, US origin, marketed by EL AL, in a booking class that
 * appears in Attachment A. It is also the first file whose claim the contract
 * disagrees with, twice.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRate, calculate, formatMoney, parseMoney } from "@commission/engine";
import { ATTACHMENT_A, LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { parseAmadeusAir } from "../src/amadeus-air.js";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("./samples/amadeus-air-ly-commission.air", import.meta.url)),
  "utf8",
);
const r = parseAmadeusAir(SAMPLE);
const t = r.tickets[0];
const f = formatMoney;
const LIVE = LY_MAINST_2026.map((x) => ({ ...x, approved: true }));

describe("a published one-way", () => {
  it("reads the itinerary and fare", () => {
    expect(t.ticketNumber).toBe("114-7503646565");
    expect(t.coupons).toHaveLength(1);
    expect(t.coupons[0]).toMatchObject({
      origin: "EWR", destination: "TLV", rbd: "S",
      fareBasis: "SHOC2US", flightNumber: "LY0026", departureDate: "2026-08-01",
    });
    expect(f(t.baseFare)).toBe("1496.00");
    expect(f(t.total)).toBe("1533.50");
  });

  it("is a published fare, with no net/selling split and no bulk marker", () => {
    expect(t.bulk).toBe(false);
    expect(t.fareType).toBe("published");
    expect(t.netFare).toBeNull();
    expect(t.fareCalc).toContain("NUC1496.00");
    expect(t.fareCalc).not.toContain("M/BT");
  });

  it("carries EL AL's surcharge inside the fare as Q, not as a YQ tax", () => {
    // Q100.00 + Q305.00 + a 1091.00 fare component makes the 1496.00 base.
    // There is no YQ line to argue about: the surcharge is already inside the
    // commissionable base whichever way the basis question is settled.
    expect(t.fareCalc).toContain("Q100.00Q305.00");
    expect(t.taxes.map((x) => x.code)).toEqual(["AP", "AY", "US", "XF"]);
    expect(t.taxes.some((x) => x.code === "YQ" || x.code === "YR")).toBe(false);
  });
});

describe("the ticket claims eight per cent", () => {
  it("reads FM*M*8 as a rate, not eight dollars", () => {
    expect(r.passengers[0].reportedFM).toMatchObject({ kind: "percent", rate: "8" });
    expect(f(r.passengers[0].reportedFM!.amount)).toBe("119.68"); // 1496.00 × 8%
  });
});

describe("Attachment A says seven", () => {
  it("rates booking class S at 7%", () => {
    expect(ATTACHMENT_A.S).toBe("7.00");
  });

  it("gives 104.72 where the ticket claims 119.68", () => {
    const atContract = applyRate(t.baseFare, ATTACHMENT_A.S, "half_up");
    expect(f(atContract)).toBe("104.72");
    const claimed = r.passengers[0].reportedFM!.amount;
    expect(f(claimed)).toBe("119.68");
    expect(claimed.units - atContract.units).toBe(1496n); // 14.96 over
  });

  it("the overclaim is exactly one point of the fare", () => {
    // 8% against a filed 7%. One point of 1496.00 is 14.96, which is the whole
    // of the difference — the shape of a rate error, not a basis error.
    expect(applyRate(t.baseFare, "1.00", "half_up").units).toBe(1496n);
  });
});

describe("but the contract pays nothing at all", () => {
  const w = calculate({ ticket: t, rules: LIVE });

  it("forfeits the commission for the missing tour code", () => {
    expect(t.tourCode).toBeNull();
    expect(w.carrier.outcome).toBe("NIL");
    expect(w.carrier.ruleId).toBe("LY-MAINST-2026-NO-TOUR-CODE");
    expect(w.carrier.clause).toBe("§14");
    expect(f(w.carrier.commission)).toBe("0.00");
  });

  it("would pay 104.72 if the tour code were present", () => {
    const compliant = calculate({
      ticket: { ...t, tourCode: "0NYZE71545" },
      rules: LIVE,
    });
    expect(compliant.carrier.outcome).toBe("CALCULATED");
    expect(compliant.carrier.ruleId).toBe("LY-MAINST-2026-ATTACH-A");
    expect(f(compliant.carrier.commission)).toBe("104.72");
  });

  it("prices a one-way as a single sector at the S rate", () => {
    const compliant = calculate({
      ticket: { ...t, tourCode: "0NYZE71545" },
      rules: LIVE,
    });
    expect(compliant.carrier.notes!.some((n) => /one-way/.test(n))).toBe(true);
    expect(compliant.carrier.notes!.some((n) => /S → 7\.00%/.test(n))).toBe(true);
  });

  it("qualifies on every other count", () => {
    const compliant = calculate({ ticket: { ...t, tourCode: "0NYZE71545" }, rules: LIVE });
    const byField = Object.fromEntries(
      compliant.carrier.conditions!.map((c) => [c.field, c.passed]),
    );
    expect(byField.originIn).toBe(true);       // EWR is in the USA
    expect(byField.validatingCarrier).toBe(true);
    expect(byField.marketingCarrier).toBe(true);
    expect(byField.posCountry).toBe(true);
    expect(byField.issueDate).toBe(true);      // inside the 2026 validity window
  });
});

describe("the two dates on this ticket disagree", () => {
  it("takes the D- ticketing date and reports the conflict", () => {
    // D- reads 260801 in all three fields; the TK element says 02AUG. In both
    // exchange samples D-'s second field matched TK exactly, which is why it
    // governs here — but a one-day gap moves a ticket between ARC periods, so
    // it is surfaced rather than absorbed.
    expect(t.issueDate).toBe("2026-08-01");
    expect(r.warnings.some((w) => /TK element says 2026-08-02/.test(w))).toBe(true);
  });
});

describe("a departure just before the issue date is not next year", () => {
  it("keeps a same-week backdated departure in the current year", () => {
    // Ticketed 1 Aug for a 1 Aug departure. A naive roll-forward on
    // "candidate < reference" would have thrown this coupon into 2027 and
    // taken the ticket outside the contract's validity window with it.
    expect(t.coupons[0].departureDate).toBe("2026-08-01");
  });

  it("still rolls a genuine year-end crossing forward", () => {
    const december = SAMPLE
      .replace("D-260801;260801;260801", "D-261220;261220;261220")
      .replace("01AUG1150P0515P02AUG", "04JAN1150P0515P05JAN");
    const rolled = parseAmadeusAir(december);
    expect(rolled.tickets[0].coupons[0].departureDate).toBe("2027-01-04");
  });
});

describe("what a reconciliation queue would raise on this ticket", () => {
  it("two independent variances, each with its own number", () => {
    const claimed = r.passengers[0].reportedFM!.amount;
    const contractRate = applyRate(t.baseFare, ATTACHMENT_A.S, "half_up");
    const contractActual = calculate({ ticket: t, rules: LIVE }).carrier.commission;

    // 1 — the rate applied is not the filed rate for this booking class.
    expect(claimed.units - contractRate.units).toBe(1496n);
    // 2 — and clause 14 forfeits the whole of it regardless.
    expect(contractActual.units).toBe(0n);
    expect(claimed.units - contractActual.units).toBe(11968n);
    expect(f(parseMoney("119.68", "USD"))).toBe("119.68");
  });
});
