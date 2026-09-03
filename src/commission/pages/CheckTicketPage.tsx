import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { calculate } from '@commission/engine';
import { Amount, Note, Panel, Pill, StatCard } from '../components/primitives';
import { TraceView, WaterfallView } from '../components/Waterfall';
import {
  BUNDLED_FILES, HOST_RETAINS_POINTS, detectConsolidators,
  money, priceFiles, rateCard, routeOf, type LoadedFile,
} from '../data';
import { useWorkspace, WorkspaceBar } from '../workspace';

/**
 * The sub-agent's own view.
 *
 * The revenue share here is the agency's actual term — the consolidator retains
 * one point — so these are real figures, not an illustration. No fee schedule
 * has been supplied, so none is applied: a fee the host charges that this app
 * does not know about does not reduce what is shown.
 */
export default function CheckTicketPage() {
  const { consolidator, rules, subAgentId } = useWorkspace();
  const [files, setFiles] = useState<LoadedFile[]>(BUNDLED_FILES);
  const [selected, setSelected] = useState(0);

  const batch = useMemo(() => priceFiles(files), [files]);
  const detected = useMemo(() => detectConsolidators(batch.passengers), [batch]);
  const tickets = batch.passengers;

  const priced = useMemo(
    () => tickets.map((p) => ({
      p,
      w: calculate({ ticket: p.ticket, rules, subAgentId: subAgentId ?? undefined }),
    })),
    [tickets, rules, subAgentId],
  );

  const active = priced[Math.min(selected, priced.length - 1)];
  const card = useMemo(() => rateCard(), []);

  const totals = useMemo(() => {
    let earned = 0n, consolidator = 0n, recoverable = 0n;
    for (const { p, w } of priced) {
      earned += w.netToSubAgent.units;
      consolidator += w.hostSpread.units;
      const f = batch.result.findings.find((x) => x.ticketNumber === p.ticket.ticketNumber);
      if (f?.recoverable) {
        // What the agent would take of it: the recoverable fare value less the
        // consolidator's point on the same fare.
        const pt = (f.recoverable.units * BigInt(Math.round(Number(HOST_RETAINS_POINTS) * 100)));
        recoverable += f.recoverable.units - pt / 10000n;
      }
    }
    return { earned, consolidator, recoverable };
  }, [priced, batch]);

  async function onDrop(list: FileList | null) {
    if (!list) return;
    const added: LoadedFile[] = [];
    for (const f of Array.from(list)) added.push({ name: f.name, text: await f.text(), bundled: false });
    setFiles((prev) => [...prev.filter((p) => !p.bundled), ...added]);
    setSelected(0);
  }

  const usd = (units: bigint) => money({ units, currency: 'USD' });

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <WorkspaceBar detected={detected} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">
            {subAgentId ? 'My commission' : `${consolidator.name} — carrier commission`}
          </h1>
          <p className="text-[13.5px] text-slate-600 mt-1 max-w-[64ch]">
            {subAgentId ? <>
              Every EL AL document is issued on {consolidator.name}'s plate and priced
              by their contract. They retain{' '}
              <b className="font-semibold">{HOST_RETAINS_POINTS} point</b> of the fare;
              what is below is the remainder.
            </> : <>
              What each document earns {consolidator.name} from the carrier, before
              anything is passed down to a sub-agent.
            </>}
          </p>
        </div>
        <label className="btn-secondary cursor-pointer">
          <Upload size={14} /> Load AIR files
          <input type="file" multiple className="hidden" accept=".air,.txt,text/plain"
                 onChange={(e) => void onDrop(e.target.files)} />
        </label>
      </div>

      <Note title="No fee schedule has been supplied.">
        Issuing, exchange and refund fees your consolidator charges are not modelled,
        so the figures below are before any such fee. The revenue share itself is
        your stated term and is applied in full.
      </Note>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(178px,1fr))]">
        <StatCard label="Tickets" value={String(priced.length)} note={`${batch.fileCount} files`} />
        <StatCard label="My commission" value={usd(totals.earned)}
                  tone={totals.earned > 0n ? 'ok' : undefined} note="on this batch" />
        <StatCard label="Consolidator retained" value={usd(totals.consolidator)}
                  tone={totals.consolidator < 0n ? 'warning' : undefined}
                  note={totals.consolidator < 0n
                    ? `${HOST_RETAINS_POINTS} point of the fare — net of a reissue clawback`
                    : `${HOST_RETAINS_POINTS} point of the fare`} />
        <StatCard label="Recoverable if corrected" value={usd(totals.recoverable)}
                  tone={totals.recoverable > 0n ? 'critical' : undefined}
                  note="my share of what was forfeited" />
      </div>

      <Panel title="My rate card"
             subtitle={`Attachment A less the consolidator's ${HOST_RETAINS_POINTS} point — what each class pays me`}>
        <div className="flex flex-wrap gap-2">
          {card.map((r) => (
            <div key={r.rbd} className="flex items-baseline gap-2.5 px-3 py-2 rounded-lg border border-surface-border bg-surface-subtle">
              <span className="font-mono text-[14px] font-semibold text-slate-900 w-4">{r.rbd}</span>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-emerald-700">{r.subAgentRate}%</span>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">of {r.carrierRate}</span>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-slate-500 mt-3 max-w-[74ch]">
          Because the term is a retention and not a fixed rate, this card follows
          Attachment A on its own. If EL AL moves D from 9% to 6%, your rate moves
          from 8% to 5% and the consolidator still keeps one — nothing here needs editing.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] items-start">
        <Panel title="My tickets" subtitle={`${priced.length} in this batch`} flush>
          <ul className="divide-y divide-surface-border max-h-[560px] overflow-y-auto">
            {priced.map(({ p, w }, i) => (
              <li key={p.ticket.ticketNumber + i}>
                <button onClick={() => setSelected(i)}
                        className={`w-full text-left px-4 py-2.5 flex justify-between gap-3 hover:bg-surface-subtle ${
                          i === selected ? 'bg-surface-muted' : ''}`}>
                  <span>
                    <span className="font-mono text-[12.5px] font-medium text-slate-900">
                      {p.ticket.ticketNumber}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {routeOf(p.ticket)}
                      {' · '}{p.ticket.coupons.map((c) => c.rbd).join('/')}
                      {' · '}{p.ticket.documentType}
                    </span>
                  </span>
                  <Amount m={w.netToSubAgent} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        {active && (
          <div className="space-y-4">
            <Panel
              title={`${active.p.ticket.ticketNumber} — ${routeOf(active.p.ticket)}`}
              subtitle={`Issued ${active.p.ticket.issueDate} · ${active.p.ticket.validatingCarrier} · ${
                active.p.ticket.coupons.map((c) => c.rbd).join('/')} · ${active.p.ticket.fareType}`}
              actions={<Pill tone={active.w.carrier.commission.units > 0n ? 'ok' : 'warning'}>
                {active.w.carrier.outcome}
              </Pill>}
            >
              <div className="grid gap-4 lg:grid-cols-2 items-start">
                <div className="min-w-0">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                    What I earn
                  </h3>
                  <WaterfallView w={active.w} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
                    Why — every condition tested
                  </h3>
                  <TraceView w={active.w} />
                </div>
              </div>
              {active.w.flags.length > 0 && (
                <div className="mt-4 space-y-2">
                  {active.w.flags.map((fl, i) => (
                    <Note key={i} tone="warning" title={fl.code}>{fl.message}</Note>
                  ))}
                </div>
              )}
            </Panel>

            {active.p.reportedFM && (
              <Panel title="What the document itself records"
                     subtitle="The FM element, against what the contract gives the consolidator">
                <div className="grid gap-3 sm:grid-cols-3 text-[13px]">
                  <div>
                    <span className="block text-[11.5px] text-slate-500">Claimed on the ticket</span>
                    <Amount m={active.p.reportedFM.amount} bold />
                    <span className="block text-[11px] text-slate-400 mt-0.5 font-mono">
                      {active.p.reportedFM.kind === 'percent'
                        ? `${active.p.reportedFM.rate}% of the fare`
                        : 'stated as an amount'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11.5px] text-slate-500">Consolidator, per contract</span>
                    <Amount m={active.w.carrier.commission} bold />
                  </div>
                  <div>
                    <span className="block text-[11.5px] text-slate-500">Difference</span>
                    <Amount bold m={{
                      units: active.p.reportedFM.amount.units - active.w.carrier.commission.units,
                      currency: 'USD',
                    }} />
                  </div>
                </div>
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
