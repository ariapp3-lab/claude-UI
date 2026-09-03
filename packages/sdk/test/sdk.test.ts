/**
 * The integration contract.
 *
 * These are the guarantees a CRM is entitled to rely on: money is a string,
 * a figure it must not use is null, and a bad file is an answer rather than an
 * exception. If any of them changes, an integration breaks silently — so each
 * one is pinned here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkStatement, priceAirFile, priceAirFiles, seedConfig } from '../src/index.js';

const dir = fileURLToPath(new URL('../../parsers/test/samples/', import.meta.url));
const read = (name: string) => readFileSync(dir + name, 'utf8');
const config = seedConfig();
const opts = { config, subAgentId: 'me' } as const;

describe('pricing one AIR file', () => {
  const r = priceAirFile(read('amadeus-air-ly-commission.air'), opts);

  it('matches the consolidator from the ticket, not from the caller', () => {
    expect(r.iata).toBe('33535983');
    expect(r.consolidator).toMatchObject({ name: 'Main St Travel', iata: '33535983' });
  });

  it('returns a document a CRM can display without another lookup', () => {
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]).toMatchObject({
      ticketNumber: '114-7503646565',
      documentType: 'TKT',
      issueDate: '2026-08-01',
      route: 'EWR–TLV',
      bookingClasses: 'S',
      currency: 'USD',
      baseFare: '1496.00',
    });
  });

  it('reports every amount as a decimal string, never a number or a bigint', () => {
    const d = r.documents[0];
    for (const v of [d.baseFare, d.carrierCommission]) {
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^-?\d+\.\d{2}$/);
    }
    // The whole result must survive a round trip through JSON unchanged.
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('says what the ticket itself claimed, alongside what the contract gives', () => {
    expect(r.documents[0].claimed).toBe('119.68');
    expect(r.documents[0].claimedAs).toBe('percent');
    expect(r.documents[0].carrierCommission).toBe('0.00');   // clause 14
  });
});

describe('prefill is the whole point', () => {
  it('offers a value when the contract settled the question', () => {
    // Same ticket with the tour code the contract requires.
    const withCode = read('amadeus-air-ly-commission.air')
      .replace('FE/C1 FARE RESTRICTIONS APPLY -BG:LY;S2;P1', 'FT0NYZE71545');
    const d = priceAirFile(withCode, opts).documents[0];
    expect(d.outcome).toBe('CALCULATED');
    expect(d.carrierCommission).toBe('104.72');   // S at 7%
    expect(d.subAgentCommission).toBe('89.76');   // less the consolidator's point
    expect(d.prefill).toBe('89.76');
  });

  it('offers a value of zero when the contract says nothing is due', () => {
    const d = priceAirFile(read('amadeus-air-ly-commission.air'), opts).documents[0];
    expect(d.outcome).toBe('NIL');
    expect(d.prefill).toBe('0.00');
    expect(d.explanation).toMatch(/no commission is due \(tour code 0NYZE71545 required\)/);
    expect(d.ruleId).toBe('ly-2026-NO-TOUR-CODE');
  });

  it('withholds a value when no contract covers the IATA number', () => {
    const other = read('amadeus-air-ly-commission.air').replace(/33535983/g, '99999999');
    const r = priceAirFile(other, opts);
    expect(r.consolidator).toBeNull();
    expect(r.documents[0].prefill).toBeNull();
    expect(r.documents[0].outcome).toBe('NO_CONTRACT');
    expect(r.warnings.some((w) => /no consolidator is configured for IATA 99999999/.test(w)))
      .toBe(true);
  });

  it('never returns a figure the caller has to second-guess', () => {
    // Whatever the outcome, a non-null prefill is one of the two settled ones.
    const all = priceAirFiles(
      ['amadeus-air-ly-bt.air', 'amadeus-air-ly-exchange.air', 'amadeus-air-ly-multipax.air',
       'amadeus-air-ly-published-exchange.air', 'amadeus-air-ly-commission.air']
        .map((name) => ({ name, text: read(name) })),
      opts,
    );
    const documents = all.flatMap((r) => r.documents);
    expect(documents.length).toBeGreaterThan(5);
    for (const d of documents) {
      if (d.prefill !== null) expect(['CALCULATED', 'NIL']).toContain(d.outcome);
    }
  });
});

describe('a bad file is an answer, not an exception', () => {
  it('reports an unreadable file rather than throwing', () => {
    const r = priceAirFile('this is not an AIR record', opts);
    expect(() => priceAirFile('', opts)).not.toThrow();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/carried no ticket/);
    expect(r.documents).toEqual([]);
  });

  it('keeps going across a batch when one file is broken', () => {
    const results = priceAirFiles([
      { name: 'good.air', text: read('amadeus-air-ly-commission.air') },
      { name: 'junk.air', text: 'nonsense' },
      { name: 'good2.air', text: read('amadeus-air-ly-bt.air') },
    ], opts);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].file).toBe('junk.air');
  });
});

describe('checking a statement', () => {
  const files = [{ name: 'a.air', text: read('amadeus-air-ly-commission.air') }];
  const csv = [
    'Ticket Number,Commission,Net Payable',
    '1147503646565,50.00,50.00',
  ].join('\n');

  it('says where the statement and the contract disagree', () => {
    const r = checkStatement(csv, files, opts);
    expect(r.ok).toBe(true);
    // A published S-class fare with no tour code: El Al forfeits the
    // commission, and the schedule then charges $10 for a non-commissionable
    // ticket. So the consolidator owes -10.00 on it and paid 50.00 — an
    // overpayment of 60.00, not a payment where nothing was due.
    expect(r.rows[0]).toMatchObject({
      ticketNumber: '114-7503646565',
      reason: 'OVER_PAID',
      expected: '-10.00',
      stated: '50.00',
    });
  });

  it('returns totals as strings a CRM can store', () => {
    const r = checkStatement(csv, files, opts);
    for (const v of Object.values(r.totals)) expect(typeof v).toBe('string');
    expect(r.totals.currency).toBe('USD');
  });

  it('refuses rather than guessing when no contract is configured', () => {
    const other = { name: 'x.air', text: read('amadeus-air-ly-commission.air').replace(/33535983/g, '11111111') };
    const r = checkStatement(csv, [other], opts);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no contract is configured/);
  });
});

describe("a figure is only offered when it is safe to write", () => {
  /**
   * Regression: the ZRH–TLV reissue in the real samples. The carrier layer
   * settles (a $100 clawback, because the journey originates outside US/CA and
   * the original ticket was already commissioned), while the sub-agent layer
   * cannot resolve its share at all. Reading the carrier's outcome and paying
   * the sub-agent's number offered a confident 0.00 on an open question.
   */
  const sample = read("amadeus-air-ly-published-exchange.air");

  function priced() {
    const config = seedConfig();
    return priceAirFile(sample, { config, view: "subagent" });
  }

  it("offers nothing where the two contracts disagree", () => {
    const doc = priced().documents[0]!;
    // The engine has already said a human is needed; the SDK must not paper
    // over that with a number.
    expect(doc.flags.some((f) => f.code === "REVIEW")).toBe(true);
    expect(doc.prefill).toBeNull();
  });

  it("still reports the figures, so the reason is visible", () => {
    // Withholding the prefill must not withhold the explanation — the caller
    // needs to see what the clawback was in order to query it.
    const doc = priced().documents[0]!;
    expect(doc.carrierCommission).toBe("-100.00");
    expect(doc.explanation).toBeTruthy();
  });
});

