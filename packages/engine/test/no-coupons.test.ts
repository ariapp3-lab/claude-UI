/**
 * Documents with no flight coupons.
 *
 * An EMD, a void, a refund raised on its own — a live feed carries plenty of
 * them. Every one used to throw out of `calculate`, and in a browser a throw
 * during render unmounts the whole application: the page goes white with
 * nothing to report, and a folder of four thousand good documents is lost to
 * one that had no coupons.
 */

import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { journeyDestination, journeyOrigin, splitHalves, DEFAULT_GEO } from "../src/geo.js";
import { formatMoney, parseMoney } from "../src/money.js";
import type { TicketDocument } from "../src/types.js";
import { LY_MAINST_2026 } from "../contracts/ly-mainst-2026.js";
import { AAPPEL_2026, SUB_AGENT_ID } from "../contracts/subagent-aappel-2026.js";

const RULES = [...LY_MAINST_2026.map((r) => ({ ...r, approved: true })), ...AAPPEL_2026];
const f = formatMoney;

const couponless: TicketDocument = {
  ticketNumber: "114-7599999999",
  documentType: "EMD",
  validatingCarrier: "LY",
  iataNumber: "33535983",
  issueDate: "2026-08-01",
  posCountry: "US",
  currency: "USD",
  baseFare: parseMoney("150.00", "USD"),
  taxes: [{ code: "AP", amount: parseMoney("4.00", "USD") }],
  total: parseMoney("154.00", "USD"),
  fareType: "published",
  paxType: "ADT",
  coupons: [],
};

describe("the geography helpers return nothing rather than throwing", () => {
  it("has no origin and no destination without coupons", () => {
    expect(journeyOrigin([])).toBeNull();
    expect(journeyDestination([], DEFAULT_GEO)).toBeNull();
    expect(splitHalves([], DEFAULT_GEO)).toEqual([]);
  });
});

describe("a document with no coupons is priced, not fatal", () => {
  it("calculates without throwing", () => {
    expect(() => calculateCarrierLayer(couponless, RULES)).not.toThrow();
    expect(() => calculate({ ticket: couponless, rules: RULES, subAgentId: SUB_AGENT_ID }))
      .not.toThrow();
  });

  it("pays nothing, and says the document carries no coupons", () => {
    const w = calculateCarrierLayer(couponless, RULES);
    expect(f(w.commission)).toBe("0.00");
    const failed = (w.rejected ?? []).map((r) => r.failedOn?.actual).filter(Boolean);
    expect(failed.some((a) => /no flight coupons/.test(String(a)))).toBe(true);
  });

  it("carries the sub-agent through without throwing either", () => {
    const w = calculate({ ticket: couponless, rules: RULES, subAgentId: SUB_AGENT_ID });
    expect(f(w.netToSubAgent)).toBe("0.00");
  });

  it("does not take the rest of the batch with it", () => {
    // The failure mode that blanked the page: one bad document among good ones.
    const good: TicketDocument = {
      ...couponless,
      ticketNumber: "114-7500000001",
      documentType: "TKT",
      tourCode: "0NYZE71545",
      baseFare: parseMoney("2000.00", "USD"),
      coupons: [
        { n: 1, origin: "JFK", destination: "TLV", marketingCarrier: "LY", rbd: "D",
          fareBasis: "DRTUS", departureDate: "2026-09-01", status: "OK" },
      ],
    };
    for (const t of [couponless, good, couponless]) {
      expect(() => calculate({ ticket: t, rules: RULES, subAgentId: SUB_AGENT_ID })).not.toThrow();
    }
    expect(f(calculate({ ticket: good, rules: RULES }).carrier.commission)).toBe("180.00");
  });
});
