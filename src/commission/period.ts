/**
 * Periods.
 *
 * Commission is settled on a calendar: a consolidator pays weekly, a carrier
 * contract runs to a month end, and "what do I claim this week" is the question
 * the whole system exists to answer. So a batch is not one heap of documents —
 * it is a set of periods, and the period is a filter over every page.
 *
 * Periods key off the ISSUE date, not travel. Commission is earned when the
 * ticket is sold: EL AL's clause 8 allows a claim at ticketing only, and a
 * ticket sold in August for travel in December belongs to August's settlement.
 */

export type Granularity = 'week' | 'month' | 'all';

export interface Period {
  /** Sortable and stable: "2026-W36", "2026-09", or "all". */
  readonly key: string;
  readonly label: string;
  readonly granularity: Granularity;
  /** Inclusive ISO date bounds; absent for "all". */
  readonly from?: string;
  readonly to?: string;
  readonly documents: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseISO(d: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The ISO-8601 week a date falls in.
 *
 * ISO weeks run Monday to Sunday and belong to the year holding their Thursday,
 * which is why 1 January can sit in week 52 of the year before. Settlement
 * calendars use them, so getting the boundary right is not pedantry — it is
 * which week a ticket is claimed in.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;               // Sunday is 7, not 0
  d.setUTCDate(d.getUTCDate() + 4 - day);       // move to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function weekBounds(date: Date): { from: string; to: string } {
  const d = new Date(date.getTime());
  const day = d.getUTCDay() || 7;
  const monday = new Date(d.getTime() - (day - 1) * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: iso(monday), to: iso(sunday) };
}

export function periodKeyFor(issueDate: string, granularity: Granularity): string | null {
  if (granularity === 'all') return 'all';
  const d = parseISO(issueDate);
  if (!d) return null;
  if (granularity === 'month') return issueDate.slice(0, 7);
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function labelFor(key: string, granularity: Granularity): string {
  if (granularity === 'all') return 'All periods';
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  return `Week ${key.slice(6)} · ${key.slice(0, 4)}`;
}

/** Every period present in a set of documents, most recent first. */
export function periodsIn(
  documents: readonly { issueDate: string }[],
  granularity: Granularity,
): Period[] {
  if (granularity === 'all') {
    return [{ key: 'all', label: 'All periods', granularity, documents: documents.length }];
  }

  const counts = new Map<string, number>();
  for (const doc of documents) {
    const key = periodKeyFor(doc.issueDate, granularity);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const bounds = granularity === 'week'
        ? weekBoundsForKey(key)
        : monthBoundsForKey(key);
      return {
        key,
        label: labelFor(key, granularity),
        granularity,
        documents: count,
        ...bounds,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

function weekBoundsForKey(key: string): { from: string; to: string } {
  const year = Number(key.slice(0, 4));
  const week = Number(key.slice(6));
  // 4 January is always in ISO week 1, so it anchors the year's calendar.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (day - 1) * 86_400_000);
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  return weekBounds(monday);
}

function monthBoundsForKey(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from: iso(from), to: iso(to) };
}

/** Everything issued inside the period. "all" filters nothing. */
export function inPeriod<T extends { issueDate: string }>(
  documents: readonly T[],
  period: Period | null,
): T[] {
  if (!period || period.key === 'all') return [...documents];
  return documents.filter((d) => periodKeyFor(d.issueDate, period.granularity) === period.key);
}

/** A period's dates, spelled out — "1–7 September 2026". */
export function describeBounds(period: Period): string {
  if (!period.from || !period.to) return '';
  const from = parseISO(period.from);
  const to = parseISO(period.to);
  if (!from || !to) return '';
  const sameMonth = from.getUTCMonth() === to.getUTCMonth();
  const month = (d: Date) => MONTHS[d.getUTCMonth()];
  return sameMonth
    ? `${from.getUTCDate()}–${to.getUTCDate()} ${month(to)} ${to.getUTCFullYear()}`
    : `${from.getUTCDate()} ${month(from)} – ${to.getUTCDate()} ${month(to)} ${to.getUTCFullYear()}`;
}
