/**
 * The test that looks like the data.
 *
 * Every crash this system has shipped came from a record shape nobody wrote a
 * fixture for: a coupon-less EMD, a fare line in EUR, a `U-` waitlist segment
 * read as a flown sector. The unit tests all passed while the browser went
 * white, because the unit tests only ever saw records I had already understood.
 *
 * So this suite does not assert amounts. It asserts that the pipeline survives
 * input it has never seen, by taking the five real records and breaking them in
 * every mechanical way a real folder breaks files:
 *
 *   - truncated (a transfer cut short, a half-written file)
 *   - one line removed (a record part that never arrived)
 *   - a field emptied (a data-entry gap upstream)
 *   - encoding damage (CRLF, BOM, stray nulls, latin-1 bytes)
 *
 * A parse that returns warnings is a pass. A parse that returns nothing is a
 * pass. A throw is a failure, because a throw during render unmounts React and
 * the user sees a white page with no way back.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { priceAirFile, seedConfig } from "../src/index.js";

const SAMPLES = join(__dirname, "../../parsers/test/samples");

const REAL: ReadonlyArray<readonly [string, string]> = readdirSync(SAMPLES)
  .filter((f) => f.endsWith(".air"))
  .map((f) => [f, readFileSync(join(SAMPLES, f), "utf8")] as const);

const CONFIG = seedConfig();

/** Run the whole pipeline and report a throw, never propagate it. */
function survives(text: string): { ok: true } | { ok: false; error: string } {
  try {
    const result = priceAirFile(text, { config: CONFIG, view: "subagent" });
    // The result must also be serialisable — a bigint that escaped the money
    // boundary throws here, at the edge, exactly as it would in a CRM.
    JSON.stringify(result);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function expectSurvival(label: string, text: string): void {
  const outcome = survives(text);
  if (!outcome.ok) {
    throw new Error(`${label} threw: ${outcome.error}`);
  }
}

describe("real records still price", () => {
  for (const [name, text] of REAL) {
    it(name, () => {
      const result = priceAirFile(text, { config: CONFIG, view: "subagent" });
      expect(result.documents.length).toBeGreaterThan(0);
      // Whatever the outcome, a prefill is offered only when it is safe to use.
      for (const doc of result.documents) {
        if (doc.prefill !== null) {
          expect(["CALCULATED", "NIL"]).toContain(doc.outcome);
        }
      }
    });
  }
});

describe("truncation", () => {
  for (const [name, text] of REAL) {
    it(`${name} truncated at every 32nd byte`, () => {
      for (let cut = 0; cut <= text.length; cut += 32) {
        expectSurvival(`${name} cut at ${cut}`, text.slice(0, cut));
      }
    });
  }
});

describe("a missing line", () => {
  for (const [name, text] of REAL) {
    it(`${name} with any single line removed`, () => {
      const lines = text.split("\n");
      for (let drop = 0; drop < lines.length; drop += 1) {
        const damaged = lines.filter((_, i) => i !== drop).join("\n");
        expectSurvival(`${name} without line ${drop} (${lines[drop]})`, damaged);
      }
    });
  }
});

describe("an emptied field", () => {
  for (const [name, text] of REAL) {
    it(`${name} with any single line emptied after its tag`, () => {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const tag = /^[A-Z]+-?/.exec(lines[i]);
        if (!tag) continue;
        const damaged = lines.map((l, j) => (j === i ? tag[0] : l)).join("\n");
        expectSurvival(`${name} line ${i} emptied to "${tag[0]}"`, damaged);
      }
    });
  }
});

describe("encoding damage", () => {
  const mutations: ReadonlyArray<readonly [string, (s: string) => string]> = [
    ["CRLF line endings", (s) => s.replace(/\n/g, "\r\n")],
    ["CR-only line endings", (s) => s.replace(/\n/g, "\r")],
    ["a UTF-8 BOM", (s) => `﻿${s}`],
    ["trailing whitespace", (s) => s.split("\n").map((l) => `${l}   `).join("\n")],
    ["leading whitespace", (s) => s.split("\n").map((l) => `  ${l}`).join("\n")],
    ["embedded nulls", (s) => s.replace(/-/g, "-\0")],
    ["a replacement character", (s) => s.replace(/A/g, "�")],
    ["no trailing newline", (s) => s.replace(/\n+$/, "")],
    ["doubled newlines", (s) => s.replace(/\n/g, "\n\n")],
    ["lowercased tags", (s) => s.toLowerCase()],
  ];

  for (const [name, text] of REAL) {
    for (const [label, mutate] of mutations) {
      it(`${name} with ${label}`, () => {
        expectSurvival(`${name} / ${label}`, mutate(text));
      });
    }
  }
});

describe("input that is not an AIR file at all", () => {
  const junk: ReadonlyArray<readonly [string, string]> = [
    ["empty", ""],
    ["whitespace", "   \n\t\n  "],
    ["one newline", "\n"],
    ["prose", "Please find attached the tickets for last week. Thanks!"],
    ["a CSV", "ticket,amount\n114-1234567890,35.00\n"],
    ["JSON", '{"ticket":"114-1234567890"}'],
    ["HTML", "<html><body>Not found</body></html>"],
    ["a lone tag", "T-"],
    ["every tag empty", "A-\nB-\nD-\nG-\nH-\nK-\nM-\nT-\nI-\nFM\nFO\n"],
    ["a very long line", `T-${"9".repeat(100_000)}`],
    ["many empty records", "AMD 001;2/3;\n".repeat(1000)],
    ["binary", Buffer.from([0, 1, 2, 255, 254, 127, 13, 10]).toString("latin1")],
  ];

  for (const [label, text] of junk) {
    it(label, () => {
      expectSurvival(label, text);
    });
  }
});

describe("a record that carries no coupons", () => {
  /**
   * The exact shape that white-screened the browser: geo asked a document with
   * no flown sectors for its journey origin. It must price, or decline to, but
   * never throw.
   */
  it("prices or declines, but does not throw", () => {
    const [, base] = REAL[0];
    const withoutCoupons = base
      .split("\n")
      .filter((l) => !l.startsWith("H-") && !l.startsWith("G-"))
      .join("\n");
    expectSurvival("coupon-less record", withoutCoupons);
  });
});