describe("a ticket that earns nothing still costs something", () => {
  /**
   * The commission field is not the whole story once a real fee schedule is
   * loaded. Four of the five sample records are bulk fares on LY: they earn no
   * commission and are charged a flat fee by cabin. A caller that reads only
   * the share sees 0.00 and misses the charge entirely.
   */
  const config = seedConfig();
  const priced = (name: string) =>
    priceAirFile(read(name), { config, view: "subagent" }).documents[0]!;

  it("reports the fee alongside the zero commission", () => {
    // A $12,378.75 bulk business fare. The cabin figure ($50) is a FLOOR, not
    // the fee: footnote 2 gives MST what it would have earned had the fare been
    // issued published, which is one point = $123.79. The floor never binds.
    const doc = priced("amadeus-air-ly-bt.air");
    expect(doc.subAgentCommission).toBe("0.00");
    expect(doc.netToSubAgent).toBe("-123.79");
    expect(doc.fees.map((f) => f.ruleId)).toEqual(["MST-FEE-NET-LY-BUSINESS"]);
  });

  it("charges the published-fare point on an economy bulk fare", () => {
    // $3,608.00 economy: one point = $36.08, above the $15 floor.
    const doc = priced("amadeus-air-ly-multipax.air");
    expect(doc.netToSubAgent).toBe("-36.08");
  });

  it("cites the clause behind every fee", () => {
    // A charge the agent cannot trace to a line of the agreement is one they
    // cannot dispute.
    const doc = priced("amadeus-air-ly-bt.air");
    for (const fee of doc.fees) {
      expect(fee.clause, fee.ruleId).toBeTruthy();
      expect(fee.amount).toMatch(/^-\d+\.\d\d$/);
    }
  });

  it("reports no fees when pricing as the host", () => {
    const doc = priceAirFile(read("amadeus-air-ly-bt.air"), {
      config, view: "host",
    }).documents[0]!;
    expect(doc.fees).toEqual([]);
    expect(doc.netToSubAgent).toBeNull();
  });

  it("still round-trips through JSON", () => {
    const doc = priced("amadeus-air-ly-bt.air");
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("a marked-up net fare", () => {
  /**
   * The real record: KN- net base 2,719.00, KS- selling base 3,398.75, and
   * `FM*G*679.75A` recording the 679.75 difference as the agent's markup.
   *
   * That FM element is the trap. Its digits match the commission-amount pattern
   * perfectly, so it was being filed as a commission claim of $679.75 — money
   * the consolidator would then appear to owe, and a shortfall reported on
   * every marked-up ticket in the folder.
   */
  const config = seedConfig();
  const doc = priceAirFile(read("amadeus-air-ly-markup.air"), {
    config, view: "subagent",
  }).documents[0]!;

  it("reads FM*G as a markup, not a commission claim", () => {
    expect(doc.markup).toBe("679.75");
    expect(doc.claimed).toBeNull();
  });

  it("agrees with the fare lines, which are computed independently", () => {
    // 3,398.75 selling less 2,719.00 net. The FM element and the arithmetic are
    // two separate sources, and they have to agree.
    expect(doc.baseFare).toBe("3398.75");
    expect(doc.markup).toBe("679.75");
  });

  it("charges the published-fare point, not the cabin floor", () => {
    // K is economy, so the floor is $15 — but one point of 3,398.75 is 33.99,
    // and footnote 2 gives MST the higher of the two.
    expect(doc.netToSubAgent).toBe("-33.99");
    expect(doc.fees.map((f) => f.label)).toEqual(["net fare fee"]);
  });

  it("reports what the ticket was actually worth to the agent", () => {
    // -33.99 is what the consolidator owes; it looks like a losing ticket.
    // With the markup the agent is 645.76 ahead. Both are true, and they
    // answer different questions.
    expect(doc.totalToSubAgent).toBe("645.76");
  });

  it("earns no commission, because the tour code is absent", () => {
    expect(doc.outcome).toBe("NIL");
    expect(doc.carrierCommission).toBe("0.00");
  });

  it("reports no markup on a published fare", () => {
    const published = priceAirFile(read("amadeus-air-ly-commission.air"), {
      config, view: "subagent",
    }).documents[0]!;
    expect(published.markup).toBe("0.00");
  });
});

describe("the markup ceiling", () => {
  /**
   * On a net fare the airline files a fare it will accept and lets the agent
   * sell above it up to a ceiling, so the markup IS the commission on that
   * ticket — self-set, inside a limit somebody else drew.
   *
   * That makes both directions of error cost money. Over the ceiling invites a
   * debit memo. Under it is revenue the agent was entitled to and did not take,
   * which no statement will ever show as missing, because nobody was short-paid.
   */
  const config = seedConfig();
  const priced = (name: string) =>
    priceAirFile(read(name), { config, view: "subagent" }).documents[0]!;

  it("reports the markup as a percentage of the contract's basis", () => {
    // Both marked-up records sit at exactly 25% of the net fare.
    expect(priced("amadeus-air-ly-markup.air").markupPercent).toBe("25.0000");
    expect(priced("amadeus-air-ly-bt.air").markupPercent).toBe("25.0000");
  });

  it("reads a markup filed exactly at the ceiling as exactly the ceiling", () => {
    // Computed in integers precisely so this cannot come back 24.9999.
    const doc = priced("amadeus-air-ly-markup.air");
    expect(doc.markupPercent).toBe("25.0000");
    expect(doc.markupHeadroom).toBe("0.00");
  });

  it("raises no flag on a ticket inside the ceiling", () => {
    const doc = priced("amadeus-air-ly-markup.air");
    expect(doc.flags.filter((f) => /markup/.test(f.message))).toEqual([]);
  });

  it("reports nothing on a published fare, which has no markup to cap", () => {
    const doc = priced("amadeus-air-ly-commission.air");
    expect(doc.markup).toBe("0.00");
    expect(doc.markupPercent).toBeNull();
  });

  it("round-trips through JSON", () => {
    const doc = priced("amadeus-air-ly-markup.air");
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
