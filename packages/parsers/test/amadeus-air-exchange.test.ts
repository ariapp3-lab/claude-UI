/**
 * The exchange case — the transaction that breaks manual reconciliation.
 *
 * A reissue carries two fares: the one on the new document and the one already
 * recognised on the ticket it replaces. Commission is owed on the difference,
 * not on the new fare, and Amadeus records exactly what is needed to compute
 * that in the FO element. Reading it is the whole job.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculate, formatMoney } from "@commission/engine";
import { LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { parseAmadeusAir } from "../src/amadeus-air.js";

const SAMPLE = readFileSync(
  fileURLToPath(new URL("./samples/amadeus-air-ly-exchange.air", import.meta.url)),
  "utf8",
);
const r = parseAmadeusAir(SAMPLE);
const f = formatMoney;
const LIVE = LY_MAINST_2026.map((x) => ({ ...x, approved: true }));

describe("the document knows it is a reissue", () => {
  it("reads EXCH from the transaction element, not from the ticket number", () => {
    expect(r.documentType).toBe("EXCH");
    expect(r.ticket.ticketNumber).toBe("114-7508318625");
    expect(r.ticket.issueDate).toBe("2026-09-02");
  });

  it("names the ticket it replaces", () => {
    expect(r.ticket.exchange!.originalTicket).toBe("114-7507683087");
    expect(r.ticket.inRespectOf).toBe("114-7507683087");
  });
});

describe("the FO element carries what netting needs", () => {
  it("reads the original fare, tax and commission off the reissue", () => {
    const x = r.ticket.exchange!;
    expect(f(x.originalBase)).toBe("2022.00");
    expect(f(x.originalTax!)).toBe("117.00");
    // Nothing was recognised on the original, so nothing has to be reversed.
    expect(f(x.originalCommission!)).toBe("0.00");
  });

  it("reads the additional collection and the airline change fee", () => {
    const x = r.ticket.exchange!;
    expect(f(x.additionalCollection!)).toBe("1685.00");
    expect(f(x.changeFee!)).toBe("170.00");
  });

  it("reconciles: original fare plus the added collection is the new fare", () => {
    const x = r.ticket.exchange!;
    expect(x.originalBase.units + x.additionalCollection!.units).toBe(
      r.ticket.baseFare.units,
    );
    expect(f(r.ticket.baseFare)).toBe("3707.00"); // 2022.00 + 1685.00
  });

  it("keeps the change fee out of the fare", () => {
    // 170.00 is a carrier charge collected alongside the ticket. Folding it
    // into the base would invent commissionable value that does not exist.
    expect(r.ticket.baseFare.units).toBe(370700n);
    expect(f(r.ticket.total)).toBe("3824.00"); // 3707.00 + 117.00 tax, no fee
  });
});

describe("the single remaining coupon", () => {
  it("reads TLV–EWR in Q", () => {
    expect(r.ticket.coupons).toHaveLength(1);
    expect(r.ticket.coupons[0]).toMatchObject({
      origin: "TLV", destination: "EWR", rbd: "Q",
      fareBasis: "QPRPMUS", marketingCarrier: "LY", departureDate: "2026-09-03",
    });
  });
});

describe("what the EL AL contract makes of it", () => {
  const w = calculate({ ticket: r.ticket, rules: LIVE });

  it("pays nothing, and the file agrees", () => {
    expect(f(w.carrier.commission)).toBe("0.00");
    expect(f(r.reportedFM!)).toBe("0.00");
  });

  it("pays nothing because the journey originates in Israel", () => {
    // Clause 7. The itinerary is TLV–EWR: whatever else is true of this
    // ticket, travel does not originate in the USA or Canada.
    expect(w.carrier.ruleId).toBe("LY-MAINST-2026-NON-US-ORIGIN");
    expect(w.carrier.clause).toBe("§7");
    expect(w.carrier.outcome).toBe("NIL");
  });

  it("would still pay nothing on origin alone: it is a bulk fare with no tour code", () => {
    expect(r.ticket.bulk).toBe(true);
    expect(r.ticket.fareType).toBe("net");
    expect(r.ticket.tourCode).toBeNull();
    expect(r.ticket.fareCalc).toContain("M/BT");
  });
});

describe("the parser reports what it could not read", () => {
  it("raises no warning it cannot explain", () => {
    const unexpected = r.warnings.filter((w) => !/point of sale inferred/.test(w));
    expect(unexpected).toEqual([]);
  });
});
