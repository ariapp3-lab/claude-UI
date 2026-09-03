import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Download, Upload } from 'lucide-react';
import type { Finding } from '@commission/cli';
import { toCsv } from '../../../packages/cli/src/report';
import { Amount, Note, Panel, Pill, StatCard, type Tone } from '../components/primitives';
import { FolderSource } from '../components/FolderSource';
import { TraceView, WaterfallView } from '../components/Waterfall';
import {
  BUNDLED_FILES, detectConsolidators, money, priceFiles, type LoadedFile,
} from '../data';
import { useWorkspace, WorkspaceBar } from '../workspace';

/** The table is a work queue, not an archive; the export is the archive. */
const ROWS_PER_PAGE = 100;

const TONE_OF: Record<string, Tone> = {
  critical: 'critical', warning: 'warning', ok: 'ok',
};

export default function ReconciliationPage() {
  const { consolidator } = useWorkspace();
  const [files, setFiles] = useState<LoadedFile[]>(BUNDLED_FILES);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(ROWS_PER_PAGE);

  const batch = useMemo(() => priceFiles(files), [files]);
  const detected = useMemo(() => detectConsolidators(batch.passengers), [batch]);
  const { result } = batch;
  const t = result.totals;

  // A week can be several thousand documents. Findings are already ranked by
  // severity and then by money, so the head of the list is the work — but the
  // totals above are always over the whole batch, never over what is displayed.
  const matching = showAll
    ? result.findings
    : result.findings.filter((f) => f.severity !== 'ok');
  const rows = matching.slice(0, limit);

  async function onDrop(list: FileList | null) {
    if (!list) return;
    const added: LoadedFile[] = [];
    for (const f of Array.from(list)) {
      added.push({ name: f.name, text: await f.text(), bundled: false });
    }
    setFiles((prev) => [...prev.filter((p) => !p.bundled), ...added]);
  }

  function exportCsv() {
    const blob = new Blob([toCsv(result)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reconciliation.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <WorkspaceBar detected={detected} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">Reconciliation</h1>
          <p className="text-[13.5px] text-slate-600 mt-1 max-w-[62ch]">
            {batch.fileCount} file{batch.fileCount === 1 ? '' : 's'} priced against{' '}
            {consolidator.name}'s carrier contracts. Every figure is computed here from the
            documents themselves — nothing is stored and nothing is estimated.
          </p>
        </div>
        <label className="btn-secondary cursor-pointer">
          <Upload size={14} /> Individual files
          {/* No extension filter: a Server Pro capture writes .M07. */}
          <input type="file" multiple className="hidden"
                 onChange={(e) => void onDrop(e.target.files)} />
        </label>
      </div>

      <FolderSource count={files.filter((f) => f.bundled).length}
                    onFiles={(loaded) => setFiles(loaded)} />

      <Note tone="warning" title="Clause 8 — commission may be claimed at ticketing only.">
        No retroactive settlement is made for commission not taken at the time of
        ticketing, so anything below must be corrected before this period is filed.
      </Note>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(178px,1fr))]">
        <StatCard label="Documents priced" value={String(t.documents)}
                  note={`${batch.fileCount} source file${batch.fileCount === 1 ? '' : 's'}`} />
        <StatCard label="Fare value" value={money(t.fareValue)} note="USD, base fare" />
        <StatCard label="Commission claimed" value={money(t.claimed)} />
        {t.forfeited.units > 0n && (
          <StatCard label="Forfeited to an exclusion" value={money(t.forfeited)}
                    note="recoverable if corrected" tone="critical" />
        )}
        {t.overclaimed.units > 0n && (
          <StatCard label="Claimed without entitlement" value={money(t.overclaimed)}
                    note="debit-memo exposure" tone="critical" />
        )}
        {t.clawback.units < 0n && (
          <StatCard label="Owed back on reissues" value={money(t.clawback)}
                    note="the replaced ticket earned more" tone="critical" />
        )}
        {t.markup.units > 0n && (
          <StatCard label="Net-fare markup" value={money(t.markup)}
                    note="revenue, not commission" tone="ok" />
        )}
        {t.noRevenue > 0 && (
          <StatCard label="Earned nothing at all" value={String(t.noRevenue)}
                    note="bulk fares sold at cost" tone="warning" />
        )}
      </div>

      <Panel
        title="Variance queue"
        subtitle={matching.length > rows.length
          ? `Ranked by what is at stake — showing ${rows.length.toLocaleString()} of ${matching.length.toLocaleString()}`
          : 'Select a row for the clause that decided it'}
        flush
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAll((v) => !v); setLimit(ROWS_PER_PAGE); }}
                    className="btn-secondary">
              {showAll ? 'Only what needs attention' : 'Show every document'}
            </button>
            <button onClick={exportCsv} className="btn-primary"><Download size={14} /> CSV</button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Ticket', 'Cls', 'Fare type', 'Finding', 'Claimed', 'Per contract', 'At stake', ''].map((h, i) => (
                  <th key={h + i} className={clsx(
                    'px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-slate-400 whitespace-nowrap',
                    i >= 4 && i <= 6 ? 'text-right' : 'text-left',
                  )}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <Row key={f.ticketNumber} f={f}
                     open={open === f.ticketNumber}
                     onToggle={() => setOpen(open === f.ticketNumber ? null : f.ticketNumber)} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-[13px]">
                  Nothing needs attention in this batch.
                </td></tr>
              )}
              {matching.length > rows.length && (
                <tr><td colSpan={8} className="px-4 py-4 text-center">
                  <button className="btn-secondary"
                          onClick={() => setLimit((n) => n + ROWS_PER_PAGE)}>
                    Show {Math.min(ROWS_PER_PAGE, matching.length - rows.length).toLocaleString()} more
                  </button>
                  <span className="block text-[12px] text-slate-400 mt-2">
                    {(matching.length - rows.length).toLocaleString()} further row(s) — the CSV export
                    carries every document
                  </span>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {(result.warnings.length > 0 || batch.failures.length > 0) && (
        <Panel title="Parse notes"
               subtitle="What the reader could not resolve, reported rather than absorbed">
          <ul className="space-y-1.5">
            {batch.failures.map((w, i) => (
              <li key={`f${i}`} className="text-[12.5px] text-red-700 font-mono">{w}</li>
            ))}
            {result.warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] text-slate-500">
                <span className="text-slate-300 mr-2">·</span>{w}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Row({ f, open, onToggle }: { f: Finding; open: boolean; onToggle: () => void }) {
  const stake = f.recoverable ?? f.variance;
  return (
    <>
      <tr onClick={onToggle}
          className="cursor-pointer hover:bg-surface-subtle border-b border-surface-border">
        <td className={clsx(
          'px-4 py-2.5 border-l-[3px]',
          f.severity === 'critical' ? 'border-l-red-500'
            : f.severity === 'warning' ? 'border-l-amber-500' : 'border-l-emerald-500',
        )}>
          <span className="font-mono text-[12.5px] font-medium text-slate-900">{f.ticketNumber}</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            {f.route} · {f.documentType} · {f.issueDate}
          </span>
        </td>
        <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-600">{f.classes}</td>
        <td className="px-4 py-2.5"><Pill>{f.fareType}</Pill></td>
        <td className="px-4 py-2.5">
          <Pill tone={TONE_OF[f.severity]}>{f.reason}</Pill>
          {f.clause && <span className="block text-[11px] text-slate-400 mt-0.5 font-mono">{f.clause}</span>}
        </td>
        <td className="px-4 py-2.5 text-right"><Amount m={f.claimed} /></td>
        <td className="px-4 py-2.5 text-right"><Amount m={f.entitled} /></td>
        <td className="px-4 py-2.5 text-right"><Amount m={stake} bold /></td>
        <td className="px-2 py-2.5 text-slate-300">
          <ChevronRight size={15} className={clsx('transition-transform', open && 'rotate-90')} />
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-subtle border-b border-surface-border">
          <td colSpan={8} className="p-4">
            <p className="text-[13px] text-slate-700 mb-3 max-w-[80ch]">{f.explanation}</p>
            <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start">
              <div className="card p-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                  What the contract pays
                </h3>
                <WaterfallView w={f.waterfall} />
              </div>
              <div className="card p-4 min-w-0">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                  Why — every condition tested
                </h3>
                <TraceView w={f.waterfall} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
