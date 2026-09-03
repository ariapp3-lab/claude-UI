import clsx from 'clsx';
import { CalendarDays } from 'lucide-react';
import { describeBounds, type Granularity, type Period } from '../period';

/**
 * Which settlement period is on screen.
 *
 * Weeks lead because that is how a consolidator pays and how the claim window
 * closes; months are for the view back. The counts sit on the options so a
 * period with no documents is visibly empty rather than mysteriously so.
 */
export function PeriodPicker({
  granularity, onGranularity, periods, selected, onSelect,
}: {
  granularity: Granularity;
  onGranularity(g: Granularity): void;
  periods: readonly Period[];
  selected: Period | null;
  onSelect(key: string): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <CalendarDays size={15} className="text-slate-400 shrink-0" />
        <div className="flex rounded-lg bg-surface-muted p-0.5">
          {(['week', 'month', 'all'] as const).map((g) => (
            <button key={g} onClick={() => onGranularity(g)} aria-pressed={granularity === g}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[12.5px] font-medium capitalize transition-colors',
                granularity === g
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}>
              {g === 'all' ? 'All' : g}
            </button>
          ))}
        </div>
      </div>

      {granularity !== 'all' && (
        <select
          value={selected?.key ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Settlement period"
          className="text-[13px] font-medium px-2.5 py-1.5 bg-surface-subtle border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
        >
          {periods.length === 0 && <option value="">No documents loaded</option>}
          {periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} — {p.documents.toLocaleString()}
            </option>
          ))}
        </select>
      )}

      {selected && selected.from && (
        <span className="text-[12px] text-slate-400 font-mono">{describeBounds(selected)}</span>
      )}
    </div>
  );
}

/** Everything the pages need to hold a period, in one place. */
export interface PeriodState {
  readonly granularity: Granularity;
  readonly periods: readonly Period[];
  readonly selected: Period | null;
  setGranularity(g: Granularity): void;
  select(key: string): void;
}
