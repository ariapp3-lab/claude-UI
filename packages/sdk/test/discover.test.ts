/**
 * Reading contracts out of the files that arrive.
 *
 * The distinction this suite exists to protect: what an agent CLAIMED on a
 * ticket is evidence, not a contract. One of the real samples claims 8% on a
 * class El Al files at 7%. A discovery that quietly turned claims into rates
 * would encode that mistake as policy and then reconcile against it forever.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  discoverFromFiles, proposedRates, describeDiscovery, seedConfig, DEFAULT_TENANT,
} from "../src/index.js";

const dir = fileURLToPath(new URL("../../parsers/test/samples/", import.meta.url));
const FILES = readdirSync(dir)
  .filter((f) => f.endsWith(".air"))
  .map((name) => ({ name, text: readFileSync(dir + name, "utf8") }));

const opts = { config: seedConfig(), tenantId: DEFAULT_TENANT };

describe("what the sample folder reveals", () => {
  const found = discoverFromFiles(FILES, opts);

  it("finds the office the tickets were issued under", () => {
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((d) => d.iata)).toContain("33535983");
  });

  it("reports it as already configured", () => {
    const mst = found.find((d) => d.iata === "33535983" && d.carrier === "LY")!;
    expect(mst.configured).toBe(true);
    expect(mst.miss).toBeNull();
  });

  it("counts every ticket, not every file", () => {
    // The multi-passenger record carries three.
    const total = found.reduce((n, d) => n + d.tickets, 0);
    expect(total).toBeGreaterThanOrEqual(7);
  });

  it("reports the fare types actually issued", () => {
    const mst = found.find((d) => d.iata === "33535983")!;
    // Most of the folder is bulk, which is the fact that decides whether a
    // percentage contract is even the right shape.
    expect(mst.fareTypes.length).toBeGreaterThan(0);
  });

  it("summarises in one line", () => {
    const line = describeDiscovery(found[0]!);
    expect(line).toContain("IATA");
    expect(line).toContain(found[0]!.carrier);
  });
});

describe("an IATA with no contract behind it", () => {
  const empty = { config: { version: 1 as const, consolidators: [] }, tenantId: DEFAULT_TENANT };
  const found = discoverFromFiles(FILES, empty);

  it("is reported as not configured, with the reason", () => {
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) {
      expect(d.configured).toBe(false);
      expect(d.miss).toMatch(/no office is configured/);
    }
  });

  it("still proposes what the tickets suggest", () => {
    // The point of discovery: an empty contract table is where it earns its
    // keep, because that is when nobody knows what to type in.
    const anyRates = found.some((d) => Object.keys(proposedRates(d).rates).length > 0);
    expect(anyRates).toBe(true);
  });
});

describe("claims are evidence, never policy", () => {
  it("offers a rate only where every ticket in a class agreed", () => {
    const found = discoverFromFiles(FILES, opts);
    for (const d of found) {
      const { rates, unresolved } = proposedRates(d);
      for (const cls of d.classes) {
        if (cls.claimed.length === 1) {
          expect(rates[cls.rbd]).toBe(cls.claimed[0]!.rate);
        } else {
          // Disagreement is surfaced, not averaged away or won by majority.
          expect(rates[cls.rbd]).toBeUndefined();
          expect(unresolved).toContain(cls.rbd);
        }
      }
    }
  });

  it("keeps every distinct claim so the disagreement can be read", () => {
    const found = discoverFromFiles(FILES, opts);
    for (const d of found) {
      for (const cls of d.classes) {
        expect(cls.claimed.length).toBeGreaterThan(0);
        // Most frequent first, so a lone outlier is visibly the outlier.
        const counts = cls.claimed.map((c) => c.tickets);
        expect([...counts].sort((a, b) => b - a)).toEqual(counts);
        expect(cls.tickets).toBe(counts.reduce((a, b) => a + b, 0));
      }
    }
  });

  it("counts flat-amount claims separately from rates", () => {
    // A commission entered as a dollar figure says nothing about any class, so
    // it must never be attributed to one.
    const found = discoverFromFiles(FILES, opts);
    for (const d of found) {
      expect(d.flatClaims).toBeGreaterThanOrEqual(0);
      for (const cls of d.classes) {
        for (const c of cls.claimed) expect(c.rate).toMatch(/^[\d.]+$/);
      }
    }
  });
});

describe("robustness", () => {
  it("survives a folder of junk", () => {
    const junk = [
      { name: "a.txt", text: "not an AIR file at all" },
      { name: "b.air", text: "" },
      { name: "c.air", text: "T-\nA-\n" },
    ];
    expect(() => discoverFromFiles(junk, opts)).not.toThrow();
  });

  it("returns nothing for an empty folder rather than failing", () => {
    expect(discoverFromFiles([], opts)).toEqual([]);
  });

  it("round-trips through JSON", () => {
    const found = discoverFromFiles(FILES, opts);
    expect(JSON.parse(JSON.stringify(found))).toEqual(found);
  });
});
