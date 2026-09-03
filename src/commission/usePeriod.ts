import { useMemo, useState } from 'react';
import { type Granularity, type Period, periodsIn } from './period';

/**
 * The period a page is showing.
 *
 * Defaults to the most recent week, because "what do I claim this week" is the
 * question being asked far more often than "what happened in March". The
 * selection survives a change of granularity by falling back to the newest
 * period rather than emptying the page.
 */
export function usePeriod(documents: readonly { issueDate: string }[]) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [key, setKey] = useState<string | null>(null);

  const periods = useMemo(
    () => periodsIn(documents, granularity),
    [documents, granularity],
  );

  const selected: Period | null = useMemo(() => {
    if (granularity === 'all') return periods[0] ?? null;
    return periods.find((p) => p.key === key) ?? periods[0] ?? null;
  }, [periods, key, granularity]);

  return {
    granularity,
    periods,
    selected,
    setGranularity: (g: Granularity) => { setGranularity(g); setKey(null); },
    select: setKey,
  };
}
