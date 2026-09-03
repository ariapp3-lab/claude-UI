/**
 * §14 - finding the contract that governs a ticket.
 *
 * The chain is tenant, IATA, carrier, ticketing date. Every step is a real
 * distinction rather than a formality:
 *
 *  - Two tenants may hold the same IATA on different terms, and neither may
 *    ever be priced with the other's contract.
 *  - One agency commonly holds several IATA numbers on the same airline with
 *    different rates. The MST agreement points straight at this: "PNRs created
 *    under one of MST's affiliate offices in order to access higher contracted
 *    commission levels." So the number owns the contract, not the agency.
 *  - A contract that has expired is not the same as one that never existed.
 */

import { describe, expect, it } from "vitest";
import {
  type CarrierContract, type Config, type StoredConsolidator,
  resolveContracts, officesFor,
} from "../contracts/config.js";

function contract(over: Partial<CarrierContract> = {}): CarrierContract {
  return {
    id: "k1",
    carrier: "LY",
    title: "EL AL 2026",
    issuedFrom: "2026-01-01",
    issuedTo: "2026-12-31",
    rates: { Y: "5.00" },
    includeYq: false,
    requiredTourCode: "",
    originIn: [],
    scope: "ticket",
    excludeFareTypes: [],
    notes: "",
    files: [],
    ...over,
  };
}

function office(over: Partial<StoredConsolidator> = {}): StoredConsolidator {
  return {
    id: "o1",
    name: "Main St Travel",
    tenantId: "t1",
    agency: "Main St Travel",
    iata: "33535983",
    retainsPoints: "1.00",
    notes: "",
    contracts: [contract()],
    ...over,
  };
}

const config = (offices: StoredConsolidator[]): Config =>
  ({ version: 1, consolidators: offices });

const ask = (c: Config, over: Partial<Parameters<typeof resolveContracts>[1]> = {}) =>
  resolveContracts(c, {
    tenantId: "t1", iata: "33535983", carrier: "LY", issueDate: "2026-06-01", ...over,
  });

describe("three offices, one airline, three contracts", () => {
  // The case from the MST agreement's own footnote.
  const offices = [
    office({ id: "o1", iata: "33535983", name: "MST main",
      contracts: [contract({ id: "k-main", rates: { Y: "5.00" }, title: "EL AL - main" })] }),
    office({ id: "o2", iata: "33500001", name: "MST affiliate A",
      contracts: [contract({ id: "k-aff", rates: { Y: "9.00" }, title: "EL AL - affiliate" })] }),
    office({ id: "o3", iata: "33500002", name: "MST corporate",
      contracts: [contract({ id: "k-corp", rates: { Y: "7.00" }, title: "EL AL - corporate" })] }),
  ];
  const c = config(offices);

  it("gives each number its own contract", () => {
    expect(ask(c, { iata: "33535983" }).contracts[0]!.rates.Y).toBe("5.00");
    expect(ask(c, { iata: "33500001" }).contracts[0]!.rates.Y).toBe("9.00");
    expect(ask(c, { iata: "33500002" }).contracts[0]!.rates.Y).toBe("7.00");
  });

  it("groups them under one agency without merging their terms", () => {
    const all = officesFor(c, "t1");
    expect(all).toHaveLength(3);
    expect(new Set(all.map((o) => o.agency))).toEqual(new Set(["Main St Travel"]));
    expect(new Set(all.map((o) => o.iata))).toHaveLength(3);
  });

  it("names the office it resolved, so the rate can be traced", () => {
    expect(ask(c, { iata: "33500001" }).reason).toContain("MST affiliate A");
    expect(ask(c, { iata: "33500001" }).office!.id).toBe("o2");
  });
});

describe("tenant isolation", () => {
  const c = config([
    office({ id: "a", tenantId: "t1", contracts: [contract({ rates: { Y: "5.00" } })] }),
    office({ id: "b", tenantId: "t2", contracts: [contract({ rates: { Y: "9.00" } })] }),
  ]);

  it("gives each tenant its own contract for the same IATA", () => {
    expect(ask(c, { tenantId: "t1" }).contracts[0]!.rates.Y).toBe("5.00");
    expect(ask(c, { tenantId: "t2" }).contracts[0]!.rates.Y).toBe("9.00");
  });

  it("never reaches another tenant's office", () => {
    const r = ask(c, { tenantId: "t3" });
    expect(r.office).toBeNull();
    expect(r.miss).toBe("unknown_iata");
  });
});

