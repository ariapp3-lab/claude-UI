/**
 * The host agency's weekly client statement, against a real one.
 *
 * The fixture is a redacted copy of an actual MST statement: passenger names
 * replaced with fakes of identical length so every column stays where it was,
 * and the agency's own contact details replaced. Nothing else is altered, so
 * the shape the parser has to survive is the shape that really arrives.
 *
 * The strongest assertion here is the last one: the lines this reader finds
 * must sum to the balance the statement prints at its own foot. That is a
 * check against arithmetic nobody in this repository did, and it is what makes
 * the other numbers believable.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatMoney } from "@commission/engine";
import { parseMstClientStatement, payoutOwed } from "../src/mst-statement.js";

const text = readFileSync(
  fileURLToPath(new URL("./samples/mst-client-statement.txt", import.meta.url)),
  "utf8",
);
const r = parseMstClientStatement(text);

describe("the statement header", () => {
  it("reads the period it covers", () => {
    // 8/16/2026 is August the 16th, not the 8th of the 16th month.
    expect(r.to).toBe("2026-08-16");
  });

  it("reads the client identifiers", () => {
    expect(r.client.id).toBe("5550000000");
    expect(r.client.number).toBe("49345");
  });
});

describe("what the lines are", () => {
  it("finds every transaction line across all six pages", () => {
    expect(r.lines).toHaveLength(149);
    expect(r.invoices).toHaveLength(141);
  });

  it("keys every line to an invoice number", () => {
    expect(r.lines.every((l) => /^\d{5,}$/.test(l.invoice))).toBe(true);
  });

  it("reads the passenger and the vendor as separate fields", () => {
    // The report separates them with a run of spaces on some rows and a single
    // space on others, so this is recovered by shape rather than by position.
    const mst = r.lines.filter((l) => l.vendor === "MST");
    expect(mst.length).toBeGreaterThan(100);
    expect(mst.every((l) => l.passenger.includes("/"))).toBe(true);
    expect(r.lines.some((l) => l.vendor.startsWith("El Al"))).toBe(true);
  });

  it("reads travel dates and itineraries", () => {
    const withItin = r.lines.filter((l) => l.itinerary);
    expect(withItin.length).toBeGreaterThan(100);
    expect(withItin.every((l) => /^[A-Z]{3,}$/.test(l.itinerary))).toBe(true);
  });

  it("carries remarks where the statement gives one", () => {
    const remarked = r.lines.filter((l) => l.remark);
    expect(remarked.length).toBeGreaterThan(0);
    expect(remarked.some((l) => /LPV/.test(l.remark))).toBe(true);
  });
});

describe("the ticket number is not the key", () => {
  /**
   * The finding that invalidated the original reconciler. Only a handful of
   * lines carry a ticket number, and every one of those is the airline's own
   * issue record at zero. Every line that carries money has none.
   */
  const ticketed = r.lines.filter((l) => l.ticketNumber);

  it("appears on very few lines", () => {
    expect(ticketed).toHaveLength(11);
    expect(ticketed.length / r.lines.length).toBeLessThan(0.1);
  });

  it("appears only on lines carrying no money", () => {
    expect(ticketed.every((l) => l.amount.units === 0n)).toBe(true);
  });

  it("never appears on a line the host billed", () => {
    const money = r.lines.filter((l) => l.amount.units !== 0n);
    expect(money.every((l) => l.ticketNumber === null)).toBe(true);
    expect(money.length).toBeGreaterThan(100);
  });

  it("belongs to the airline, not to the host", () => {
    expect(ticketed.every((l) => l.vendor !== "MST")).toBe(true);
  });
});

describe("sign carries the meaning", () => {
  it("reads a charge as positive and a credit as negative", () => {
    expect(formatMoney(r.totals.charges)).toBe("1643.00");
    expect(formatMoney(r.totals.credits)).toBe("-32162.65");
  });

  it("recognises the host's own fee amounts among the charges", () => {
    // $25 exchange and refund, $10 non-commissionable, $20 net fare — the
    // schedule encoded from the signed agreement, appearing in the wild.
    const charges = r.lines.filter((l) => l.amount.units > 0n)
      .map((l) => formatMoney(l.amount));
    for (const fee of ["25.00", "10.00", "20.00", "30.00"]) {
      expect(charges, `no ${fee} charge found`).toContain(fee);
    }
  });

  it("reports the payout as a positive figure when the host owes", () => {
    expect(r.totals.payout.units).toBeLessThan(0n);
    expect(formatMoney(payoutOwed(r))).toBe("30519.65");
  });
});

describe("an invoice can carry several lines", () => {
  const multi = r.invoices.filter((i) => i.lines.length > 1);

  it("groups them under the one invoice", () => {
    expect(multi.length).toBeGreaterThan(5);
  });

  it("nets a credit against a fee", () => {
    // A 50.00 credit less a 25.00 exchange fee prints as -25.00, and the
    // statement shows its own subtotal on a line of its own.
    const netted = multi.find((i) => i.statedNet !== null)!;
    expect(netted.statedNet).not.toBeNull();
    expect(netted.net.units).toBe(netted.statedNet!.units);
  });

  it("agrees with every subtotal the statement printed", () => {
    for (const i of r.invoices) {
      if (!i.statedNet) continue;
      expect(i.net.units, `invoice ${i.invoice}`).toBe(i.statedNet.units);
    }
  });
});

describe("the closing block is not a transaction", () => {
  /**
   * "Total Open" and "Account Balance" both carry the balance, and the grand
   * total also prints as a bare amount directly under the last invoice. Read as
   * transactions they triple the payout — which is exactly what happened before
   * they were excluded: -91,558.95 against a real -30,519.65.
   */
  it("reads the balance the statement printed", () => {
    expect(r.totals.statedBalance).not.toBeNull();
    expect(formatMoney(r.totals.statedBalance!)).toBe("-30519.65");
  });

  it("sums the lines to exactly that balance", () => {
    expect(r.totals.payout.units).toBe(r.totals.statedBalance!.units);
  });

  it("raises no warning, because nothing disagreed", () => {
    expect(r.warnings).toEqual([]);
  });
});

describe("robustness", () => {
  it("survives input that is not a statement", () => {
    for (const junk of ["", "   \n\n", "hello", "a,b,c\n1,2,3", "<html></html>"]) {
      expect(() => parseMstClientStatement(junk)).not.toThrow();
    }
    expect(parseMstClientStatement("").lines).toEqual([]);
  });

  it("says so when it recognises nothing", () => {
    const out = parseMstClientStatement("just some prose");
    expect(out.warnings.join(" ")).toMatch(/does not look like a client statement/);
  });

  it("survives truncation at any point", () => {
    for (let cut = 0; cut <= text.length; cut += 512) {
      expect(() => parseMstClientStatement(text.slice(0, cut))).not.toThrow();
    }
  });

  it("round-trips through JSON", () => {
    const plain = JSON.parse(JSON.stringify(r, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v));
    expect(plain.lines).toHaveLength(149);
  });
});
