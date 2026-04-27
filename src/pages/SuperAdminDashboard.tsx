import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign, Building2, Ticket, Users, FileText, Clock, AlertTriangle,
  TrendingUp, ChevronRight, ArrowUpRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tenant, Order, UnifiedTicket, Invoice, Profile, TenantMembership } from '../types/superadmin';

// ─── SVG chart helpers ────────────────────────────────────────────────────────

function BarChart({ data, color = '#16a34a' }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const h = 120, w = 480, barW = Math.max(20, (w / data.length) - 6);
  return (
    <svg viewBox={`0 0 ${w} ${h + 24}`} className="w-full" preserveAspectRatio="none">
      {[0, 0.5, 1].map(t => (
        <line key={t} x1={0} y1={h * (1 - t)} x2={w} y2={h * (1 - t)} stroke="#f1f5f9" strokeWidth="1" />
      ))}
      {data.map((d, i) => {
        const x = i * (w / data.length) + (w / data.length - barW) / 2;
        const bh = (d.value / max) * h;
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={barW} height={bh} rx={3} fill={color} opacity={0.85} />
            <text x={x + barW / 2} y={h + 16} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, color = '#16a34a' }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const h = 80, w = 400;
  const pts = data.map((d, i) => ({
    x: data.length === 1 ? w / 2 : (i / (data.length - 1)) * w,
    y: h - (d.value / max) * h,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = pts.length > 1
    ? `${line} L ${pts[pts.length - 1].x} ${h} L ${pts[0].x} ${h} Z`
    : '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill="url(#lgGrad)" />}
      {pts.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />)}
    </svg>
  );
}

function DonutChart({ segments, label }: {
  segments: { value: number; color: string; name: string }[];
  label?: string;
}) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  const size = 120, cx = 60, cy = 60, r = 50, ir = 32;
  let angle = -Math.PI / 2;
  const paths = segments.map((seg) => {
    if (total === 0) return null;
    const sweep = (seg.value / total) * 2 * Math.PI;
    if (sweep === 0) return null;
    const s = angle;
    angle += sweep;
    const e = angle;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const ix1 = cx + ir * Math.cos(e), iy1 = cy + ir * Math.sin(e);
    const ix2 = cx + ir * Math.cos(s), iy2 = cy + ir * Math.sin(s);
    const lg = sweep > Math.PI ? 1 : 0;
    return (
      <path key={seg.name}
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${lg} 0 ${ix2} ${iy2} Z`}
        fill={seg.color}
      />
    );
  });
  return (
    <svg width={size} height={size}>
      {total === 0
        ? <circle cx={cx} cy={cy} r={r} fill="#f1f5f9" />
        : paths}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a" fontFamily="Inter">{total}</text>
      {label && <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="Inter">{label}</text>}
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function groupByMonth<T>(items: T[], getDate: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const key = getDate(item).slice(0, 7); // YYYY-MM
    (acc[key] ??= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashData {
  tenants: Tenant[];
  memberships: TenantMembership[];
  profiles: Profile[];
  orders: Order[];
  tickets: UnifiedTicket[];
  invoices: Invoice[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [t, m, p, o, tk, inv] = await Promise.all([
        supabase.from('tenants').select('*'),
        supabase.from('tenant_memberships').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('orders').select('id,tenant_id,charge_amount,payment_status,paid,created_at'),
        supabase.from('unified_tickets').select('id,tenant_id,created_at'),
        supabase.from('invoices').select('id,tenant_id,total,status'),
      ]);
      if (t.error) throw t.error;
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      if (o.error) throw o.error;
      if (tk.error) throw tk.error;
      if (inv.error) throw inv.error;
      setData({
        tenants: t.data ?? [],
        memberships: m.data ?? [],
        profiles: p.data ?? [],
        orders: (o.data ?? []) as Order[],
        tickets: (tk.data ?? []) as UnifiedTicket[],
        invoices: (inv.data ?? []) as Invoice[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-slate-400 text-sm">Loading dashboard…</div>
    </div>
  );
  if (error) return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-red-500 text-sm">{error}</div>
    </div>
  );
  if (!data) return null;

  const { tenants, memberships, profiles, orders, tickets, invoices } = data;
  const now = new Date();

  // KPIs
  const platformRevenue = orders.reduce((s, o) => s + (o.charge_amount ?? 0), 0);
  const pendingSignups = profiles.filter(p => p.signup_status === 'pending').length;
  const ordersByTenant = orders.reduce((acc, o) => {
    (acc[o.tenant_id] ??= []).push(o);
    return acc;
  }, {} as Record<string, Order[]>);
  const atRisk = tenants.filter(t => {
    if (t.is_demo) return false;
    const exp = t.trial_ends_at ? new Date(t.trial_ends_at) < now : false;
    return exp && (ordersByTenant[t.id]?.length ?? 0) === 0;
  }).length;
  const invoiceTotal = invoices.reduce((s, i) => s + (i.total ?? 0), 0);

  const kpis = [
    { label: 'Platform Revenue', value: fmt(platformRevenue), icon: DollarSign, bg: 'bg-emerald-50', iconCls: 'text-emerald-600' },
    { label: 'Total Tenants', value: tenants.length, icon: Building2, bg: 'bg-blue-50', iconCls: 'text-blue-600' },
    { label: 'Total Tickets', value: tickets.length, icon: Ticket, bg: 'bg-violet-50', iconCls: 'text-violet-600' },
    { label: 'Total Members', value: memberships.length, icon: Users, bg: 'bg-amber-50', iconCls: 'text-amber-600' },
    { label: 'Total Invoices', value: `${invoices.length} · ${fmt(invoiceTotal)}`, icon: FileText, bg: 'bg-cyan-50', iconCls: 'text-cyan-600' },
    { label: 'Pending Signups', value: pendingSignups, icon: Clock, bg: 'bg-orange-50', iconCls: 'text-orange-600' },
    { label: 'At-Risk Tenants', value: atRisk, icon: AlertTriangle, bg: 'bg-red-50', iconCls: 'text-red-600' },
  ];

  // Charts data
  const months = last6Months();

  const tenantsByMonth = groupByMonth(tenants, t => t.created_at);
  const tenantGrowthData = months.map(m => ({ label: monthLabel(m), value: tenantsByMonth[m]?.length ?? 0 }));

  const ordersByMonth = groupByMonth(orders, o => o.created_at);
  const revenueData = months.map(m => ({
    label: monthLabel(m),
    value: (ordersByMonth[m] ?? []).reduce((s, o) => s + (o.charge_amount ?? 0), 0),
  }));

  const ticketsByMonth = groupByMonth(tickets, t => t.created_at);
  const ordersAndTicketsData = months.map(m => ({
    label: monthLabel(m),
    value: (ordersByMonth[m]?.length ?? 0) + (ticketsByMonth[m]?.length ?? 0),
  }));

  const invoiceStatusDist = [
    { name: 'Paid', value: invoices.filter(i => i.status === 'paid').length, color: '#16a34a' },
    { name: 'Unpaid', value: invoices.filter(i => i.status === 'unpaid' || i.status === 'outstanding').length, color: '#f59e0b' },
    { name: 'Overdue', value: invoices.filter(i => i.status === 'overdue').length, color: '#ef4444' },
    { name: 'Other', value: invoices.filter(i => !['paid','unpaid','outstanding','overdue'].includes(i.status)).length, color: '#94a3b8' },
  ].filter(s => s.value > 0);

  const signupDist = [
    { name: 'Pending', value: profiles.filter(p => p.signup_status === 'pending').length, color: '#f59e0b' },
    { name: 'Approved', value: profiles.filter(p => p.signup_status === 'approved').length, color: '#16a34a' },
    { name: 'Rejected', value: profiles.filter(p => p.signup_status === 'rejected').length, color: '#ef4444' },
  ].filter(s => s.value > 0);

  // Top tenants by revenue
  const topTenants = tenants
    .map(t => ({
      ...t,
      revenue: (ordersByTenant[t.id] ?? []).reduce((s, o) => s + (o.charge_amount ?? 0), 0),
      orderCount: ordersByTenant[t.id]?.length ?? 0,
      memberCount: memberships.filter(m => m.tenant_id === t.id).length,
      ticketCount: tickets.filter(tk => tk.tenant_id === t.id).length,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // Recent platform activity
  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)
    .map(o => ({
      ...o,
      tenantName: tenants.find(t => t.id === o.tenant_id)?.name ?? '—',
    }));

  // Recent tenants
  const recentTenants = [...tenants]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Super Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Platform-wide overview across all tenants</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs py-1.5">Refresh</button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="card px-4 py-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${k.bg}`}>
              <k.icon size={16} className={k.iconCls} />
            </div>
            <p className="text-lg font-bold text-slate-900 leading-none">{k.value}</p>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Tenant Growth</h2>
            <span className="text-xs text-slate-400">last 6 months</span>
          </div>
          <LineChart data={tenantGrowthData} color="#2563eb" />
          <div className="flex justify-between mt-1">
            {tenantGrowthData.map(d => (
              <span key={d.label} className="text-[9px] text-slate-400">{d.label}</span>
            ))}
          </div>
        </div>

        <div className="card px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Revenue by Month</h2>
            <TrendingUp size={13} className="text-brand-600" />
          </div>
          <BarChart data={revenueData} color="#16a34a" />
        </div>

        <div className="card px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Orders + Tickets</h2>
            <span className="text-xs text-slate-400">last 6 months</span>
          </div>
          <BarChart data={ordersAndTicketsData} color="#7c3aed" />
        </div>
      </div>

      {/* Charts row 2 + recent tenants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Invoice Status</h2>
          <div className="flex items-center gap-4">
            <DonutChart segments={invoiceStatusDist} label="invoices" />
            <div className="space-y-2 flex-1">
              {invoiceStatusDist.map(s => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-slate-600">{s.name}</span>
                  </div>
                  <span className="font-semibold text-slate-800">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Signup Status</h2>
          <div className="flex items-center gap-4">
            <DonutChart segments={signupDist} label="users" />
            <div className="space-y-2 flex-1">
              {signupDist.map(s => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-slate-600">{s.name}</span>
                  </div>
                  <span className="font-semibold text-slate-800">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Tenants */}
        <div className="card px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Recent Tenants</h2>
            <Link to="/superadmin/tenants-list" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
              All <ChevronRight size={11} />
            </Link>
          </div>
          <div className="space-y-2">
            {recentTenants.map(t => (
              <Link key={t.id} to={`/superadmin/tenants/${t.id}`}
                className="flex items-center justify-between py-1.5 hover:bg-surface-subtle rounded px-1 transition-colors">
                <div>
                  <p className="text-xs font-medium text-slate-800">{t.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(t.created_at).toLocaleDateString()}
                    {t.is_demo && ' · Demo'}
                    {t.trial_ends_at && !t.is_demo && ' · Trial'}
                  </p>
                </div>
                <ArrowUpRight size={13} className="text-slate-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top tenants table */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-slate-800">Top Tenants by Revenue</h2>
          <Link to="/superadmin/tenants" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
            Analytics <ChevronRight size={11} />
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-subtle border-b border-surface-border">
              {['Tenant', 'Members', 'Orders', 'Tickets', 'Revenue'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {topTenants.map(t => (
              <tr key={t.id} className="hover:bg-surface-subtle transition-colors">
                <td className="px-5 py-3">
                  <Link to={`/superadmin/tenants/${t.id}`} className="font-medium text-slate-800 hover:text-brand-600 transition-colors">
                    {t.name}
                  </Link>
                  {t.is_demo && <span className="ml-2 badge bg-blue-50 text-blue-700">Demo</span>}
                </td>
                <td className="px-5 py-3 text-slate-600">{t.memberCount}</td>
                <td className="px-5 py-3 text-slate-600">{t.orderCount}</td>
                <td className="px-5 py-3 text-slate-600">{t.ticketCount}</td>
                <td className="px-5 py-3 font-semibold text-slate-800">{fmt(t.revenue)}</td>
              </tr>
            ))}
            {topTenants.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400 text-sm">No tenant data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent platform activity */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-slate-800">Recent Platform Activity</h2>
          <span className="text-xs text-slate-400">Latest orders across all tenants</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-subtle border-b border-surface-border">
              {['Order', 'Tenant', 'Amount', 'Status', 'Date'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {recentOrders.map(o => (
              <tr key={o.id} className="hover:bg-surface-subtle transition-colors">
                <td className="px-5 py-3 font-mono text-xs font-semibold text-brand-700">
                  {o.order_number || o.id.slice(0, 8)}
                </td>
                <td className="px-5 py-3">
                  <Link to={`/superadmin/tenants/${o.tenant_id}`} className="text-slate-700 hover:text-brand-600 transition-colors">
                    {o.tenantName}
                  </Link>
                </td>
                <td className="px-5 py-3 font-semibold text-slate-800">{fmt(o.charge_amount ?? 0)}</td>
                <td className="px-5 py-3">
                  <span className={`badge ${o.paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {o.payment_status || (o.paid ? 'Paid' : 'Unpaid')}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">
                  {new Date(o.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {recentOrders.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400 text-sm">No orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
