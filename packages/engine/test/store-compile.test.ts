/**
 * Contracts entered through the app must produce the same answers as the ones
 * written by hand. The EL AL letter is the check: the seeded configuration is
 * that letter, so compiling it has to reproduce the figures already pinned by
 * the contract tests.
 */

import { describe, expect, it } from 'vitest';
import { calculate, formatMoney, parseMoney } from '../src/index.js';
import type { TicketDocument } from '../src/types.js';
import {
  seedConfig, compileContract, compileSubAgentRules, carrierRulesFor,
} from '../contracts/config.js';

const f = formatMoney;
const usd = (d: string) => parseMoney(d, 'USD');
const config = seedConfig();
const mst = config.consolidators[0];
const RULES = carrierRulesFor(mst);
const ALL = [...RULES, ...compileSubAgentRules(mst, 'sa')];

function ticket(over: Partial<TicketDocument> = {}): TicketDocument {
  return {
    ticketNumber: '114-2400000001', documentType: 'TKT', validatingCarrier: 'LY',
    iataNumber: '33535983', issueDate: '2026-03-02', posCountry: 'US', currency: 'USD',
    baseFare: usd('2000.00'), taxes: [{ code: 'YQ', amount: usd('300.00') }],
    total: usd('2300.00'), fareType: 'published', paxType: 'ADT',
    tourCode: '0NYZE71545', subAgentId: 'sa',
    coupons: [
      { n: 1, origin: 'JFK', destination: 'TLV', marketingCarrier: 'LY', rbd: 'D',
        fareBasis: 'DRTUS', departureDate: '2026-04-14', status: 'OK' },
      { n: 2, origin: 'TLV', destination: 'JFK', marketingCarrier: 'LY', rbd: 'D',
        fareBasis: 'DRTUS', departureDate: '2026-04-28', status: 'OK' },
    ],
    ...over,
  };
}

describe('the seeded configuration is the EL AL letter', () => {
  it('carries the rate table and the terms', () => {
    const ly = mst.contracts[0];
    expect(mst.iata).toBe('33535983');
    expect(mst.retainsPoints).toBe('1.00');
    expect(ly.rates.D).toBe('9.00');
    expect(ly.rates.S).toBe('7.00');
    expect(ly.requiredTourCode).toBe('0NYZE71545');
    expect(ly.originIn).toEqual(['US', 'CA']);
    expect(ly.scope).toBe('half_rt');
  });

  it('prices a D-class ticket the same as the hand-written contract does', () => {
    const w = calculate({ ticket: ticket(), rules: ALL, subAgentId: 'sa' });
    expect(f(w.carrier.commission)).toBe('180.00');   // 9% of 2000.00
    expect(f(w.subAgent!.commission)).toBe('160.00'); // 8%
    expect(f(w.hostSpread)).toBe('20.00');            // one point
  });

  it('excludes YQ from the fare, as the seed says', () => {
    const w = calculate({ ticket: ticket(), rules: RULES });
    expect(f(w.carrier.basis!)).toBe('2000.00');
    expect(w.carrier.basisTrace!.find((t) => t.component === 'YQ')!.included).toBe(false);
  });

  it('forfeits the commission when the tour code is missing', () => {
    const w = calculate({ ticket: ticket({ tourCode: null }), rules: RULES });
    expect(w.carrier.outcome).toBe('NIL');
    expect(w.carrier.ruleId).toBe('ly-2026-NO-TOUR-CODE');
  });

  it('pays nothing on a journey originating outside the territory', () => {
    const exTlv = ticket({
      coupons: [
        { ...ticket().coupons[0], origin: 'TLV', destination: 'JFK' },
        { ...ticket().coupons[1], origin: 'JFK', destination: 'TLV' },
      ],
    });
    const w = calculate({ ticket: exTlv, rules: RULES });
    expect(w.carrier.outcome).toBe('NIL');
    expect(w.carrier.ruleId).toBe('ly-2026-ORIGIN-EXCLUDED');
  });
});

describe('editing the contract changes the money', () => {
  const ly = mst.contracts[0];

  it('follows a rate the agency changes', () => {
    const cut = compileContract(mst, { ...ly, rates: { ...ly.rates, D: '6.00' } });
    const w = calculate({ ticket: ticket(), rules: [...cut, ...compileSubAgentRules(mst, 'sa')], subAgentId: 'sa' });
    expect(f(w.carrier.commission)).toBe('120.00');
    // The retention is a point of the fare, so it holds while the rate moves.
    expect(f(w.subAgent!.commission)).toBe('100.00');
    expect(f(w.hostSpread)).toBe('20.00');
  });

  it('includes YQ when the agency ticks the box', () => {
    const withYq = compileContract(mst, { ...ly, includeYq: true });
    const w = calculate({ ticket: ticket(), rules: withYq });
    expect(f(w.carrier.basis!)).toBe('2300.00');      // 2000.00 + 300.00
    expect(f(w.carrier.commission)).toBe('207.00');   // 9% of 2300.00
  });

  it('drops the tour-code requirement when the field is cleared', () => {
    const noCode = compileContract(mst, { ...ly, requiredTourCode: '' });
    const w = calculate({ ticket: ticket({ tourCode: null }), rules: noCode });
    expect(f(w.carrier.commission)).toBe('180.00');
    expect(noCode.some((r) => r.id.endsWith('NO-TOUR-CODE'))).toBe(false);
  });

  it('follows a different retention', () => {
    const twoPoints = compileSubAgentRules({ ...mst, retainsPoints: '2.00' }, 'sa');
    const w = calculate({ ticket: ticket(), rules: [...RULES, ...twoPoints], subAgentId: 'sa' });
    expect(f(w.hostSpread)).toBe('40.00');
    expect(f(w.subAgent!.commission)).toBe('140.00');
  });

  it('prices a second carrier added alongside the first', () => {
    const withUa = {
      ...mst,
      contracts: [...mst.contracts, {
        id: 'ua-2026', carrier: 'UA', title: 'United 2026',
        issuedFrom: '2026-01-01', issuedTo: '2026-12-31',
        rates: { J: '5.00', Y: '3.00' }, includeYq: false, requiredTourCode: '',
        originIn: ['US'], scope: 'ticket' as const, excludeFareTypes: [],
        notes: '', files: [],
      }],
    };
    const ua = ticket({
      validatingCarrier: 'UA', tourCode: null,
      coupons: ticket().coupons.map((c) => ({ ...c, marketingCarrier: 'UA', rbd: 'J' })),
    });
    const rules = carrierRulesFor(withUa);
    expect(f(calculate({ ticket: ua, rules }).carrier.commission)).toBe('100.00'); // 5%
    // and the EL AL contract still prices its own tickets
    expect(f(calculate({ ticket: ticket(), rules }).carrier.commission)).toBe('180.00');
  });
});
