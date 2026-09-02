/**
 * The real EL AL 2026 letter, against real ticket shapes.
 *
 * These tests encode what the contract says, including the places where it
 * contradicts the assumptions the engine was first built on. Each one names
 * the clause it is testing so a disagreement can be settled against the paper.
 */

import { describe, expect, it } from "vitest";
import { calculate, calculateCarrierLayer } from "../src/calculate.js";
import { explain } from "../src/explain.js";
import { formatMoney, parseMoney } from "../src/money.js";
import type { Rule, TicketDocument } from "../src/types.js";
import {
  ATTACHMENT_A, LY_MAINST_2026, LY_MAINST_COMMISSION, OPEN_QUESTIONS,
} from "../contracts/ly-mainst-2026.js";

const f = formatMoney;
const usd = (d: string) => parseMoney(d, "USD");
const TOUR_CODE = "0NYZE71545";

/** Approved copies — the filed rules carry approved:false by design. */
const LIVE: Rule[] = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));

function ticket(over: Partial<TicketDocument> = {}): TicketDocument {
  return {
    ticketNumber: "114-2401234567",
    documentType: "TKT",
    validatingCarrier: "LY",
    iataNumber: "33535983",
    issueDate: "2026-03-02",
    posCountry: "US",
    currency: "USD",
    baseFare: usd("2140.00"),
    taxes: [
      { code: "YQ", amount: usd("386.00") },
      { code: "US", amount: usd("45.80") },
      { code: "IL", amount: usd("296.80") },
    ],
    total: usd("2868.60"),
    fareType: "published",
    paxType: "ADT",
    tourCode: TOUR_CODE,
    coupons: [
      { n: 1, origin: "JFK", destination: "TLV", marketingCarrier: "LY",
        rbd: "D", fareBasis: "DRTUS", departureDate: "2026-04-14", status: "OK" },
      { n: 2, origin: "TLV", destination: "JFK", marketingCarrier: "LY",
        rbd: "D", fareBasis: "DRTUS", departureDate: "2026-04-28", status: "OK" },
    ],
    ...over,
  };
}

describe("Attachment A — rate by booking class", () => {
  it("pays 9% in D, not the 8% flat rate the engine first assumed", () => {
    const w = calculateCarrierLayer(ticket(), LIVE);
    expect(w.outcome).toBe("CALCULATED");
    expect(f(w.commission)).toBe("192.60"); // 2140.00 × 9%
  });

  it("prices every class in the table", () => {
    const expected: Record<string, string> = {
      I: "192.60", D: "192.60", Z: "192.60",
      K: "149.80", H: "149.80", N: "149.80",
      C: "128.40", J: "128.40", B: "128.40",
      W: "107.00", Y: "107.00", M: "107.00",
      G: "64.20", O: "64.20", U: "64.20",
    };
    for (const [rbd, amount] of Object.entries(expected)) {
      const t = ticket({ coupons: ticket().coupons.map((c) => ({ ...c, rbd })) });
      expect(f(calculateCarrierLayer(t, LIVE).commission), `RBD ${rbd}`).toBe(amount);
    }
  });

  it("pays more in D than in C for the same cabin", () => {
    // Attachment A rates the discounted business buckets above the full ones.
    expect(ATTACHMENT_A.D).toBe("9.00");
    expect(ATTACHMENT_A.C).toBe("6.00");
  });

  it("pays nothing on a class the airline did not list", () => {
    const t = ticket({ coupons: ticket().coupons.map((c) => ({ ...c, rbd: "A" })) });
    const w = calculateCarrierLayer(t, LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.notes!.some((n) => /not listed in the rate table/.test(n))).toBe(true);
  });
});

