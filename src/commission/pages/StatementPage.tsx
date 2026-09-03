import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Upload } from 'lucide-react';
import { parseStatementCsv, type StatementParseResult } from '@commission/parsers';
import { settle, type SettlementRow } from '../../../packages/cli/src/statement';
import { Amount, Note, Panel, Pill, StatCard, type Tone } from '../components/primitives';
import {
  BUNDLED_FILES, detectConsolidators, money, priceFiles, routeOf, type LoadedFile,
} from '../data';
import { useWorkspace, WorkspaceBar } from '../workspace';

const TONE_OF: Record<string, Tone> = { critical: 'critical', warning: 'warning', ok: 'ok' };

/**
 * The weekly statement, against what the tickets earned.
 *
 * The share is verified and the deductions are surfaced separately. Without the
 * fee schedule there is no way to know whether a deduction is contractual, and
 * folding it into one variance would hide which half is in question.
 */
export default function StatementPage() {
  const { consolidator, rules, subAgentId, view } = useWorkspace();
  const [airFiles, setAirFiles] = useState<LoadedFile[]>(BUNDLED_FILES);
  const [statementText, setStatementText] = useState<string | null>(null);
  const [statementName, setStatementName] = useState<string | null>(null);

  const batch = useMemo(() => priceFiles(airFiles), [airFiles]);
  const detected = useMemo(() => detectConsolidators(batch.passengers), [batch]);
  const parsed: StatementParseResult | null = useMemo(
    () => (statementText ? parseStatementCsv(statementText) : null),
    [statementText],
  );

  const result = useMemo(() => {
    if (!parsed || !subAgentId) return null;
    return settle({
      tickets: batch.passengers.map((p) => p.ticket),
      statement: parsed.lines,
      rules, subAgentId,
    });
  }, [parsed, batch, rules, subAgentId]);

  async function loadStatement(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setStatementText(await file.text());
    setStatementName(file.name);
  }

  async function loadAir(list: FileList | null) {
    if (!list) return;
    const added: LoadedFile[] = [];
    for (const f of Array.from(list)) added.push({ name: f.name, text: await f.text(), bundled: false });
    setAirFiles((prev) => [...prev.filter((p) => !p.bundled), ...added]);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <WorkspaceBar detected={detected} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">
            Statement reconciliation
          </h1>
          <p className="text-[13.5px] text-slate-600 mt-1 max-w-[64ch]">
            {consolidator.name} pays weekly. Upload the statement and it is matched,
            line by line, against what the contract says each document earns.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer">
            <Upload size={14} /> AIR files ({batch.passengers.length})
            <input type="file" multiple className="hidden"
                   onChange={(e) => void loadAir(e.target.files)} />
          </label>
          <label className="btn-primary cursor-pointer">
            <Upload size={14} /> {statementName ? 'Replace statement' : 'Upload statement'}
            <input type="file" className="hidden" accept=".csv,.tsv,.txt,text/csv"
                   onChange={(e) => void loadStatement(e.target.files)} />
          </label>
        </div>
      </div>

      {view === 'host' && (
        <Note tone="warning" title="This page settles what a consolidator pays a sub-agent.">
          You are viewing as the consolidator, so there is no inbound statement to
          reconcile. Switch to the sub-agent view, or use Reconciliation for the
          carrier side.
        </Note>
      )}

      {!statementText && view === 'subagent' && (
        <Panel title="Upload this week's statement"
               subtitle="Any delimited export — the columns are matched by their headings">
          <div className="border-[1.5px] border-dashed border-slate-300 rounded-xl px-6 py-10 text-center bg-surface-subtle">
            <p className="text-[14px] font-semibold text-slate-900">
              Drop the statement {consolidator.name} sent you
            </p>
            <p className="text-[12.5px] text-slate-500 mt-1 max-w-[56ch] mx-auto">
              A ticket-number column and a commission or net-payable column are
              enough. Anything else is carried through and reported, not guessed at.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-4">
              {['CSV', 'TSV', 'Excel export', 'letterhead above the header', 'accounting negatives']
                .map((s) => (
                  <span key={s} className="font-mono text-[10.5px] px-2 py-1 rounded bg-surface-muted text-slate-500">{s}</span>
                ))}
            </div>
            <label className="btn-primary mt-5 inline-flex cursor-pointer">
              <Upload size={14} /> Choose a file
              <input type="file" className="hidden" accept=".csv,.tsv,.txt,text/csv"
                     onChange={(e) => void loadStatement(e.target.files)} />
            </label>
          </div>
        </Panel>
      )}

      {parsed && result && (
        <>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(178px,1fr))]">
            <StatCard label="Statement lines" value={String(parsed.lines.length)}
                      note={statementName ?? undefined} />
            <StatCard label="Due per contract" value={money(result.totals.expected)} />
            <StatCard label="Stated on the statement" value={money(result.totals.statedGross)} />
            {result.totals.shortPaid.units < 0n && (
              <StatCard label="Short-paid" value={money(result.totals.shortPaid)}
                        tone="critical" note="claim this" />
            )}
            {result.totals.missing.units > 0n && (
              <StatCard label="Earned, not listed" value={money(result.totals.missing)}
                        tone="critical" note="absent from the statement" />
            )}
            {result.totals.unexplainedDeductions.units !== 0n && (
              <StatCard label="Withheld, unexplained" value={money(result.totals.unexplainedDeductions)}
                        tone="warning" note="no fee schedule on file" />
            )}
            {result.totals.overPaid.units > 0n && (
              <StatCard label="Over-paid" value={money(result.totals.overPaid)}
                        tone="warning" note="likely to be reversed" />
            )}
          </div>

          <Panel title="Line by line" flush
                 subtitle={`${result.rows.length} rows · ${[...result.byReason.entries()]
                   .map(([r, n]) => `${r} ${n}`).join(' · ')}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-[13px]">
                <thead>
                  <tr className="bg-surface-subtle border-b border-surface-border">
                    {['Ticket', 'Cls', 'Finding', 'Due', 'Stated', 'Withheld', 'Variance'].map((h, i) => (
                      <th key={h} className={clsx(
                        'px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-slate-400 whitespace-nowrap',
                        i >= 3 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => <SettleRow key={r.ticketNumber + String(r.statementRow ?? "x")} r={r} />)}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="How the statement was read"
                 subtitle="Columns matched by heading; nothing inferred">
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(parsed.mapping).map(([header, field]) => (
                <span key={header} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-surface-border bg-surface-subtle text-[12px]">
                  <span className="text-slate-600">{header}</span>
                  <span className="text-slate-300">→</span>
                  <span className="font-mono text-[11.5px] text-slate-900">{field}</span>
                </span>
              ))}
            </div>
            {parsed.warnings.length > 0 && (
              <ul className="space-y-1">
                {parsed.warnings.map((w, i) => (
                  <li key={i} className="text-[12.5px] text-slate-500">
                    <span className="text-slate-300 mr-2">·</span>{w}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {batch.passengers.length > 0 && !statementText && view === 'subagent' && (
        <Panel title="Waiting on the statement"
               subtitle={`${batch.passengers.length} documents priced and ready to match`} flush>
          <ul className="divide-y divide-surface-border">
            {batch.passengers.slice(0, 8).map((p, i) => (
              <li key={i} className="px-4 py-2.5 flex justify-between gap-3">
                <span>
                  <span className="font-mono text-[12.5px] text-slate-900">{p.ticket.ticketNumber}</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {routeOf(p.ticket)} · {p.ticket.coupons.map((c) => c.rbd).join('/')}
                  </span>
                </span>
                <Pill>{p.ticket.documentType}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function SettleRow({ r }: { r: SettlementRow }) {
  return (
    <tr className="border-b border-surface-border last:border-0">
      <td className={clsx(
        'px-4 py-2.5 border-l-[3px]',
        r.severity === 'critical' ? 'border-l-red-500'
          : r.severity === 'warning' ? 'border-l-amber-500' : 'border-l-emerald-500')}>
        <span className="font-mono text-[12.5px] font-medium text-slate-900">{r.ticketNumber}</span>
        <span className="block text-[11px] text-slate-400 mt-0.5">
          {r.route ?? 'not in this batch'}
          {r.statementRow ? ` · statement row ${r.statementRow}` : ' · not on the statement'}
        </span>
      </td>
      <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-600">{r.classes ?? '—'}</td>
      <td className="px-4 py-2.5">
        <Pill tone={TONE_OF[r.severity]}>{r.reason}</Pill>
        <span className="block text-[11.5px] text-slate-500 mt-1 max-w-[46ch]">{r.explanation}</span>
      </td>
      <td className="px-4 py-2.5 text-right"><Amount m={r.expected} /></td>
      <td className="px-4 py-2.5 text-right"><Amount m={r.statedGross ?? r.statedNet} /></td>
      <td className="px-4 py-2.5 text-right"><Amount m={r.statedFees} /></td>
      <td className="px-4 py-2.5 text-right"><Amount m={r.variance} bold /></td>
    </tr>
  );
}
