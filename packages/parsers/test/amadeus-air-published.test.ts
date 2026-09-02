/**
 * The third real sample: a published-fare exchange out of Zurich.
 *
 * Every assertion here corresponds to a bug this file found. It is the first
 * sample that is not a bulk fare, the first with waitlisted segments, the first
 * with a K-F fare line and a KFTF tax line, the first with two RI lines, and
 * the first where the FM element is a percentage rather than an amount.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculate, formatMoney } from "@commission/engine";
import { LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { parseAmadeusAir } from "../src/amadeus-air.js";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("./samples/amadeus-air-ly-published-exchange.air", import.meta.url)),
  "utf8",
);
const r = parseAmadeusAir(SAMPLE);
const f = formatMoney;
const LIVE = LY_MAINST_2026.map((x) => ({ ...x, approved: true }));

describe("waitlisted segments are not coupons", () => {
  it("reads one ticketed coupon, not five", () => {
    // Four U- elements sit alongside the single H-. They are RQ/HL waitlist
    // requests that were never ticketed; counting them would have priced this
    // ticket five times over.
    expect(r.ticket.coupons).toHaveLength(1);
    expect(r.ticket.coupons[0]).toMatchObject({
      origin: "ZRH", destination: "TLV", rbd: "C", fareBasis: "CF1EU",
      flightNumber: "LY0348", departureDate: "2026-09-03",
    });
  });

  it("says out loud that it ignored them", () => {
    expect(r.warnings.some((w) => /4 waitlisted segment/.test(w))).toBe(true);
  });
});

describe("fare and tax lines vary in shape", () => {
  it("reads a K-F fare line, not only K-B", () => {
    expect(f(r.ticket.baseFare)).toBe("1546.00");
  });

  it("reads a KFTF tax line, not only KFTB", () => {
    expect(r.ticket.taxes.map((t) => `${t.code} ${f(t.amount)}`)).toEqual([
      "AP 8.00", "CH 43.00", "IL 33.87",
    ]);
    expect(f(r.ticket.total)).toBe("1630.87"); // 1546.00 + 84.87
  });
});

describe("the FM element is a percentage here, not an amount", () => {
  it("reads FM*M*5 as five per cent", () => {
    // "FM*G*2475.75A" is a sum of money. "FM*M*5" is a rate. Reading one as
    // the other is wrong by three orders of magnitude.
    expect(r.reportedFM!.kind).toBe("percent");
    expect(r.reportedFM).toMatchObject({ kind: "percent", rate: "5" });
    expect(f(r.reportedFM!.amount)).toBe("77.30"); // 1546.00 × 5%
  });
});

describe("two RI lines, only one of them a fee", () => {
  it("takes the change fee by description, not by position", () => {
    // The first RI line is -707.87, the credit for the exchanged ticket
    // (623.00 base + 84.87 tax). Taking it positionally books a credit as a fee.
    expect(f(r.ticket.exchange!.changeFee!)).toBe("100.00");
  });
});

describe("the exchange arithmetic", () => {
  it("reads the replaced ticket and what it had already earned", () => {
    const x = r.ticket.exchange!;
    expect(x.originalTicket).toBe("114-7502333711");
    expect(f(x.originalBase)).toBe("623.00");
    expect(f(x.originalTax!)).toBe("84.87");
    // 100.00 was already taken on the original — a reissue must net against it.
    expect(f(x.originalCommission!)).toBe("100.00");
  });

  it("agrees with the airline's own ATC block", () => {
    expect(f(r.atc!.originalBase!)).toBe("623.00");
    expect(f(r.atc!.newBase!)).toBe("1546.00");
    expect(f(r.atc!.collectedFareDifference!)).toBe("923.00"); // 1546 − 623
    expect(f(r.atc!.changeFee!)).toBe("100.00");
    expect(f(r.atc!.totalCollected!)).toBe("1023.00");         // 923 + 100
    expect(r.warnings.filter((w) => /^ATC/.test(w))).toEqual([]);
  });

  it("uses the ticketing date, seven weeks after the booking date", () => {
    // D- reads 260715;260902;260902. The first field is the creation date and
    // would place this ticket in a different month entirely.
    expect(r.ticket.issueDate).toBe("2026-09-02");
  });
});

describe("this one is a published fare", () => {
  it("carries real NUC fare components, with no bulk marker", () => {
    expect(r.ticket.bulk).toBe(false);
    expect(r.ticket.fareType).toBe("published");
    expect(r.ticket.fareCalc).toContain("NUC1546.00");
    expect(r.ticket.fareCalc).not.toContain("M/BT");
  });

  it("carries a surface segment", () => {
    // "/-ZRH" is a surface sector: the passenger reached Zurich by other means.
    expect(r.ticket.fareCalc).toContain("/-ZRH");
  });
});

describe("what the EL AL contract makes of it", () => {
  const w = calculate({ ticket: r.ticket, rules: LIVE });

  it("pays nothing: the journey originates in Switzerland", () => {
    expect(w.carrier.outcome).toBe("NIL");
    expect(w.carrier.ruleId).toBe("LY-MAINST-2026-NON-US-ORIGIN");
    expect(w.carrier.clause).toBe("§7");
    expect(f(w.carrier.commission)).toBe("0.00");
  });

  it("disagrees with the 5% the file claims — worth a human's attention", () => {
    // The contract says nil on a ZRH-originating journey; the ticket claims
    // 77.30. This is precisely the variance the reconciliation queue exists
    // for, and the engine states both figures rather than picking one.
    expect(f(r.reportedFM!.amount)).toBe("77.30");
    expect(f(w.carrier.commission)).toBe("0.00");
    expect(r.reportedFM!.amount.units - w.carrier.commission.units).toBe(7730n);
  });
});
