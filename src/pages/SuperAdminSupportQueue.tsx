import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, AlertCircle, Clock, Zap, DollarSign, Ticket, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

type IssuePriority = 'High' | 'Medium' | 'Low';
type IssueType = 'payment' | 'allocation' | 'todo' | 'airfile' | 'missing_tickets';
type PriorityFilter = 'All' | 'High' | 'Medium' | 'Low';
type TypeFilter = 'All' | IssueType;

interface SupportIssue {
  id: string;
  type: IssueType;
  priority: IssuePriority;
  title: string;
  description: string;
  tenantName: string;
  entityId: string;
  createdAt: string;
}

const DISMISSED_KEY = 'sa_dismissed_issues';

function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')); }
  catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

const PRIORITY_ICON: Record<IssuePriority, React.ReactNode> = {
  High: <AlertCircle size={13} className="text-red-500" />,
  Medium: <Clock size={13} className="text-amber-500" />,
  Low: <Zap size={13} className="text-slate-400" />,
};

const PRIORITY_BADGE: Record<IssuePriority, string> = {
  High: 'bg-red-50 text-red-700',
  Medium: 'bg-amber-50 text-amber-700',
  Low: 'bg-slate-100 text-slate-600',
};

const TYPE_ICON: Record<IssueType, React.ReactNode> = {
  payment: <DollarSign size={13} className="text-red-400" />,
  allocation: <DollarSign size={13} className="text-amber-400" />,
  todo: <Clock size={13} className="text-amber-400" />,
  airfile: <Zap size={13} className="text-amber-400" />,
  missing_tickets: <Ticket size={13} className="text-slate-400" />,
};

const TYPE_LABEL: Record<IssueType, string> = {
  payment: 'Payment',
  allocation: 'Allocation',
  todo: 'Todo',
  airfile: 'Airfile',
  missing_tickets: 'Missing Tickets',
};