describe("clause 12.1 — commission per half round-trip sector", () => {
  it("rates each direction on its own booking class", () => {
    const mixed = ticket({
      coupons: [
        { ...ticket().coupons[0]!, rbd: "D" }, // outbound 9%
        { ...ticket().coupons[1]!, rbd: "W" }, // return 5%
      ],
    });
    const w = calculateCarrierLayer(mixed, LIVE);
    // 1070.00 × 9% = 96.30, plus 1070.00 × 5% = 53.50.
    expect(f(w.commission)).toBe("149.80");
    // A single blended rate on the whole fare would have produced neither.
    expect(f(w.commission)).not.toBe("192.60");
    expect(f(w.commission)).not.toBe("107.00");
  });

  it("splits the fare evenly and loses nothing to rounding", () => {
    const odd = ticket({ baseFare: usd("2140.01") });
    const w = calculateCarrierLayer(odd, LIVE);
    const halves = w.basisTrace!.filter((t) => t.component.includes("–"));
    expect(halves).toHaveLength(2);
    const sum = halves.reduce((a, h) => a + h.amount.units, 0n);
    expect(sum).toBe(214001n);
  });

  it("prices a one-way as a single sector", () => {
    const ow = ticket({ coupons: [ticket().coupons[0]!] });
    const w = calculateCarrierLayer(ow, LIVE);
    expect(f(w.commission)).toBe("192.60"); // whole fare at 9%
    expect(w.notes!.some((n) => /one-way/.test(n))).toBe(true);
  });

  it("refuses to guess when one sector mixes two classes", () => {
    // Clauses 5 and 6 permit domestic add-ons, so this happens in practice and
    // the letter does not say which class governs the sector.
    const addon = ticket({
      coupons: [
        { n: 1, origin: "MIA", destination: "JFK", marketingCarrier: "LY",
          rbd: "Y", fareBasis: "YDOM", departureDate: "2026-04-14", status: "OK" },
        { n: 2, origin: "JFK", destination: "TLV", marketingCarrier: "LY",
          rbd: "D", fareBasis: "DRTUS", departureDate: "2026-04-14", status: "OK" },
        { n: 3, origin: "TLV", destination: "MIA", marketingCarrier: "LY",
          rbd: "D", fareBasis: "DRTUS", departureDate: "2026-04-28", status: "OK" },
      ],
    });
    const w = calculateCarrierLayer(addon, LIVE);
    expect(w.outcome).toBe("AMBIGUOUS");
    expect(f(w.commission)).toBe("0.00");
    expect(w.notes!.join(" ")).toMatch(/mixes booking classes/);
  });
});

describe("clause 14 — the tour code is mandatory, not disqualifying", () => {
  it("pays in full when 0NYZE71545 is present", () => {
    expect(f(calculateCarrierLayer(ticket(), LIVE).commission)).toBe("192.60");
  });

  it("forfeits the whole commission when the tour code is missing", () => {
    const w = calculateCarrierLayer(ticket({ tourCode: null }), LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.ruleId).toBe("LY-MAINST-2026-NO-TOUR-CODE");
    expect(f(w.commission)).toBe("0.00");
  });

  it("forfeits it for the wrong tour code too", () => {
    const w = calculateCarrierLayer(ticket({ tourCode: "0NYZE99999" }), LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.ruleId).toBe("LY-MAINST-2026-NO-TOUR-CODE");
  });

  it("quantifies exactly what a missing tour code costs", () => {
    const withCode = calculateCarrierLayer(ticket(), LIVE).commission;
    const without = calculateCarrierLayer(ticket({ tourCode: null }), LIVE).commission;
    expect(withCode.units - without.units).toBe(19260n); // 192.60 forfeited
  });
});

describe("clauses 2 and 7 — origination, not market", () => {
  it("pays on travel originating in the USA", () => {
    expect(calculateCarrierLayer(ticket(), LIVE).outcome).toBe("CALCULATED");
  });

  it("pays on travel originating in Canada", () => {
    const yyz = ticket({
      posCountry: "CA",
      coupons: [
        { ...ticket().coupons[0]!, origin: "YYZ" },
        { ...ticket().coupons[1]!, destination: "YYZ" },
      ],
    });
    expect(calculateCarrierLayer(yyz, LIVE).outcome).toBe("CALCULATED");
  });

  it("pays nothing on the mirror journey out of Tel Aviv", () => {
    // The reverse of a qualifying trip. A bidirectional market test would have
    // paid this; clause 7 does not.
    const exTlv = ticket({
      coupons: [
        { ...ticket().coupons[0]!, origin: "TLV", destination: "JFK" },
        { ...ticket().coupons[1]!, origin: "JFK", destination: "TLV" },
      ],
    });
    const w = calculateCarrierLayer(exTlv, LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.ruleId).toBe("LY-MAINST-2026-NON-US-ORIGIN");
    expect(w.clause).toBe("§7");
  });
});

