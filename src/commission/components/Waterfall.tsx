import clsx from 'clsx';
import type { Waterfall } from '@commission/engine';
import { money } from '../data';

/**
 * The waterfall, rendered so a person can check it against the contract.
 *
 * The struck-through rows are the point: showing that a surcharge was seen and
 * deliberately excluded, with the clause that excluded it, is what turns a
 * number into a claim someone can defend six months later.
 */
export function WaterfallView({ w }: { w: Waterfall }) {
  const rows: { label: string; value: string; kind?: 'out' | 'sub' | 'key' | 'dim' }[] = [];
  const trace = w.carrier.basisTrace ?? [];

  const components = trace.filter((t) => !t.component.includes('–'));
  const sectors = trace.filter((t) => t.component.includes('–'));

  for (const t of components) {
    rows.push({
      label: t.component === 'base_fare' ? 'Base fare' : t.component,
      value: money(t.amount),
      kind: t.included ? undefined : 'out',
    });
  }
  for (const s of sectors) {
    rows.push({ label: `  ${s.component}`, value: money(s.amount), kind: 'dim' });
  }
  rows.push({ label: 'Ticket total', value: money(w.ticketTotal), kind: 'sub' });
  if (w.carrier.basis) {
    rows.push({ label: 'Commissionable basis', value: money(w.carrier.basis), kind: 'sub' });
  }
  if (w.carrier.gross && w.carrier.gross.units !== w.carrier.commission.units) {
    rows.push({ label: 'On this document', value: money(w.carrier.gross) });
  }
  if (w.carrier.priorCommission) {
    rows.push({ label: 'Already recognised', value: money(w.carrier.priorCommission), kind: 'dim' });
  }
  rows.push({ label: 'Carrier commission', value: money(w.carrier.commission), kind: 'sub' });
  if (w.subAgent) {
    rows.push({ label: 'Sub-agent share', value: money(w.subAgent.commission) });
    rows.push({ label: 'Host spread', value: money(w.hostSpread), kind: 'dim' });
  }
  for (const fee of w.fees) {
    rows.push({ label: fee.label, value: money(fee.amount) });
  }
  rows.push({
    label: w.subAgent ? 'NET TO SUB-AGENT' : 'NET TO HOST',
    value: money(w.subAgent ? w.netToSubAgent : w.hostSpread),
    kind: 'key',
  });

  const net = w.subAgent ? w.netToSubAgent : w.hostSpread;

  return (
    <div className="font-mono text-[12.3px] tabular-nums">
      {rows.map((r, i) => (
        <div key={i} className={clsx(
          'flex justify-between gap-4 py-[3px]',
          r.kind === 'sub' && 'border-t border-surface-border mt-1.5 pt-1.5 font-medium',
          r.kind === 'key' && 'border-t border-surface-border mt-2 pt-2.5 font-semibold bg-surface-subtle -mx-4 px-4 pb-2.5',
        )}>
          <span className={clsx(
            r.kind === 'out' && 'text-slate-400',
            r.kind === 'dim' && 'text-slate-400',
            !r.kind && 'text-slate-600',
            (r.kind === 'sub' || r.kind === 'key') && 'text-slate-900',
          )}>
            {r.kind === 'out' && <span className="text-red-500 mr-1.5">×</span>}
            {r.label}
          </span>
          <span className={clsx(
            r.kind === 'out' && 'text-slate-400 line-through',
            r.kind === 'dim' && 'text-slate-400',
            r.kind === 'key' && (net.units < 0n ? 'text-red-700' : net.units > 0n ? 'text-emerald-700' : 'text-slate-500'),
            !r.kind && 'text-slate-900',
            r.kind === 'sub' && 'text-slate-900',
          )}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Every condition the winning clause declared, and how the ticket answered. */
export function TraceView({ w }: { w: Waterfall }) {
  const conditions = w.carrier.conditions ?? [];
  const failed = (w.carrier.rejected ?? [])
    .map((r) => r.failedOn)
    .filter((t): t is NonNullable<typeof t> => !!t);
  const shown = conditions.length > 0 ? conditions : failed;

  return (
    <div className="text-[12.3px] min-w-0">
      {shown.map((c, i) => (
        <div key={i} className="grid grid-cols-[16px_120px_minmax(0,1fr)] gap-2 items-baseline py-1 border-b border-surface-border last:border-0">
          <span className={clsx('font-mono text-[11px]', c.passed ? 'text-emerald-600' : 'text-red-600')}>
            {c.passed ? '✓' : '✗'}
          </span>
          <span className="font-mono text-[11.5px] text-slate-500">{c.field}</span>
          <span className={clsx('break-words min-w-0', c.passed ? 'text-slate-400' : 'text-slate-900')}>
            {c.actual}
            {!c.passed && <span className="text-slate-400"> — expected {c.expected}</span>}
          </span>
        </div>
      ))}
      {(w.carrier.notes ?? []).map((n, i) => (
        <p key={i} className="text-[12px] text-slate-500 mt-2 leading-relaxed break-words">{n}</p>
      ))}
    </div>
  );
}
