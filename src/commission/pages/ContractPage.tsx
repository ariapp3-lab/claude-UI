import { useState } from 'react';
import clsx from 'clsx';
import { FileText, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Note, Panel, Pill } from '../components/primitives';
import { useWorkspace } from '../workspace';
import {
  type CarrierContract, type Config, type StoredConsolidator,
  deleteContractFile, getContractFile, newId, putContractFile, resetConfig,
} from '../store';
import { OPEN_QUESTIONS } from '../data';

/**
 * The contracts, as data anyone can change.
 *
 * Every figure the app produces comes from this page. What it offers is
 * deliberately narrower than what the engine can express: a commission letter
 * varies on a rate table, a date window, a tour code and where travel may
 * originate, and offering thirty more switches would make a worse tool than
 * offering those. Anything a letter says that this cannot hold belongs in the
 * notes, where a person reads it.
 */
export default function ContractPage() {
  const { config, consolidator, updateConfig, setConsolidator } = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function commit(next: Config, message = 'Saved') {
    const ok = updateConfig(next);
    setSaved(ok ? message : 'Could not save — this browser refused storage');
    setTimeout(() => setSaved(null), 2600);
  }

  function patchConsolidator(id: string, patch: Partial<StoredConsolidator>) {
    commit({
      ...config,
      consolidators: config.consolidators.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  function patchContract(cid: string, contractId: string, patch: Partial<CarrierContract>) {
    commit({
      ...config,
      consolidators: config.consolidators.map((c) => c.id !== cid ? c : {
        ...c,
        contracts: c.contracts.map((k) => (k.id === contractId ? { ...k, ...patch } : k)),
      }),
    });
  }

  function addConsolidator() {
    const id = newId('con');
    commit({
      ...config,
      consolidators: [...config.consolidators, {
        id, name: 'New consolidator', iata: '', retainsPoints: '1.00',
        contracts: [], notes: '',
      }],
    }, 'Consolidator added');
    setConsolidator(id);
    setEditing(id);
  }

  function removeConsolidator(id: string) {
    commit({ ...config, consolidators: config.consolidators.filter((c) => c.id !== id) },
      'Consolidator removed');
  }

  function addContract(cid: string) {
    commit({
      ...config,
      consolidators: config.consolidators.map((c) => c.id !== cid ? c : {
        ...c,
        contracts: [...c.contracts, {
          id: newId('ct'), carrier: '', title: 'New commission letter',
          issuedFrom: `${new Date().getUTCFullYear()}-01-01`,
          issuedTo: `${new Date().getUTCFullYear()}-12-31`,
          rates: {}, includeYq: false, requiredTourCode: '', originIn: [],
          scope: 'ticket', excludeFareTypes: ['group', 'private'], notes: '', files: [],
        }],
      }),
    }, 'Contract added');
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-slate-900">Contracts</h1>
          <p className="text-[13.5px] text-slate-600 mt-1 max-w-[64ch]">
            Every figure in this app comes from here. Edits take effect immediately
            and are kept in this browser — nothing is uploaded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[12.5px] text-emerald-700">{saved}</span>}
          <button className="btn-secondary" onClick={() => commit(resetConfig(), 'Reset')}>
            <RotateCcw size={14} /> Reset to the EL AL letter
          </button>
          <button className="btn-primary" onClick={addConsolidator}>
            <Plus size={14} /> Consolidator
          </button>
        </div>
      </div>

      <Note title="Read by a person, not by a machine.">
        A commission letter is a PDF written for a human, and a rate misread from
        one is money lost every week until someone notices. Attach the letter here
        and enter its table yourself — twenty rows, once a year — so the figures the
        app produces are ones you have checked.
      </Note>

      {config.consolidators.map((c) => (
        <Panel
          key={c.id}
          title={c.name}
          subtitle={`IATA ${c.iata || '—'} · retains ${c.retainsPoints} point(s) · ${
            c.contracts.length} contract(s)`}
          actions={
            <div className="flex items-center gap-2">
              {consolidator.id === c.id && <Pill tone="ok">selected</Pill>}
              <button className="btn-secondary"
                      onClick={() => setEditing(editing === c.id ? null : c.id)}>
                {editing === c.id ? 'Done' : 'Edit'}
              </button>
            </div>
          }
        >
          {editing === c.id && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <Field label="Name" value={c.name}
                     onChange={(v) => patchConsolidator(c.id, { name: v })} />
              <Field label="IATA / ARC number" value={c.iata} mono
                     hint="How a batch of tickets is matched to this consolidator"
                     onChange={(v) => patchConsolidator(c.id, { iata: v.replace(/\D/g, '') })} />
              <Field label="Points retained" value={c.retainsPoints} mono
                     hint="Of the fare; the sub-agent takes the remainder"
                     onChange={(v) => patchConsolidator(c.id, { retainsPoints: v })} />
              <div className="flex items-end">
                <button className="btn-secondary text-red-700 border-red-200"
                        onClick={() => removeConsolidator(c.id)}>
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {c.contracts.map((k) => (
              <ContractEditor
                key={k.id} consolidator={c} contract={k}
                onPatch={(patch) => patchContract(c.id, k.id, patch)}
                onRemove={() => commit({
                  ...config,
                  consolidators: config.consolidators.map((x) => x.id !== c.id ? x : {
                    ...x, contracts: x.contracts.filter((y) => y.id !== k.id),
                  }),
                }, 'Contract removed')}
              />
            ))}
            {c.contracts.length === 0 && (
              <p className="text-[13px] text-slate-500">
                No carrier contracts yet — nothing issued under IATA {c.iata || '—'} will be priced.
              </p>
            )}
            <button className="btn-secondary" onClick={() => addContract(c.id)}>
              <Plus size={14} /> Carrier contract
            </button>
          </div>
        </Panel>
      ))}

      {config.consolidators.length === 0 && (
        <Panel title="No consolidators">
          <p className="text-[13px] text-slate-500">
            Add one, then add the carrier contracts it holds.
          </p>
        </Panel>
      )}

      <Panel title="What the EL AL letter does not settle"
             subtitle="Recorded when it was first read; each changes real money">
        <ol className="space-y-3">
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

// ---------------------------------------------------------------------------

function ContractEditor({
  consolidator, contract, onPatch, onRemove,
}: {
  consolidator: StoredConsolidator;
  contract: CarrierContract;
  onPatch(patch: Partial<CarrierContract>): void;
  onRemove(): void;
}) {
  const [newClass, setNewClass] = useState('');
  const [newRate, setNewRate] = useState('');
  const rates = Object.entries(contract.rates)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));

  async function attach(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const id = newId('file');
    const stored = await putContractFile(id, file);
    if (!stored) return;
    onPatch({
      files: [...contract.files, {
        id, name: file.name, size: file.size, addedAt: new Date().toISOString().slice(0, 10),
      }],
    });
  }

  async function open(id: string) {
    const file = await getContractFile(id);
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="border border-surface-border rounded-xl p-4 bg-surface-subtle space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Carrier" value={contract.carrier} mono hint="Two-letter code — LY, AA"
               onChange={(v) => onPatch({ carrier: v.toUpperCase().slice(0, 3) })} />
        <Field label="Title" value={contract.title} onChange={(v) => onPatch({ title: v })} />
        <Field label="Tickets issued from" value={contract.issuedFrom} type="date"
               onChange={(v) => onPatch({ issuedFrom: v })} />
        <Field label="to" value={contract.issuedTo} type="date"
               onChange={(v) => onPatch({ issuedTo: v })} />
      </div>

      <div>
        <h4 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
          Commission by booking class
        </h4>
        <div className="flex flex-wrap gap-2">
          {rates.map(([rbd, rate]) => (
            <div key={rbd} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-white border border-surface-border">
              <span className="font-mono text-[13px] font-semibold text-slate-900 w-4">{rbd}</span>
              <input
                value={rate}
                aria-label={`Rate for class ${rbd}`}
                onChange={(e) => onPatch({
                  rates: { ...contract.rates, [rbd]: e.target.value.replace(/[^\d.]/g, '') },
                })}
                className="w-12 text-right font-mono text-[12.5px] tabular-nums bg-transparent border-0 p-0 focus:outline-none focus:ring-0"
              />
              <span className="text-[12px] text-slate-400">%</span>
              <button aria-label={`Remove class ${rbd}`}
                      onClick={() => {
                        const next = { ...contract.rates };
                        delete next[rbd];
                        onPatch({ rates: next });
                      }}
                      className="text-slate-300 hover:text-red-600 px-0.5">×</button>
            </div>
          ))}
          {rates.length === 0 && (
            <p className="text-[12.5px] text-slate-500">
              No classes yet — a ticket in any class will earn nothing under this contract.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <input value={newClass} onChange={(e) => setNewClass(e.target.value.toUpperCase().slice(0, 2))}
                 placeholder="Class" aria-label="New booking class"
                 className="w-20 px-2 py-1.5 text-[13px] font-mono bg-white border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <input value={newRate} onChange={(e) => setNewRate(e.target.value.replace(/[^\d.]/g, ''))}
                 placeholder="0.00" aria-label="Rate for the new class"
                 className="w-24 px-2 py-1.5 text-[13px] font-mono text-right bg-white border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <button className="btn-secondary" disabled={!newClass || !newRate}
                  onClick={() => {
                    onPatch({ rates: { ...contract.rates, [newClass]: Number(newRate).toFixed(2) } });
                    setNewClass(''); setNewRate('');
                  }}>
            <Plus size={14} /> Add class
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tour code required" value={contract.requiredTourCode} mono
               hint="Absent from the ticket forfeits the commission; blank if none"
               onChange={(v) => onPatch({ requiredTourCode: v.toUpperCase() })} />
        <Field label="Travel must originate in" value={contract.originIn.join(', ')} mono
               hint="Country or region codes, comma separated; blank for anywhere"
               onChange={(v) => onPatch({
                 originIn: v.toUpperCase().split(',').map((x) => x.trim()).filter(Boolean),
               })} />
        <Choice label="Priced" value={contract.scope}
                hint="Per ticket, or per direction on the class booked"
                options={[['ticket', 'Once per ticket'], ['half_rt', 'Per half round trip']]}
                onChange={(v) => onPatch({ scope: v as CarrierContract['scope'] })} />
        <Choice label="Commissionable fare" value={contract.includeYq ? 'yes' : 'no'}
                hint="Whether the carrier's YQ surcharge counts toward it"
                options={[['no', 'Base fare only'], ['yes', 'Base fare plus YQ']]}
                onChange={(v) => onPatch({ includeYq: v === 'yes' })} />
      </div>

      <div>
        <h4 className="font-mono text-[10px] uppercase tracking-[0.09em] text-slate-400 mb-2">
          The signed letter
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          {contract.files.map((file) => (
            <div key={file.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-surface-border">
              <FileText size={14} className="text-slate-400" />
              <button onClick={() => void open(file.id)}
                      className="text-[12.5px] text-slate-900 hover:underline">{file.name}</button>
              <span className="text-[11px] text-slate-400 font-mono">
                {(file.size / 1024).toFixed(0)}KB · {file.addedAt}
              </span>
              <button aria-label={`Remove ${file.name}`}
                      onClick={() => {
                        void deleteContractFile(file.id);
                        onPatch({ files: contract.files.filter((f) => f.id !== file.id) });
                      }}
                      className="text-slate-300 hover:text-red-600">×</button>
            </div>
          ))}
          <label className="btn-secondary cursor-pointer">
            <Upload size={14} /> Attach
            <input type="file" className="hidden" accept=".pdf,.doc,.docx,image/*"
                   onChange={(e) => void attach(e.target.files)} />
          </label>
        </div>
      </div>

      <Field label="Notes" value={contract.notes} multiline
             hint="Anything the letter says that the fields above cannot hold"
             onChange={(v) => onPatch({ notes: v })} />

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11.5px] text-slate-400 font-mono">
          {consolidator.id}:{contract.id}
        </span>
        <button className="btn-secondary text-red-700 border-red-200" onClick={onRemove}>
          <Trash2 size={14} /> Remove contract
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label, value, onChange, hint, mono, type = 'text', multiline,
}: {
  label: string; value: string; onChange(v: string): void;
  hint?: string; mono?: boolean; type?: string; multiline?: boolean;
}) {
  const cls = clsx(
    'w-full px-2.5 py-1.5 text-[13px] bg-white border border-surface-border rounded-lg',
    'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
    mono && 'font-mono',
  );
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium text-slate-500 mb-1">{label}</span>
      {multiline
        ? <textarea value={value} rows={2} onChange={(e) => onChange(e.target.value)} className={cls} />
        : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

function Choice({
  label, value, options, onChange, hint,
}: {
  label: string; value: string; hint?: string;
  options: readonly (readonly [string, string])[];
  onChange(v: string): void;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium text-slate-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[13px] bg-white border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}
