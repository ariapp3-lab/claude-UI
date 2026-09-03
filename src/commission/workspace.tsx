import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Building2 } from 'lucide-react';
import type { Rule } from '@commission/engine';
import {
  CONSOLIDATORS, rulesFor, type Consolidator,
} from '../../packages/engine/contracts/consolidators';
import { SUB_AGENT_ID } from '../../packages/engine/contracts/subagent-aappel-2026';
import type { DetectedConsolidator } from './data';

/**
 * Who is looking, and at whose contracts.
 *
 * The same engine serves both sides of the relationship. A consolidator running
 * this standalone sees what the carrier owes it; a sub-agent under that
 * consolidator sees what is left after the retention. An agency that works with
 * more than one consolidator holds a different rate card and a different
 * statement for each, so the consolidator is the frame — not a setting.
 */
export type View = 'host' | 'subagent';

interface Workspace {
  readonly consolidator: Consolidator;
  readonly view: View;
  readonly rules: Rule[];
  readonly subAgentId: string | null;
  setConsolidator(id: string): void;
  setView(v: View): void;
}

const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider(
  { children, defaultView = 'subagent' }: { children: ReactNode; defaultView?: View },
) {
  const [id, setId] = useState(CONSOLIDATORS[0].id);
  const [view, setView] = useState<View>(defaultView);

  const value = useMemo<Workspace>(() => {
    const consolidator = CONSOLIDATORS.find((c) => c.id === id) ?? CONSOLIDATORS[0];
    return {
      consolidator, view,
      rules: rulesFor(consolidator, view),
      subAgentId: view === 'subagent' ? SUB_AGENT_ID : null,
      setConsolidator: setId,
      setView,
    };
  }, [id, view]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  return w;
}

/**
 * The bar that says whose books these are.
 *
 * When a batch is loaded the consolidator is not chosen — it is read off the
 * tickets, which carry the IATA number they were issued under. The picker only
 * appears where the documents cannot answer the question themselves.
 */
export function WorkspaceBar({ detected }: { detected?: readonly DetectedConsolidator[] }) {
  const { consolidator, view, setConsolidator, setView } = useWorkspace();

  const known = (detected ?? []).filter((d) => d.consolidator);
  const unknown = (detected ?? []).filter((d) => !d.consolidator);
  const auto = known.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3 -mx-6 -mt-6 mb-1 px-6 py-2.5 bg-white border-b border-surface-border">
      <Building2 size={15} className="text-slate-400 shrink-0" />
      {auto ? (
        <div className="flex flex-wrap items-center gap-2">
          {known.map((d) => (
            <button key={d.iata} onClick={() => setConsolidator(d.consolidator!.id)}
              aria-pressed={consolidator.id === d.consolidator!.id}
              className={clsx(
                'text-[13px] font-medium px-2 py-0.5 rounded-md',
                known.length === 1 ? 'text-slate-900 cursor-default'
                  : consolidator.id === d.consolidator!.id
                    ? 'bg-surface-muted text-slate-900' : 'text-slate-500 hover:text-slate-800',
              )}>
              {d.consolidator!.name}
              <span className="font-mono text-[11px] text-slate-400 ml-1.5">
                IATA {d.iata} · {d.tickets}
              </span>
            </button>
          ))}
          <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400">
            from the tickets
          </span>
        </div>
      ) : (
        <select
          value={consolidator.id}
          onChange={(e) => setConsolidator(e.target.value)}
          aria-label="Consolidator"
          className="text-[13px] font-medium bg-transparent border-0 focus:ring-0 focus:outline-none cursor-pointer text-slate-900"
        >
          {CONSOLIDATORS.map((c) => (
            <option key={c.id} value={c.id}>{c.name} · IATA {c.iata}</option>
          ))}
        </select>
      )}

      <div className="flex rounded-lg bg-surface-muted p-0.5">
        {([['subagent', 'I am the sub-agent'], ['host', 'I am the consolidator']] as const)
          .map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={clsx(
                'px-3 py-1 rounded-md text-[12.5px] font-medium transition-colors',
                view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}>{label}</button>
          ))}
      </div>

      {unknown.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-700">
          <AlertTriangle size={13} />
          {unknown.reduce((a, d) => a + d.tickets, 0)} ticket(s) on IATA{' '}
          {unknown.map((d) => d.iata).join(', ')} — no contracts held, not priced
        </span>
      )}

      <span className="text-[12px] text-slate-400 ml-auto hidden lg:block">
        {view === 'subagent' ? consolidator.terms : `Carriers: ${consolidator.carriers.join(', ')}`}
      </span>
    </div>
  );
}
