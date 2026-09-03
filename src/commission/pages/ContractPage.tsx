import { Note, Panel, Pill } from '../components/primitives';
import { ATTACHMENT_A, LY_MAINST_2026, OPEN_QUESTIONS } from '../data';

/**
 * The contract, as the engine holds it.
 *
 * Every figure elsewhere in this app comes from these rules. Showing them next
 * to the clause they were read from is what lets someone check the software
 * against the paper instead of taking its word.
 */
export default function ContractPage() {
  const rates = Object.entries(ATTACHMENT_A).sort(
    (a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]),
  );
  const bands = [...new Set(rates.map(([, r]) => r))];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div>
        <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">
          EL AL Agency Commission Letter 2026
        </h1>
        <p className="text-[13.5px] text-slate-600 mt-1 max-w-[70ch]">
          Main St Travel · IATA 33535983 · tickets issued 15 Jan – 31 Dec 2026.
          These are the rules the engine actually evaluates. Change one and every
          figure in this app moves with it.
        </p>
      </div>

      <Note title="Read by machine, approved by a person.">
        The rules were extracted from the letter and are filed unapproved: none of
        them can fire until a human confirms the reading. Seven questions the
        letter does not settle are listed at the foot of this page.
      </Note>

      <Panel title="Attachment A — commission by booking class"
             subtitle={`${rates.length} classes across ${bands.length} rates`}>
        <div className="flex flex-wrap gap-2">
          {rates.map(([rbd, rate]) => (
            <div key={rbd} className="flex items-baseline gap-2 px-3 py-1.5 rounded-lg border border-surface-border bg-surface-subtle">
              <span className="font-mono text-[13px] font-semibold text-slate-900 w-4">{rbd}</span>
              <span className="font-mono text-[12.5px] tabular-nums text-slate-600">{rate}%</span>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-slate-500 mt-3 max-w-[70ch]">
          The discounted business buckets I, D and Z pay 9% while C and J pay 6%: a
          ticket sold in D earns half again what the same cabin earns in C, which is
          worth knowing at the point of sale and not only at reconciliation.
        </p>
      </Panel>

      <Panel title="Clauses as the engine holds them" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Rule', 'Clause', 'Applies when', 'Pays', 'Scope'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LY_MAINST_2026.map((r) => (
                <tr key={r.id} className="border-b border-surface-border last:border-0 align-top">
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-900">
                    {r.id.replace('LY-MAINST-2026-', '')}
                    <span className="block text-[10.5px] text-slate-400 mt-0.5">
                      priority {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-600 whitespace-nowrap">
                    {r.source?.clause ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(r.match).map(([k, v]) => (
                        <Pill key={k}>{k}: {describe(v)}</Pill>
                      ))}
                      {Object.keys(r.match).length === 0 && <Pill>any document</Pill>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.award.kind === 'nil'
                      ? <Pill tone="critical">nil</Pill>
                      : r.award.rateTable
                        ? <Pill tone="ok">Attachment A</Pill>
                        : <Pill tone="ok">{r.award.rate}%</Pill>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-600">
                    {r.scope ?? 'ticket'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="What the letter does not settle"
             subtitle="Each of these changes real money and none can be resolved by reading it again">
        <ol className="space-y-4">
          {OPEN_QUESTIONS.map((q) => (
            <li key={q.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
              <Pill tone={q.severity === 'high' ? 'critical' : q.severity === 'medium' ? 'warning' : 'neutral'}>
                Q{q.id}
              </Pill>
              <div>
                <p className="text-[13.5px] font-medium text-slate-900">{q.question}</p>
                <p className="text-[12.8px] text-slate-600 mt-1 max-w-[76ch] leading-relaxed">{q.why}</p>
                <p className="text-[12px] text-slate-400 mt-1 font-mono">assumed: {q.assumed}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function describe(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('/');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.in) return (o.in as string[]).join('/');
    if (o.notIn) return `not ${(o.notIn as string[]).join('/')}`;
    if (o.absent) return 'absent';
    if (o.matches) return `/${String(o.matches)}/`;
    if (o.from && o.to) return `${String(o.from)} ↔ ${String(o.to)}`;
  }
  return String(v);
}
