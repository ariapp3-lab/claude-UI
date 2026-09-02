/**
 * Parsing a real Amadeus AIR record.
 *
 * The sample is a genuine EL AL ticket from the agency, with passenger name,
 * date of birth, telephone, email and card details redacted. Every assertion
 * below is a value read off the file, not a value the parser invented.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@commission/engine";
import { parseAmadeusAir } from "../src/amadeus-air.js";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("./samples/amadeus-air-ly-bt.air", import.meta.url)),
  "utf8",
);
const r = parseAmadeusAir(SAMPLE);
const f = formatMoney;

describe("identity", () => {
  it("reads the ticket number, carrier and IATA", () => {
    expect(r.ticket.ticketNumber).toBe("114-7507682876");
    expect(r.ticket.validatingCarrier).toBe("LY");
    // The same IATA number as the EL AL commission letter is issued under.
    expect(r.agencyIata).toBe("33535983");
    expect(r.recordLocator).toBe("BWZ958");
  });

  it("reads the issue date as 28 August 2026", () => {
    expect(r.ticket.issueDate).toBe("2026-08-28");
  });
});

describe("coupons", () => {
  it("reads both sectors with their booking classes", () => {
    expect(r.ticket.coupons).toHaveLength(2);
    const [out, back] = r.ticket.coupons;
    expect(out).toMatchObject({
      n: 1, origin: "JFK", destination: "TLV",
      marketingCarrier: "LY", flightNumber: "LY0002", rbd: "C",
      fareBasis: "CPRPUS", departureDate: "2026-08-31",
    });
    expect(back).toMatchObject({
      n: 2, origin: "TLV", destination: "EWR",
      marketingCarrier: "LY", flightNumber: "LY0023", rbd: "D",
      fareBasis: "DPRPUS", departureDate: "2026-09-03",
    });
  });

  it("carries an open jaw: out of JFK, back into EWR", () => {
    expect(r.ticket.coupons[0].origin).toBe("JFK");
    expect(r.ticket.coupons[1].destination).toBe("EWR");
  });

  it("rolls a departure date past the issue date into the same year", () => {
    // Issued 28 Aug, travelling 31 Aug and 3 Sep — all 2026, no year rollover.
    expect(r.ticket.coupons.every((c) => c.departureDate.startsWith("2026"))).toBe(true);
  });
});

describe("money", () => {
  it("reads the selling fare and the net fare separately", () => {
    expect(f(r.ticket.baseFare)).toBe("12378.75");   // KS — what the passenger paid
    expect(f(r.ticket.netFare!)).toBe("9903.00");    // KN — what the agency owes LY
  });

  it("computes the markup, and it matches the file's own FM element", () => {
    expect(f(r.markup)).toBe("2475.75");
    expect(f(r.reportedFM!)).toBe("2475.75");
  });

  it("explodes XT into its nine components rather than trusting the TAX- line", () => {
    // The TAX- line shows AP 8.00, AY 5.60 and XT 103.40. XT is an aggregate
    // and is useless for a rule that names a tax code.
    expect(r.ticket.taxes).toHaveLength(9);
    expect(r.ticket.taxes.map((t) => `${t.code} ${f(t.amount)}`)).toEqual([
      "AP 8.00", "AY 5.60", "US 23.40", "US 23.40", "XA 3.84",
      "XY 7.00", "YC 7.39", "IL 33.87", "XF 4.50",
    ]);
    // Two separate US lines, which a single-keyed map would have collapsed.
    expect(r.ticket.taxes.filter((t) => t.code === "US")).toHaveLength(2);
    const xt = r.ticket.taxes
      .filter((t) => !["AP", "AY"].includes(t.code))
      .reduce((a, t) => a + t.amount.units, 0n);
    expect(xt).toBe(10340n); // exactly the XT aggregate of 103.40
  });

  it("reconciles to the total stated in the file", () => {
    expect(f(r.ticket.total)).toBe("12495.75");
    expect(r.warnings.filter((w) => /does not match/.test(w))).toEqual([]);
  });

  it("carries no YQ or YR at all", () => {
    // EL AL files its surcharge inside the fare as Q438.00 per direction, not
    // as a YQ tax. On this fare type the base-versus-base+YQ question does not
    // arise, because there is no YQ to argue about.
    expect(r.ticket.taxes.some((t) => t.code === "YQ" || t.code === "YR")).toBe(false);
    expect(r.ticket.fareCalc).toContain("Q438.00");
  });
});

describe("fare type", () => {
  it("detects a bulk fare from M/BT in the fare calculation", () => {
    expect(r.ticket.bulk).toBe(true);
    expect(r.ticket.fareType).toBe("net");
    expect(r.ticket.fareCalc).toContain("M/BT");
  });

  it("finds no tour code on the ticket", () => {
    expect(r.ticket.tourCode).toBeNull();
  });
});

describe("the parser reports rather than defaults", () => {
  it("produces no unexplained warnings on a clean file", () => {
    const unexpected = r.warnings.filter((w) => !/point of sale inferred/.test(w));
    expect(unexpected).toEqual([]);
  });

  it("keeps every line of the source for anything it did not read", () => {
    expect(Object.keys(r.raw)).toContain("SIAB");
    expect(Object.keys(r.raw)).toContain("FV");
  });
});
