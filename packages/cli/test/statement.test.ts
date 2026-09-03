/**
 * Settling a consolidator's weekly statement.
 *
 * The statement below is written the way a consolidator's spreadsheet actually
 * looks — a title block above the header, accounting notation for negatives, a
 * total row at the foot, a column nobody has explained — and it disagrees with
 * the contract in every way a real one can.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@commission/engine';
import { parseAmadeusAir, parseStatementCsv, parseStatementAmount, normaliseTicketNumber } from '@commission/parsers';
import { MAIN_ST_TRAVEL, rulesFor } from '../../engine/contracts/consolidators.js';
import { SUB_AGENT_ID } from '../../engine/contracts/subagent-aappel-2026.js';
import { settle } from '../src/statement.js';

const f = formatMoney;
const dir = fileURLToPath(new URL('../../parsers/test/samples/', import.meta.url));

const RAW = readdirSync(dir).sort().flatMap((file) =>
  [...parseAmadeusAir(readFileSync(dir + file, 'utf8')).tickets]);

/**
 * The agency's real documents, with the EL AL tour code inserted.
 *
 * As issued, not one of them earns anything — clause 14 forfeits every ticket
 * that would otherwise qualify — so as issued there is no payable line for a
 * statement to be right or wrong about. Adding the tour code is the smallest
 * change that makes this a week with money in it, and it is the change the
 * agency would have to make anyway.
 */
const tickets = RAW.map((t) => ({ ...t, tourCode: '0NYZE71545' }));

/**
 * A statement from Main St Travel. Deliberately awkward:
 *  - two rows of letterhead above the header
 *  - ticket numbers without the hyphen
 *  - "(35.00)" for a withheld fee
 *  - a paid line for a ticket that is not in the batch
 *  - a ticket that earned nothing but was paid anyway
 *  - a totals row at the foot with no ticket number
 *  - a column the reader has never seen
 */
const STATEMENT = [
  'MAIN ST TRAVEL,,,,',
  'Weekly agent statement — week ending 05 SEP 2026,,,,',
  'Ticket Number,Type,Commission,Fees,Net Payable,Batch Ref',
  '1147503646565,TKT,"89.76","(35.00)","54.76",B-1188',
  '1147507450808,TKT,"0.00","-","0.00",B-1188',
  '1147507450809,TKT,"0.00","-","0.00",B-1188',
  '1147507450810,TKT,"120.00","-","120.00",B-1188',
  '1147508318520,EXCH,"15.00","-","15.00",B-1189',
  '1149999999999,TKT,"42.00","-","42.00",B-1189',
  'TOTAL,,"266.76","(35.00)","231.76",',
].join('\n');

const parsed = parseStatementCsv(STATEMENT);
const RULES = rulesFor(MAIN_ST_TRAVEL, 'subagent');
const result = settle({
  tickets, statement: parsed.lines, rules: RULES, subAgentId: SUB_AGENT_ID,
});
const row = (t: string) => result.rows.find((r) => r.ticketNumber.replace(/\D/g, '').endsWith(t))!;

describe('reading a real-shaped statement', () => {
  it('finds the header under the letterhead', () => {
    expect(parsed.warnings.some((w) => /2 row\(s\) above the header were skipped/.test(w))).toBe(true);
  });

  it('maps the columns it recognises and names the one it does not', () => {
    expect(parsed.mapping).toMatchObject({
      'Ticket Number': 'ticketNumber', Type: 'documentType',
      Commission: 'gross', Fees: 'fees', 'Net Payable': 'net',
    });
    expect(parsed.unmapped).toEqual(['Batch Ref']);
    expect(parsed.warnings.some((w) => /carried through but not interpreted: Batch Ref/.test(w))).toBe(true);
  });

  it('drops the totals row rather than reading it as a ticket', () => {
    expect(parsed.lines).toHaveLength(6);
    expect(parsed.lines.every((l) => /\d/.test(l.ticketNumber))).toBe(true);
  });

  it('restores the hyphen in a ticket number', () => {
    expect(parsed.lines[0].ticketNumber).toBe('114-7503646565');
    expect(normaliseTicketNumber('114 7503646565')).toBe('114-7503646565');
  });

  it('reads accounting notation', () => {
    expect(f(parseStatementAmount('(35.00)', 'USD')!)).toBe('-35.00');
    expect(f(parseStatementAmount('$1,234.56', 'USD')!)).toBe('1234.56');
    expect(parseStatementAmount('—', 'USD')).toBeNull();
    expect(parseStatementAmount('', 'USD')).toBeNull();
  });
});

