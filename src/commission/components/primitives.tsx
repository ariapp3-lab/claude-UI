import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Money } from '@commission/engine';
import { isNeg, money } from '../data';

/* Semantic colour is kept apart from the brand accent: in a settlement product
   green has to mean "settled", not "our logo". */
const TONE = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  ok:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  neutral:  'bg-slate-100 text-slate-600 border-slate-200',
  info:     'bg-blue-50 text-blue-700 border-blue-200',
} as const;

export type Tone = keyof typeof TONE;

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] font-mono font-medium tracking-wide whitespace-nowrap',
      TONE[tone],
    )}>{children}</span>
  );
}

export function StatCard({
  label, value, note, tone,
}: { label: string; value: string; note?: string; tone?: Tone }) {
  return (
    <div className={clsx(
      'card p-4 flex flex-col gap-1',
      tone === 'critical' && 'border-red-200',
      tone === 'warning' && 'border-amber-200',
    )}>
      <span className="text-[11.5px] font-medium text-slate-500">{label}</span>
      <span className={clsx(
        'font-mono text-[22px] font-semibold tracking-tight tabular-nums leading-tight',
        tone === 'critical' && 'text-red-700',
        tone === 'warning' && 'text-amber-700',
        tone === 'ok' && 'text-emerald-700',
        !tone && 'text-slate-900',
      )}>{value}</span>
      {note && <span className="text-[11.5px] text-slate-500">{note}</span>}
    </div>
  );
}

export function Panel({
  title, subtitle, actions, children, flush,
}: {
  title: string; subtitle?: string; actions?: ReactNode;
  children: ReactNode; flush?: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-surface-border">
        <div>
          <h2 className="text-[14.5px] font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Amount({ m, bold }: { m: Money | null | undefined; bold?: boolean }) {
  return (
    <span className={clsx(
      'font-mono tabular-nums whitespace-nowrap',
      bold && 'font-semibold',
      isNeg(m) ? 'text-red-700' : m && m.units === 0n ? 'text-slate-400' : 'text-slate-900',
    )}>{money(m)}</span>
  );
}

export function Note({ tone = 'info', title, children }: {
  tone?: Tone; title?: string; children: ReactNode;
}) {
  return (
    <div className={clsx('flex gap-3 px-4 py-3 rounded-lg border text-[12.8px] leading-relaxed', TONE[tone])}>
      <span className="font-mono font-semibold shrink-0">
        {tone === 'critical' ? '!' : tone === 'warning' ? '!' : 'i'}
      </span>
      <div className="text-slate-800">
        {title && <b className="font-semibold">{title} </b>}
        {children}
      </div>
    </div>
  );
}