describe("each way of missing is reported as itself", () => {
  const c = config([office()]);

  it("distinguishes a document with no IATA at all", () => {
    const r = ask(c, { iata: null });
    expect(r.miss).toBe("no_iata");
  });

  it("distinguishes an IATA nobody holds", () => {
    const r = ask(c, { iata: "99999999" });
    expect(r.miss).toBe("unknown_iata");
    expect(r.reason).toContain("99999999");
  });

  it("distinguishes an office that holds no contract for the airline", () => {
    // A gap to negotiate, not a number to go and get.
    const r = ask(c, { carrier: "UA" });
    expect(r.miss).toBe("no_carrier");
    expect(r.office).not.toBeNull();
    expect(r.reason).toContain("UA");
  });

  it("distinguishes a contract that does not cover the ticketing date", () => {
    // A renewal, not an absence.
    const r = ask(c, { issueDate: "2025-06-01" });
    expect(r.miss).toBe("outside_window");
    expect(r.reason).toContain("2026-01-01");
  });

  it("never reports a miss when one resolves", () => {
    const r = ask(c);
    expect(r.miss).toBeNull();
    expect(r.contracts).toHaveLength(1);
  });
});

describe("dated contracts on the same office", () => {
  const c = config([office({
    contracts: [
      contract({ id: "k2025", issuedFrom: "2025-01-01", issuedTo: "2025-12-31", rates: { Y: "4.00" } }),
      contract({ id: "k2026", issuedFrom: "2026-01-01", issuedTo: "2026-12-31", rates: { Y: "5.00" } }),
    ],
  })]);

  it("picks by the ticketing date, not by order", () => {
    expect(ask(c, { issueDate: "2025-06-01" }).contracts[0]!.id).toBe("k2025");
    expect(ask(c, { issueDate: "2026-06-01" }).contracts[0]!.id).toBe("k2026");
  });

  it("returns both where their windows genuinely overlap", () => {
    // Not resolved by picking one: overlapping windows are a data problem for a
    // human to fix, and the engine's own tie-breaking will report AMBIGUOUS.
    const overlapping = config([office({
      contracts: [
        contract({ id: "a", issuedFrom: "2026-01-01", issuedTo: "2026-12-31" }),
        contract({ id: "b", issuedFrom: "2026-06-01", issuedTo: "2026-06-30" }),
      ],
    })]);
    expect(ask(overlapping, { issueDate: "2026-06-15" }).contracts).toHaveLength(2);
  });

  it("matches a carrier code whatever its case", () => {
    expect(ask(c, { carrier: "ly" }).miss).toBeNull();
  });
});

describe("booking-class bands as a letter writes them", () => {
  // Mirrors parseClasses in the contract form. A letter files a whole band at
  // one rate -- "K/V/S/L/H/N 7%" -- so the form has to take a band.
  const parseClasses = (input: string): string[] => [...new Set(
    input.toUpperCase().split(/[^A-Z]+/).filter((c) => c.length === 1),
  )];

  it("accepts every separator a letter uses", () => {
    const want = ["K", "V", "S", "L", "H", "N"];
    expect(parseClasses("K/V/S/L/H/N")).toEqual(want);
    expect(parseClasses("K V S L H N")).toEqual(want);
    expect(parseClasses("K,V,S,L,H,N")).toEqual(want);
    expect(parseClasses("k, v, s, l, h, n")).toEqual(want);
  });

  it("drops duplicates rather than writing a class twice", () => {
    expect(parseClasses("C J C J")).toEqual(["C", "J"]);
  });

  it("ignores stray punctuation and empty input", () => {
    expect(parseClasses("  ")).toEqual([]);
    expect(parseClasses("---")).toEqual([]);
    // A band pasted with its rate attached must not add a class called "9".
    expect(parseClasses("I/D/Z  9%")).toEqual(["I", "D", "Z"]);
    expect(parseClasses("K/V/S/L/H/N 7%")).toEqual(["K", "V", "S", "L", "H", "N"]);
  });
});