describe('where the statement and the contract disagree', () => {
  it('accepts a line paid exactly right, but flags the deduction behind it', () => {
    // 1496.00 at S: the consolidator earns 7%, the sub-agent 6% = 89.76. The
    // share is right; the 35.00 withheld is not covered by anything supplied.
    const r = row('7503646565');
    expect(f(r.expected)).toBe('89.76');
    expect(f(r.statedGross!)).toBe('89.76');
    expect(r.reason).toBe('DEDUCTION');
    expect(f(r.statedFees!)).toBe('-35.00');
    expect(r.explanation).toMatch(/no supplied agreement covers it/);
  });

  it('flags money paid on a document the contract gives nothing for', () => {
    // A bulk fare. Clause 13(b) excludes it whatever the tour code says, so
    // the 120.00 on the statement is paid against nothing.
    const r = row('7507450810');
    expect(f(r.expected)).toBe('0.00');
    expect(f(r.statedGross!)).toBe('120.00');
    expect(r.reason).toBe('PAID_WHERE_NONE_DUE');
  });

  it('flags a payment on a journey that originates outside the territory', () => {
    const r = row('7508318520');
    expect(f(r.expected)).toBe('0.00');
    expect(r.reason).toBe('PAID_WHERE_NONE_DUE');
    expect(r.explanation).toMatch(/§7/);
  });

  it('flags a payment for a document not in the batch', () => {
    const r = row('9999999999');
    expect(r.reason).toBe('NOT_IN_TICKETS');
    expect(f(r.variance)).toBe('42.00');
    expect(r.explanation).toMatch(/cannot be checked against a contract/);
  });

  it('agrees where both sides say nothing', () => {
    expect(row('7507450808').reason).toBe('CORRECTLY_NIL');
    expect(row('7507450809').reason).toBe('CORRECTLY_NIL');
  });

  it('flags a ticket left off the statement entirely', () => {
    // 114-7507682876 is in the batch and absent from the statement. It is a
    // bulk fare and earns nothing, so this is agreement rather than a
    // shortfall — and the two have to be told apart.
    const r = row('7507682876');
    expect(r.reason).toBe('CORRECTLY_NIL');
    expect(r.statementRow).toBeNull();
  });
});

describe('totals a person can act on', () => {
  it('separates what was short-paid from what was withheld', () => {
    expect(f(result.totals.expected)).toBe('89.76');
    expect(f(result.totals.shortPaid)).toBe('0.00');
    expect(f(result.totals.unexplainedDeductions)).toBe('-35.00');
    expect(f(result.totals.overPaid)).toBe('0.00');
  });

  it('ranks what needs attention above what does not', () => {
    expect(result.rows[0].severity).not.toBe('ok');
    expect(result.rows.at(-1)!.severity).toBe('ok');
  });

  it('counts every row exactly once', () => {
    const total = [...result.byReason.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(result.rows.length);
    expect(result.rows).toHaveLength(tickets.length + 1); // + the unmatched line
  });
});

describe('short payment is detected as short payment', () => {
  it('separates a shortfall from a fee', () => {
    const short = parseStatementCsv([
      'Ticket Number,Commission,Net Payable',
      '1147503646565,"70.00","70.00"',
    ].join('\n'));
    const r = settle({
      tickets, statement: short.lines, rules: RULES, subAgentId: SUB_AGENT_ID,
    }).rows.find((x) => x.ticketNumber === '114-7503646565')!;
    expect(r.reason).toBe('SHORT_PAID');
    expect(f(r.variance)).toBe('-19.76'); // 70.00 against 89.76
    expect(r.severity).toBe('critical');
  });
});
