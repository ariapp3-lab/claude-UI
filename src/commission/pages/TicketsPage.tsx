import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Download, Search, Upload } from 'lucide-react';
import { calculate, formatMoney } from '@commission/engine';
import type { Rule, TicketDocument } from '@commission/engine';
import { Amount, Panel, Pill, StatCard, type Tone } from '../components/primitives';
import { FolderSource } from '../components/FolderSource';
import { TraceView, WaterfallView } from '../components/Waterfall';
import { detectConsolidators, money, routeOf } from '../data';
import { useBatch } from '../batch';
import { useWorkspace, WorkspaceBar } from '../workspace';

/**
 * Every document, by name and number.
 *
 * The variance queue answers "what needs attention"; this answers "where is
 * that ticket". Different question, so it is a different page: searchable on
 * the passenger, the number, the route or the class, and sortable on what the
 * agency cares about — the money.
 */
type SortKey = 'ticket' | 'name' | 'date' | 'earns';

const PAGE = 100;

interface Row {
  readonly ticketNumber: string;
  readonly name: string;
  readonly title: string | null;
  readonly paxType: string;
  readonly route: string;
  readonly classes: string;
  readonly documentType: string;
  readonly issueDate: string;
  readonly baseFare: { units: bigint; currency: string };
  readonly earns: { units: bigint; currency: string };
  /** The document, not the calculation — see the note in Finding. */
  readonly ticket: TicketDocument;
  readonly haystack: string;
}

