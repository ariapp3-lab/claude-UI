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
    expect(r.rows[0]).toMatchObject({
      ticketNumber: '114-7503646565',
      reason: 'PAID_WHERE_NONE_DUE',
      expected: '0.00',
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
