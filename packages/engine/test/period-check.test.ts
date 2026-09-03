import { describe, expect, it } from 'vitest';
import { isoWeek, periodKeyFor, periodsIn, inPeriod, describeBounds } from '../../../src/commission/period';

/**
 * ISO weeks decide which week a ticket is claimed in, so the boundaries have
 * to be right rather than approximately right.
 */
describe('ISO weeks', () => {
  it('puts a date in the year that holds its Thursday', () => {
    // 1 Jan 2027 is a Friday, so it belongs to week 53 of 2026.
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toEqual({ year: 2026, week: 53 });
    // 4 Jan is always in week 1.
    expect(isoWeek(new Date(Date.UTC(2026, 0, 4)))).toEqual({ year: 2026, week: 1 });
  });

  it('runs Monday to Sunday', () => {
    expect(periodKeyFor('2026-08-31', 'week')).toBe('2026-W36'); // Monday
    expect(periodKeyFor('2026-09-06', 'week')).toBe('2026-W36'); // Sunday
    expect(periodKeyFor('2026-09-07', 'week')).toBe('2026-W37'); // next Monday
  });

  it('groups by calendar month too', () => {
    expect(periodKeyFor('2026-08-31', 'month')).toBe('2026-08');
    expect(periodKeyFor('2026-09-01', 'month')).toBe('2026-09');
  });
});

describe('periods over a batch', () => {
  const docs = [
    { issueDate: '2026-08-28' }, { issueDate: '2026-08-27' },
    { issueDate: '2026-09-02' }, { issueDate: '2026-09-02' },
    { issueDate: '2026-08-01' },
  ];

  it('lists every period present, most recent first', () => {
    const weeks = periodsIn(docs, 'week');
    expect(weeks.map((w) => w.key)).toEqual(['2026-W36', '2026-W35', '2026-W31']);
    expect(weeks[0].documents).toBe(2);
  });

  it('counts a month across the weeks inside it', () => {
    const months = periodsIn(docs, 'month');
    expect(months.map((m) => `${m.key}:${m.documents}`)).toEqual(['2026-09:2', '2026-08:3']);
  });

  it('filters a batch down to one period', () => {
    const week = periodsIn(docs, 'week')[0];
    expect(inPeriod(docs, week)).toHaveLength(2);
    expect(inPeriod(docs, null)).toHaveLength(5);
  });

  it('spells the bounds out for a reader', () => {
    const [w36] = periodsIn(docs, 'week');
    expect(w36.from).toBe('2026-08-31');
    expect(w36.to).toBe('2026-09-06');
    expect(describeBounds(w36)).toBe('31 August – 6 September 2026');
  });
});