describe("clause 4 — marketed by EL AL", () => {
  it("pays nothing when a sector is marketed by another carrier", () => {
    const codeshare = ticket({
      coupons: [
        { ...ticket().coupons[0]!, marketingCarrier: "AA", operatingCarrier: "LY" },
        ticket().coupons[1]!,
      ],
    });
    const w = calculateCarrierLayer(codeshare, LIVE);
    expect(w.outcome).not.toBe("CALCULATED");
  });
});

describe("clause 13 — exclusions", () => {
  it("pays nothing on a group fare", () => {
    const w = calculateCarrierLayer(ticket({ fareType: "group" }), LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.clause).toBe("§13(a),(b)");
  });

  it("pays nothing on a classified private fare", () => {
    expect(calculateCarrierLayer(ticket({ fareType: "private" }), LIVE).outcome).toBe("NIL");
  });

  it("pays nothing on an EMD or ancillary", () => {
    const w = calculateCarrierLayer(ticket({ documentType: "EMD" }), LIVE);
    expect(w.outcome).toBe("NIL");
    expect(w.clause).toBe("§13(g)");
  });
});

describe("validity — the letter bounds the sale, not the travel", () => {
  it("declines a ticket issued before 15 January 2026", () => {
    const early = calculateCarrierLayer(ticket({ issueDate: "2026-01-14" }), LIVE);
    expect(early.outcome).toBe("NO_RULE");
  });

  it("accepts travel in 2027 on a ticket sold inside the window", () => {
    const late = ticket({
      issueDate: "2026-12-30",
      coupons: ticket().coupons.map((c) => ({ ...c, departureDate: "2027-06-01" })),
    });
    expect(calculateCarrierLayer(late, LIVE).outcome).toBe("CALCULATED");
  });
});

describe("open question 1 — the basis is not stated in the letter", () => {
  it("quantifies what including YQ would change", () => {
    const onBase = calculateCarrierLayer(ticket(), LIVE).commission;
    const withYq = calculateCarrierLayer(ticket(), [
      { ...LY_MAINST_COMMISSION, approved: true,
        award: { ...LY_MAINST_COMMISSION.award, basis: ["base_fare", "yq"] } },
    ]).commission;
    expect(f(onBase)).toBe("192.60");
    expect(f(withYq)).toBe("227.34"); // (2140.00 + 386.00) × 9%
    expect(f({ units: withYq.units - onBase.units, currency: "USD" })).toBe("34.74");
  });

  it("records every unresolved reading against the contract", () => {
    expect(OPEN_QUESTIONS.filter((q) => q.severity === "high")).toHaveLength(3);
  });
});

describe("the filed rules cannot fire until a human approves them", () => {
  it("refuses to calculate from the as-extracted contract", () => {
    const w = calculateCarrierLayer(ticket(), LY_MAINST_2026);
    expect(w.outcome).toBe("NO_RULE");
    expect(w.rejected!.every((r) => /not approved/.test(r.reason))).toBe(true);
  });
});

describe("the statement a sub-agent would see", () => {
  it("shows both sectors, their classes and their rates", () => {
    const mixed = ticket({
      coupons: [
        { ...ticket().coupons[0]!, rbd: "D" },
        { ...ticket().coupons[1]!, rbd: "W" },
      ],
    });
    const text = explain(calculate({ ticket: mixed, rules: LIVE }));
    expect(text).toContain("JFK–TLV (D)");
    expect(text).toContain("TLV–JFK (W)");
    expect(text).toContain("9.00%");
    expect(text).toContain("5.00%");
    expect(text).toContain("149.80");
  });
});
