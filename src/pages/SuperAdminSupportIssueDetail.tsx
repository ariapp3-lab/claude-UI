import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

type IssueType = 'payment' | 'allocation' | 'todo' | 'airfile' | 'missing_tickets';

interface IssueData {
  type: IssueType;
  entityId: string;
  order?: Record<string, unknown>;
  customer?: Record<string, unknown>;
  tickets?: Record<string, unknown>[];
  todo?: Record<string, unknown>;
  airfile?: Record<string, unknown>;
  tenantName?: string;
}

function Field({ label, value }: { label: string; value: unknown }) {
  const display = value === null || value === undefined ? '—' : String(value);
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 break-all">{display}</p>
    </div>
  );
}

function fmt(n: unknown) {
  const num = Number(n);
  if (isNaN(num)) return '—';
  return `$${num.toFixed(2)}`;
}

export default function SuperAdminSupportIssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const [data, setData] = useState<IssueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (issueId) load(issueId); }, [issueId]);

  async function load(encodedId: string) {
    try {
      setLoading(true);
      const decoded = decodeURIComponent(encodedId);
      const parts = decoded.match(/^(payment|allocation|todo|airfile|missing[-_]tickets)-(.+)$/);
      if (!parts) throw new Error('Invalid issue ID format');

      const rawType = parts[1].replace('-', '_') as IssueType;
      const type: IssueType = rawType === 'missing_tickets' || decoded.startsWith('missing-tickets') ? 'missing_tickets' : rawType;
      const entityId = parts[2];

      const tenants = (await supabase.from('tenants').select('id,name')).data ?? [];
      const tenantName = (tid: string) => tenants.find(t => t.id === tid)?.name ?? '—';
      const issueData: IssueData = { type, entityId };

      if (type === 'todo') {
        const { data: todo } = await supabase.from('todos').select('*').eq('id', entityId).single();
        issueData.todo = todo;
        issueData.tenantName = tenantName(todo?.tenant_id);
        if (todo?.order_id) {
          const { data: order } = await supabase.from('orders').select('*').eq('id', todo.order_id).single();
          issueData.order = order;
        }
      } else if (type === 'airfile') {
        const { data: airfile } = await supabase.from('parsed_airfiles').select('*').eq('id', entityId).single();
        issueData.airfile = airfile;
        issueData.tenantName = tenantName(airfile?.tenant_id);
      } else {
        const { data: order } = await supabase.from('orders').select('*').eq('id', entityId).single();
        issueData.order = order;
        issueData.tenantName = tenantName(order?.tenant_id);
        if (order?.customer_id) {
          const { data: customer } = await supabase.from('customers').select('*').eq('id', order.customer_id).single();
          issueData.customer = customer;
        }
        const { data: tickets } = await supabase.from('unified_tickets').select('*').eq('order_id', entityId);
        issueData.tickets = tickets ?? [];
      }

      setData(issueData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load issue');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading issue…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;
  if (!data) return null;

  const typeLabel: Record<IssueType, string> = {
    payment: 'Payment Issue',
    allocation: 'Cost Allocation Issue',
    todo: 'Overdue Todo',
    airfile: 'Pending Airfile',
    missing_tickets: 'Missing Tickets',
  };

  return (
    <div className="max-w-[900px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/superadmin/support-queue" className="text-slate-400 hover:text-slate-600">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{typeLabel[data.type]}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{data.tenantName}</p>
        </div>
      </div>

      {/* Order context */}
      {data.order && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Order</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Order Number" value={String(data.order.order_number ?? '—')} />
            <Field label="Name" value={String(data.order.name ?? '—')} />
            <Field label="Amount" value={fmt(data.order.charge_amount)} />
            <Field label="Payment Status" value={String(data.order.payment_status ?? '—')} />
            <Field label="Paid" value={data.order.paid ? 'Yes' : 'No'} />
            <Field label="Cost Allocated" value={data.order.cost_allocated ? 'Yes' : 'No'} />
            <Field label="Created" value={data.order.created_at ? new Date(String(data.order.created_at)).toLocaleString() : '—'} />
            <Field label="Order ID" value={String(data.order.id ?? '—')} />
          </div>
        </div>
      )}

      {/* Customer context */}
      {data.customer && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Customer</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(data.customer)
              .filter(([k]) => !['id', 'tenant_id', 'created_at', 'updated_at'].includes(k))
              .map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')} value={v} />)}
          </div>
        </div>
      )}

      {/* Tickets */}
      {data.tickets !== undefined && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Tickets ({data.tickets.length})</h2>
          </div>
          {data.tickets.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-400">No tickets found for this order.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-subtle border-b border-surface-border">
                  {['Ticket #', 'Passenger', 'Amount', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {data.tickets.map(t => (
                  <tr key={String(t.id)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{String(t.ticket_number ?? '—')}</td>
                    <td className="px-4 py-2.5 text-slate-700">{String(t.passenger_name ?? '—')}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{fmt(t.amount)}</td>
                    <td className="px-4 py-2.5">{String(t.status ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Todo */}
      {data.todo && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Todo</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Title" value={String(data.todo.title ?? '—')} />
            <Field label="Completed" value={data.todo.completed ? 'Yes' : 'No'} />
            <Field label="Due Date" value={data.todo.due_date ? new Date(String(data.todo.due_date)).toLocaleDateString() : '—'} />
            <Field label="ID" value={String(data.todo.id ?? '—')} />
          </div>
        </div>
      )}

      {/* Airfile */}
      {data.airfile && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Airfile</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-3">
            <Field label="PNR" value={String(data.airfile.pnr ?? '—')} />
            <Field label="Status" value={String(data.airfile.status ?? '—')} />
            <Field label="Success" value={data.airfile.success ? 'Yes' : 'No'} />
            <Field label="Created" value={data.airfile.created_at ? new Date(String(data.airfile.created_at)).toLocaleString() : '—'} />
            <Field label="ID" value={String(data.airfile.id ?? '—')} />
          </div>
          {Boolean(data.airfile.raw_text) && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Raw Text</p>
              <pre className="bg-surface-muted p-3 rounded-lg text-xs text-slate-700 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">
                {String(data.airfile.raw_text)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
