/**
 * The batch reconciler, over the agency's own AIR files.
 *
 * These assertions are the week's real numbers. If any of them moves, either
 * the contract reading changed or something broke — both worth stopping for.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@commission/engine";
import { parseAmadeusAir } from "@commission/parsers";
import { LY_MAINST_2026 } from "../../engine/contracts/ly-mainst-2026.js";
import { reconcile, recoverableValue, type ReconcileInput } from "../src/reconcile.js";
import { toCsv, toJson, renderReport } from "../src/report.js";

const dir = fileURLToPath(new URL("../../parsers/test/samples/", import.meta.url));
const RULES = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));
const f = formatMoney;

const inputs: ReconcileInput[] = [];
const warnings: string[] = [];
for (const file of readdirSync(dir).sort()) {
  const p = parseAmadeusAir(readFileSync(dir + file, "utf8"));
  for (const pax of p.passengers) {
    inputs.push({
      ticket: pax.ticket,
      claimed: pax.reportedFM && !pax.ticket.bulk ? pax.reportedFM.amount : null,
      markup: pax.markup,
    });
  }
  warnings.push(...p.warnings.map((w) => `${file}: ${w}`));
}
const result = reconcile(inputs, RULES, warnings);
const by = (t: string) => result.findings.find((x) => x.ticketNumber === t)!;

describe("the week", () => {
  it("prices every document, including the three on one record", () => {
    expect(result.totals.documents).toBe(7);
    expect(f(result.totals.fareValue)).toBe("29951.75");
  });

  it("totals what is at stake by kind", () => {
    expect(f(result.totals.claimed)).toBe("196.98");
    expect(f(result.totals.entitled)).toBe("0.00");
    expect(f(result.totals.forfeited)).toBe("104.72");
    expect(f(result.totals.clawback)).toBe("-100.00");
    expect(f(result.totals.markup)).toBe("0.00");
    expect(result.totals.noRevenue).toBe(4);
  });

  it("ranks the most consequential document first", () => {
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings.at(-1)!.severity).toBe("ok");
  });
});

describe("each document is labelled by what actually happened to it", () => {
  it("a published fare blocked only by the tour code is a forfeiture", () => {
    const x = by("114-7503646565");
    expect(x.reason).toBe("FORFEITED");
    expect(f(x.recoverable!)).toBe("104.72");
    expect(x.explanation).toMatch(/blocked only by tourCode/);
  });

  it("a reissue whose replaced ticket earned more is a clawback", () => {
    const x = by("114-7508318520");
    expect(x.reason).toBe("CLAWBACK");
    expect(f(x.entitled)).toBe("-100.00");
    expect(x.explanation).toMatch(/100\.00 was taken on the ticket this reissue replaces/);
  });

  it("a net fare with markup is revenue, not a shortfall", () => {
    const x = by("114-7507682876");
    expect(x.reason).toBe("MARKUP");
    expect(x.severity).toBe("ok");
    // A document needing no action carries no amount at stake, and no clause:
    // it is on a different revenue model, not failing the commission one.
    expect(x.recoverable).toBeNull();
    expect(x.explanation).not.toMatch(/§/);
  });

  it("a net fare sold at cost earned nothing at all, and says so", () => {
    const x = by("114-7507450808");
    expect(x.reason).toBe("NO_REVENUE");
    expect(x.explanation).toMatch(/no commission and no markup/);
    expect(x.explanation).toMatch(/would earn 180\.40 as a published fare/);
  });

  it("names a round trip by its turnaround, not by where it came home", () => {
    expect(by("114-7507450808").route).toBe("JFK–TLV");
    expect(by("114-7507682876").route).toBe("JFK–TLV");
  });
});

describe("the counterfactual", () => {
  it("waives only the conditions that actually failed, and names them", () => {
    const rec = recoverableValue(by("114-7503646565").ticket, RULES);
    expect(f(rec.amount)).toBe("104.72");
    expect(rec.waivedConditions).toEqual(["tourCode"]);
    expect(rec.liftedRules).toContain("LY-MAINST-2026-NO-TOUR-CODE");
  });

  it("refuses to manufacture entitlement out of too many waivers", () => {
    // Waive enough conditions and any document looks entitled. A document
    // failing on more than the cap gets no counterfactual at all.
    const exTlv = inputs.find((i) => i.ticket.ticketNumber === "114-7508318625")!.ticket;
    const rec = recoverableValue(exTlv, RULES, 0);
    expect(f(rec.amount)).toBe("0.00");
    expect(rec.waivedConditions).toEqual([]);
  });
});

describe("exports", () => {
  it("writes one CSV row per document with the money as decimal strings", () => {
    const lines = toCsv(result).trim().split("\n");
    expect(lines).toHaveLength(8); // header + 7
    expect(lines[0]).toContain("ticket_number,document_type");
    expect(lines.slice(1).every((l) => /^\d{3}-\d{10},/.test(l))).toBe(true);
  });

  it("writes JSON with no bigint and no float", () => {
    const json = JSON.parse(toJson(result));
    expect(json.findings).toHaveLength(7);
    expect(json.totals.fareValue).toBe("29951.75");
    // Counts and the currency code are carried as themselves, not as money.
    expect(json.totals.currency).toBe("USD");
    expect(json.totals.documents).toBe(7);
    expect(json.currencies).toEqual([{ code: "USD", documents: 7 }]);
    for (const x of json.findings) {
      expect(typeof x.claimed).toBe("string");
      expect(x.claimed).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("renders a report that names the money and the reason", () => {
    const text = renderReport(result, { all: true });
    expect(text).toContain("Forfeited to an exclusion");
    expect(text).toContain("104.72");
    expect(text).toContain("Owed back on reissues");
    expect(text).toContain("114-7503646565");
  });
});
