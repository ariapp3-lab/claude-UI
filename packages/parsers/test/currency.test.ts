/**
 * Documents that are not priced in dollars.
 *
 * The parser used to label every amount USD regardless of what the document
 * said. A EUR fare then produced a EUR base fare beside USD taxes, and the
 * first attempt to add them threw — out of the calculation, out of a React
 * render, and the page went white. One such document lost the whole folder.
 */

import { describe, expect, it } from 'vitest';
import { formatMoney } from '@commission/engine';
import { reconcile } from '../../cli/src/reconcile.js';
import { LY_MAINST_2026 } from '../../engine/contracts/ly-mainst-2026.js';
import { parseAmadeusAir } from '../src/amadeus-air.js';

const f = formatMoney;
const RULES = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));

const eur = [
  'AIR-BLK207;7A;;264;0000000000;1A1196214;001001',
  'AMD 0100005484;1/1;',
  '1A1450886;1A1196214',
  'MUC1A ACJISE006;0101;FRA1S21EF;33535983;FRA1S21EF;33535983;FRA1S21EF;33535983;;;;;;;;;;;;;;;;;;;;5550000000;;;LY ACJISE',
  'A-EL AL;LY 1142',
  'B-TTP/STMST/INVJ/RT',
  'D-260801;260801;260801',
  'G-X  ;;FRATLV;',
  'H-001;002OFRA;FRANKFURT        ;TLV;TEL AVIV B GURION;LY    0356 C C 01AUG1150P0515P02AUG;OK01;HK01;BH;0;789;M;;1PC;B ;;ET;1025 ;N;5692;DE;IL;3 ',
  'K-FEUR980.00     ;;;;;;;;;;;;EUR1042.50    ;;;',
  'KFTF; EUR12.50    DE SE; EUR16.20    RA AE; EUR33.80    IL EB;',
  'M-CPRPEU        ',
  'Q-FRA LY TLV Q60.00 920.00CPRPEU NUC980.00END ROE1.00',
  'I-001;01TESTPAX/SAMPLE;;APFRA 555 000-0000 - REDACTED - A;;',
  'T-E114-7511111111',
  'FM*M*7',
  'ENDX',
].join('\n');

const usd = [
  'AIR-BLK207;7A;;264;0000000000;1A1196214;001001',
  'AMD 0100005485;1/1;',
  '1A1450886;1A1196214',
  'MUC1A ACJISE007;0101;EWR1S21EF;33535983;EWR1S21EF;33535983;EWR1S21EF;33535983;;;;;;;;;;;;;;;;;;;;5550000000;;;LY ACJISF',
  'A-EL AL;LY 1142',
  'B-TTP/STMST/INVJ/RT',
  'D-260801;260801;260801',
  'G-X  ;;NYCTLV;',
  'H-001;002OEWR;NEWARK         NJ;TLV;TEL AVIV B GURION;LY    0026 S S 01AUG1150P0515P02AUG;OK01;HK01;BH;0;789;M;;1PC;B ;;ET;1025 ;N;5692;US;IL;3 ',
  'K-FUSD1496.00    ;;;;;;;;;;;;USD1533.50    ;;;',
  'KFTF; USD4.00     AP SE; USD5.60     AY SE; USD23.40    US AP; USD4.50     XF   ;',
  'M-SHOC2US        ',
  'Q-EWR LY TLV Q100.00Q305.00 1091.00NUC1496.00END ROE1.00',
  'I-001;01TESTPAX/SAMPLE;;APEWR 555 000-0000 - REDACTED - A;;',
  'T-E114-7503646565',
  'ENDX',
].join('\n');

describe('a EUR document', () => {
  const r = parseAmadeusAir(eur);
  const t = r.tickets[0];

  it('is read in its own currency, not assumed to be dollars', () => {
    expect(t.currency).toBe('EUR');
    expect(t.baseFare.currency).toBe('EUR');
    expect(f(t.baseFare)).toBe('980.00');
  });

  it('adds its taxes without a currency mismatch', () => {
    expect(t.taxes.every((x) => x.amount.currency === 'EUR')).toBe(true);
    expect(f(t.total)).toBe('1042.50');   // 980.00 + 12.50 + 16.20 + 33.80
    expect(r.warnings.filter((w) => /currency/.test(w))).toEqual([]);
  });

  it('reads a percentage commission against the EUR fare', () => {
    expect(r.passengers[0].reportedFM).toMatchObject({ kind: 'percent', rate: '7' });
    expect(f(r.passengers[0].reportedFM!.amount)).toBe('68.60'); // 980.00 × 7%
    expect(r.passengers[0].reportedFM!.amount.currency).toBe('EUR');
  });

  it('prices without throwing', () => {
    expect(() => reconcile([{ ticket: t, claimed: null }], RULES, [])).not.toThrow();
  });
});

describe('a batch holding two currencies', () => {
  const tickets = [
    ...parseAmadeusAir(usd).tickets,
    ...parseAmadeusAir(eur).tickets,
    ...parseAmadeusAir(usd).tickets,
  ];
  const result = reconcile(tickets.map((ticket) => ({ ticket, claimed: null })), RULES, []);

  it('prices every document rather than failing on the odd one out', () => {
    expect(result.findings).toHaveLength(3);
  });

  it('names every currency present, most documents first', () => {
    expect(result.currencies).toEqual([
      { code: 'USD', documents: 2 },
      { code: 'EUR', documents: 1 },
    ]);
  });

  it('totals the majority currency and says so, rather than adding the two', () => {
    expect(result.totals.currency).toBe('USD');
    expect(result.totals.counted).toBe(2);
    expect(result.totals.documents).toBe(3);
    expect(f(result.totals.fareValue)).toBe('2992.00');  // 1496.00 × 2, no EUR
  });

  it('warns that the totals do not cover the whole batch', () => {
    expect(result.warnings[0]).toMatch(/more than one currency \(USD 2, EUR 1\)/);
    expect(result.warnings[0]).toMatch(/totals cover USD only/);
  });
});