export default function SuperAdminSupportQueue() {
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('All');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [tenantsRes, ordersRes, todosRes, airfilesRes, ticketsRes] = await Promise.all([
        supabase.from('tenants').select('id,name'),
        supabase.from('orders').select('id,tenant_id,order_number,name,payment_status,paid,cost_allocated,created_at'),
        supabase.from('todos').select('id,tenant_id,title,completed,due_date,order_id'),
        supabase.from('parsed_airfiles').select('id,tenant_id,pnr,status,created_at'),
        supabase.from('unified_tickets').select('id,tenant_id,order_id'),
      ]);

      const tenants: { id: string; name: string }[] = tenantsRes.data ?? [];
      const orders = ordersRes.data ?? [];
      const todos = todosRes.data ?? [];
      const airfiles = airfilesRes.data ?? [];
      const tickets = ticketsRes.data ?? [];

      const tenantName = (tid: string) => tenants.find(t => t.id === tid)?.name ?? '—';
      const now = new Date();
      const computed: SupportIssue[] = [];

      // payment issues: orders not paid and > 7 days old
      orders
        .filter(o => o.payment_status !== 'paid_in_full' && !o.paid && ((now.getTime() - new Date(o.created_at).getTime()) > 7 * 86400000))
        .forEach(o => computed.push({
          id: `payment-${o.id}`,
          type: 'payment',
          priority: 'High',
          title: `Unpaid order ${o.order_number || o.id.slice(0, 8)}`,
          description: `Order has been unpaid for over 7 days`,
          tenantName: tenantName(o.tenant_id),
          entityId: o.id,
          createdAt: o.created_at,
        }));

      // allocation issues: orders with cost_allocated = false
      orders
        .filter(o => !o.cost_allocated)
        .forEach(o => computed.push({
          id: `allocation-${o.id}`,
          type: 'allocation',
          priority: 'Medium',
          title: `Cost not allocated: ${o.order_number || o.id.slice(0, 8)}`,
          description: 'Order cost has not been allocated',
          tenantName: tenantName(o.tenant_id),
          entityId: o.id,
          createdAt: o.created_at,
        }));

      // todo issues: overdue incomplete todos
      todos
        .filter(t => !t.completed && t.due_date && new Date(t.due_date) < now)
        .forEach(t => computed.push({
          id: `todo-${t.id}`,
          type: 'todo',
          priority: 'Medium',
          title: `Overdue todo: ${t.title}`,
          description: `Due ${new Date(t.due_date).toLocaleDateString()}`,
          tenantName: tenantName(t.tenant_id),
          entityId: t.id,
          createdAt: t.due_date,
        }));

      // airfile issues: pending_linking > 48h
      airfiles
        .filter(a => a.status === 'pending_linking' && ((now.getTime() - new Date(a.created_at).getTime()) > 48 * 3600000))
        .forEach(a => computed.push({
          id: `airfile-${a.id}`,
          type: 'airfile',
          priority: 'Medium',
          title: `Airfile pending linking: ${a.pnr}`,
          description: 'Airfile has been unlinked for over 48 hours',
          tenantName: tenantName(a.tenant_id),
          entityId: a.id,
          createdAt: a.created_at,
        }));

      // missing_tickets: orders with no unified_tickets
      const orderTicketCounts: Record<string, number> = {};
      tickets.forEach(t => { orderTicketCounts[t.order_id] = (orderTicketCounts[t.order_id] ?? 0) + 1; });
      orders
        .filter(o => !orderTicketCounts[o.id])
        .forEach(o => computed.push({
          id: `missing-tickets-${o.id}`,
          type: 'missing_tickets',
          priority: 'Low',
          title: `No tickets: ${o.order_number || o.id.slice(0, 8)}`,
          description: 'Order has no unified tickets linked',
          tenantName: tenantName(o.tenant_id),
          entityId: o.id,
          createdAt: o.created_at,
        }));

      // Sort by priority then date
      const pOrder: Record<IssuePriority, number> = { High: 0, Medium: 1, Low: 2 };
      computed.sort((a, b) => {
        const pd = pOrder[a.priority] - pOrder[b.priority];
        if (pd !== 0) return pd;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setIssues(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support queue');
    } finally {
      setLoading(false);
    }
  }

  function dismiss(issueId: string) {
    const next = new Set(dismissed);
    next.add(issueId);
    setDismissed(next);
    saveDismissed(next);
  }

  function undismissAll() {
    setDismissed(new Set());
    saveDismissed(new Set());
  }

  const activeIssues = issues.filter(i => !dismissed.has(i.id));
  const dismissedIssues = issues.filter(i => dismissed.has(i.id));

  const filtered = (showDismissed ? issues : activeIssues).filter(i => {
    const q = search.toLowerCase();
    const matchesSearch = !q || i.title.toLowerCase().includes(q) || i.tenantName.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
    const matchesPriority = priorityFilter === 'All' || i.priority === priorityFilter;
    const matchesType = typeFilter === 'All' || i.type === typeFilter;
    return matchesSearch && matchesPriority && matchesType;
  });

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Computing support issues…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Support Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Auto-detected issues · {activeIssues.length} active
            {dismissedIssues.length > 0 && ` · ${dismissedIssues.length} dismissed`}
          </p>
        </div>
        <div className="flex gap-2">
          {dismissedIssues.length > 0 && (
            <button onClick={() => setShowDismissed(v => !v)} className="btn-secondary text-xs py-1.5">
              {showDismissed ? 'Hide dismissed' : `Show all (${dismissedIssues.length} hidden)`}
            </button>
          )}
          {dismissed.size > 0 && (
            <button onClick={undismissAll} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Clear dismissals
            </button>
          )}
          <button onClick={load} className="btn-secondary text-xs py-1.5">Refresh</button>
        </div>
      </div>

      {/* Summary by priority */}
      <div className="grid grid-cols-3 gap-3">
        {(['High', 'Medium', 'Low'] as IssuePriority[]).map(p => (
          <div key={p} className="card px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              {PRIORITY_ICON[p]}
              <span className={`badge ${PRIORITY_BADGE[p]}`}>{p}</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{activeIssues.filter(i => i.priority === p).length}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">active issues</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search issues…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(['All', 'High', 'Medium', 'Low'] as PriorityFilter[]).map(f => (
            <button key={f} onClick={() => setPriorityFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${priorityFilter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {f}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)}
          className="px-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="All">All types</option>
          {(Object.keys(TYPE_LABEL) as IssueType[]).map(t => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {/* Issues list */}
      <div className="card overflow-hidden">
        <div className="divide-y divide-surface-border">
          {filtered.map(issue => (
            <div key={issue.id}
              className={`flex items-center gap-4 px-5 py-4 hover:bg-surface-subtle transition-colors ${dismissed.has(issue.id) ? 'opacity-50' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-surface-muted flex items-center justify-center shrink-0">
                {TYPE_ICON[issue.type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge ${PRIORITY_BADGE[issue.priority]}`}>{issue.priority}</span>
                  <span className="text-[10px] text-slate-400 bg-surface-muted px-2 py-0.5 rounded-full">
                    {TYPE_LABEL[issue.type]}
                  </span>
                  <span className="text-xs font-medium text-slate-800">{issue.title}</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-slate-400">{issue.tenantName}</span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs text-slate-400">{issue.description}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400">
                  {new Date(issue.createdAt).toLocaleDateString()}
                </span>
                {!dismissed.has(issue.id) && (
                  <button onClick={() => dismiss(issue.id)}
                    title="Dismiss (hide from queue)"
                    className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                    <EyeOff size={13} />
                  </button>
                )}
                <Link
                  to={`/superadmin/support-queue/${encodeURIComponent(issue.id)}`}
                  className="text-xs text-brand-600 hover:underline whitespace-nowrap">
                  View →
                </Link>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-slate-400 text-sm">No issues match your filters.</p>
              {activeIssues.length === 0 && (
                <p className="text-slate-300 text-xs mt-1">All clear — no auto-detected issues!</p>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Issues are computed fresh on every page load from live data. Use the dismiss button (
        <EyeOff size={10} className="inline" />) to hide resolved issues — dismissals persist locally in your browser.
      </p>
    </div>
  );
}
