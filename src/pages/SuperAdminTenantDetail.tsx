import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Edit2, Building2, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tenant, TenantMembership, Profile, Order, UnifiedTicket, Invoice, Todo, PortalUser } from '../types/superadmin';

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function BarChart({ data, color = '#16a34a' }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const h = 100, w = 400, barW = Math.max(18, (w / data.length) - 4);
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        const x = i * (w / data.length) + (w / data.length - barW) / 2;
        const bh = (d.value / max) * h;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={barW} height={bh} rx={3} fill={color} opacity={0.8} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ segments }: { segments: { value: number; color: string; name: string }[] }) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  const size = 100, cx = 50, cy = 50, r = 42, ir = 26;
  let angle = -Math.PI / 2;
  return (
    <svg width={size} height={size}>
      {total === 0 ? <circle cx={cx} cy={cy} r={r} fill="#f1f5f9" /> : segments.map(seg => {
        if (seg.value === 0) return null;
        const sweep = (seg.value / total) * 2 * Math.PI;
        const s = angle; angle += sweep; const e = angle;
        const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
        const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
        const ix1 = cx + ir * Math.cos(e), iy1 = cy + ir * Math.sin(e);
        const ix2 = cx + ir * Math.cos(s), iy2 = cy + ir * Math.sin(s);
        const lg = sweep > Math.PI ? 1 : 0;
        return <path key={seg.name}
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${lg} 0 ${ix2} ${iy2} Z`}
          fill={seg.color} />;
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a" fontFamily="Inter">{total}</text>
    </svg>
  );
}

function last6Months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en', { month: 'short' });
}

interface DetailData {
  tenant: Tenant;
  memberships: (TenantMembership & { profile?: Pick<Profile, 'id' | 'email' | 'full_name'> })[];
  orders: Order[];
  tickets: UnifiedTicket[];
  invoices: Invoice[];
  todos: Todo[];
  portalUsers: PortalUser[];
}

export default function SuperAdminTenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (tenantId) load(tenantId); }, [tenantId]);

  async function load(tid: string) {
    try {
      setLoading(true);
      const [t, m, p, o, tk, inv, todos, pu] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tid).single(),
        supabase.from('tenant_memberships').select('*').eq('tenant_id', tid),
        supabase.from('profiles').select('id,email,full_name'),
        supabase.from('orders').select('id,order_number,charge_amount,payment_status,paid,created_at').eq('tenant_id', tid).order('created_at', { ascending: false }),
        supabase.from('unified_tickets').select('id,amount,created_at,source_type').eq('tenant_id', tid),
        supabase.from('invoices').select('id,total,amount_paid,balance_due,due_date,status').eq('tenant_id', tid),
        supabase.from('todos').select('id,title,completed,due_date').eq('tenant_id', tid),
        supabase.from('portal_users').select('id,is_active,last_login_at').eq('tenant_id', tid),
      ]);
      if (t.error) throw t.error;
      const profiles = (p.data ?? []) as Pick<Profile, 'id' | 'email' | 'full_name'>[];
      const memberships = (m.data ?? []).map((mem: TenantMembership) => ({
        ...mem,
        profile: profiles.find(pr => pr.id === mem.user_id),
      }));
      setData({
        tenant: t.data,
        memberships,
        orders: (o.data ?? []) as Order[],
        tickets: (tk.data ?? []) as UnifiedTicket[],
        invoices: (inv.data ?? []) as Invoice[],
        todos: (todos.data ?? []) as Todo[],
        portalUsers: (pu.data ?? []) as PortalUser[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading tenant…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;
  if (!data) return null;

  const { tenant, memberships, orders, tickets, invoices, todos, portalUsers } = data;
  const now = new Date();

  const totalRevenue = orders.reduce((s, o) => s + (o.charge_amount ?? 0), 0);
  const unpaidBalance = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.balance_due ?? i.total ?? 0), 0);
  const openTodos = todos.filter(t => !t.completed).length;
  const activePortal = portalUsers.filter(u => u.is_active).length;

  const months = last6Months();
  const ordersByMonth: Record<string, Order[]> = orders.reduce((acc, o) => {
    const k = o.created_at.slice(0, 7);
    (acc[k] ??= []).push(o);
    return acc;
  }, {} as Record<string, Order[]>);
  const revenueData = months.map(m => ({
    label: monthLabel(m),
    value: (ordersByMonth[m] ?? []).reduce((s, o) => s + (o.charge_amount ?? 0), 0),
  }));

  const sourceTypes = [...new Set(tickets.map(t => t.source_type || 'Unknown'))];
  const colors = ['#16a34a', '#2563eb', '#7c3aed', '#f59e0b', '#ef4444'];
  const ticketSourceDist = sourceTypes.map((src, i) => ({
    name: src,
    value: tickets.filter(t => (t.source_type || 'Unknown') === src).length,
    color: colors[i % colors.length],
  }));

  const trialEnds = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
  let healthBadge = '';
  if (tenant.is_demo) healthBadge = 'Demo';
  else if (trialEnds && trialEnds > now) healthBadge = 'Trial';
  else if (trialEnds && trialEnds < now && orders.length === 0) healthBadge = 'At Risk';
  else healthBadge = 'Healthy';

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/superadmin/tenants-list" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <Building2 size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{tenant.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`badge ${healthBadge === 'Healthy' ? 'bg-emerald-50 text-emerald-700' : healthBadge === 'Trial' ? 'bg-blue-50 text-blue-700' : healthBadge === 'At Risk' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                {healthBadge}
              </span>
              <span className="text-xs text-slate-400">Created {new Date(tenant.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <Link to={`/superadmin/edit-tenant/${tenant.id}`} className="btn-secondary text-xs py-1.5">
          <Edit2 size={13} /> Edit Tenant
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Revenue', value: fmt(totalRevenue) },
          { label: 'Total Tickets', value: tickets.length },
          { label: 'Unpaid Balance', value: fmt(unpaidBalance) },
          { label: 'Open Todos', value: openTodos },
          { label: 'Active Portal Users', value: activePortal },
        ].map(c => (
          <div key={c.label} className="card px-4 py-3">
            <p className="text-lg font-bold text-slate-900">{c.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Monthly Revenue</h2>
          <BarChart data={revenueData} />
        </div>
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Ticket Source Types</h2>
          {ticketSourceDist.length > 0 ? (
            <div className="flex items-center gap-5">
              <DonutChart segments={ticketSourceDist} />
              <div className="space-y-2">
                {ticketSourceDist.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-slate-600">{s.name}</span>
                    <span className="font-semibold text-slate-800">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-sm">No tickets yet.</p>
          )}
        </div>
      </div>

      {/* Members + Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Members ({memberships.length})</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {memberships.map(m => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{m.profile?.full_name || m.profile?.email || m.user_id}</p>
                  <p className="text-xs text-slate-400">{m.profile?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${m.role === 'owner' ? 'bg-brand-50 text-brand-700' : m.role === 'admin' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {m.role}
                  </span>
                  <Link to={`/superadmin/users/${m.user_id}`} className="text-xs text-brand-600 hover:underline">View</Link>
                </div>
              </div>
            ))}
            {memberships.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No members.</p>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Recent Orders ({orders.length})</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {orders.slice(0, 8).map(o => (
              <div key={o.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-xs font-mono font-semibold text-brand-700">{o.order_number || o.id.slice(0, 8)}</p>
                  <p className="text-[10px] text-slate-400">{new Date(o.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{fmt(o.charge_amount ?? 0)}</span>
                  <span className={`badge ${o.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {o.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
              </div>
            ))}
            {orders.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No orders yet.</p>}
          </div>
        </div>
      </div>

      {/* AITAN codes */}
      {tenant.aitan_codes?.length > 0 && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">AITAN Codes</h2>
          <div className="flex flex-wrap gap-2">
            {tenant.aitan_codes.map(code => (
              <span key={code} className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-full font-mono">{code}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