export default function TicketsPage() {
  const { rules, subAgentId, view } = useWorkspace();
  const batch = useBatch();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('earns');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const detected = useMemo(() => detectConsolidators(batch.passengers), [batch.passengers]);

  const rows = useMemo<Row[]>(() => batch.passengers.map((p) => {
    const t = p.ticket;
    const w = calculate({ ticket: t, rules, subAgentId: subAgentId ?? undefined });
    const name = t.passengerName ?? '—';
    const route = routeOf(t);
    const classes = [...new Set(t.coupons.map((c) => c.rbd))].join('/') || '—';
    return {
      ticketNumber: t.ticketNumber, name, title: t.passengerTitle ?? null,
      paxType: t.paxType, route, classes, documentType: t.documentType,
      issueDate: t.issueDate, baseFare: t.baseFare,
      earns: subAgentId ? (w.subAgent?.commission ?? w.carrier.commission) : w.carrier.commission,
      ticket: t,
      haystack: `${t.ticketNumber} ${name} ${route} ${classes} ${t.documentType} ${t.issueDate}`.toLowerCase(),
    };
  }), [batch.passengers, rules, subAgentId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q ? rows.filter((r) => r.haystack.includes(q)) : rows;
    const sorted = [...hit];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':   return a.name.localeCompare(b.name);
        case 'ticket': return a.ticketNumber.localeCompare(b.ticketNumber);
        case 'date':   return b.issueDate.localeCompare(a.issueDate);
        default:       return Number(b.earns.units - a.earns.units);
      }
    });
    return sorted;
  }, [rows, query, sort]);

  const shown = filtered.slice(0, limit);
  const earning = filtered.filter((r) => r.earns.units > 0n).length;
  const totalEarns = filtered.reduce((a, r) => a + r.earns.units, 0n);

  function exportCsv() {
    const head = ['ticket_number', 'passenger', 'title', 'pax_type', 'route',
                  'classes', 'document_type', 'issue_date', 'base_fare', 'earns'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = filtered.map((r) => [
      r.ticketNumber, r.name, r.title ?? '', r.paxType, r.route, r.classes,
      r.documentType, r.issueDate, formatMoney(r.baseFare), formatMoney(r.earns),
    ].map((v) => esc(String(v))).join(','));
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tickets.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <WorkspaceBar detected={detected} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">Tickets</h1>
          <p className="text-[13.5px] text-slate-600 mt-1 max-w-[62ch]">
            Every document in the batch, by passenger and by number. Search on any
            of it; select a row for the full calculation.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer">
            <Upload size={14} /> Individual files
            <input type="file" multiple className="hidden"
                   onChange={async (e) => {
                     const list = e.target.files; if (!list) return;
                     const added = await Promise.all(Array.from(list).map(async (f) => ({
                       name: f.name, text: await f.text(), bundled: false,
                     })));
                     await batch.load(added, 'selected files');
                   }} />
          </label>
          <button className="btn-primary" onClick={exportCsv}><Download size={14} /> CSV</button>
        </div>
      </div>

      <FolderSource count={batch.fileCount} />

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(178px,1fr))]">
        <StatCard label="Documents" value={filtered.length.toLocaleString()}
                  note={query
                    ? `of ${rows.length.toLocaleString()} matching "${query}"`
                    : `${batch.fileCount.toLocaleString()} files`} />
        <StatCard label="Earning" value={earning.toLocaleString()}
                  tone={earning > 0 ? 'ok' : undefined} note="carry commission" />
        <StatCard label={view === 'subagent' ? 'My commission' : 'Carrier commission'}
                  value={money({ units: totalEarns, currency: 'USD' })}
                  tone={totalEarns > 0n ? 'ok' : totalEarns < 0n ? 'critical' : undefined} />
      </div>

      <Panel
        title="All documents"
        flush
        subtitle={filtered.length > shown.length
          ? `Showing ${shown.length.toLocaleString()} of ${filtered.length.toLocaleString()}`
          : undefined}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
                placeholder="Passenger, ticket, route…"
                aria-label="Search tickets"
                className="w-56 pl-8 pr-3 py-1.5 text-[13px] bg-surface-subtle border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder-slate-400"
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label="Sort by"
                    className="text-[13px] px-2.5 py-1.5 bg-surface-subtle border border-surface-border rounded-lg focus:outline-none cursor-pointer">
              <option value="earns">Sort: commission</option>
              <option value="name">Sort: passenger</option>
              <option value="ticket">Sort: ticket number</option>
              <option value="date">Sort: issue date</option>
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Passenger', 'Ticket', 'Route', 'Cls', 'Doc', 'Issued', 'Fare', 'Earns'].map((h, i) => (
                  <th key={h} className={clsx(
                    'px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-slate-400 whitespace-nowrap',
                    i >= 6 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <TicketRow key={r.ticketNumber} r={r} rules={rules}
                           open={open === r.ticketNumber}
                           onToggle={() => setOpen(open === r.ticketNumber ? null : r.ticketNumber)} />
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-[13px]">
                  {query ? `Nothing matches “${query}”.` : 'No documents loaded.'}
                </td></tr>
              )}
              {filtered.length > shown.length && (
                <tr><td colSpan={8} className="px-4 py-4 text-center">
                  <button className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, filtered.length - shown.length).toLocaleString()} more
                  </button>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function TicketRow({ r, rules, open, onToggle }: {
  r: Row; rules: readonly Rule[]; open: boolean; onToggle: () => void;
}) {
  const paxTone: Tone | undefined = r.paxType === 'CHD' || r.paxType === 'INF' ? 'info' : undefined;
  const w = open ? calculate({ ticket: r.ticket, rules }) : null;
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-surface-subtle border-b border-surface-border">
        <td className="px-4 py-2.5">
          <span className="font-medium text-slate-900">{r.name}</span>
          {r.title && <span className="text-slate-400 text-[11.5px] ml-1.5">{r.title}</span>}
          {paxTone && <span className="ml-2"><Pill tone={paxTone}>{r.paxType}</Pill></span>}
        </td>
        <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-700 whitespace-nowrap">{r.ticketNumber}</td>
        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.route}</td>
        <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-600">{r.classes}</td>
        <td className="px-4 py-2.5"><Pill>{r.documentType}</Pill></td>
        <td className="px-4 py-2.5 font-mono text-[12px] text-slate-500 whitespace-nowrap">{r.issueDate}</td>
        <td className="px-4 py-2.5 text-right"><Amount m={r.baseFare} /></td>
        <td className="px-4 py-2.5 text-right"><Amount m={r.earns} bold /></td>
      </tr>
      {open && w && (
        <tr className="bg-surface-subtle border-b border-surface-border">
          <td colSpan={8} className="p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start">
              <div className="card p-4 min-w-0">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                  Calculation
                </h3>
                <WaterfallView w={w!} />
              </div>
              <div className="card p-4 min-w-0">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                  Why — every condition tested
                </h3>
                <TraceView w={w!} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
