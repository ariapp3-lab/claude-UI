import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ArrowUpRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tenant, TenantMembership, Profile, Order, UnifiedTicket, Invoice } from '../types/superadmin';

type Health = 'Healthy' | 'Trial' | 'At Risk' | 'Demo';

interface TenantRow {
  tenant: Tenant;
  ownerName: string;
  memberCount: number;
  orderCount: number;
  ticketCount: number;
  revenue: number;
  paidInvoiceTotal: number;
  health: Health;
  trialLabel: string | null;
}

function healthBadge(h: Health) {
  const styles: Record<Health, string> = {
    Healthy: 'bg-emerald-50 text-emerald-700',
    Trial: 'bg-blue-50 text-blue-700',
    'At Risk': 'bg-red-50 text-red-700',
    Demo: 'bg-slate-100 text-slate-600',
  };
  return <span className={`badge ${styles[h]}`}>{h}</span>;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
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
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f172a" fontFamily="Inter">{total}</text>
    </svg>
  );
}

export default function SuperAdminTenants() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [t, m, p, o, tk, inv] = await Promise.all([
        supabase.from('tenants').select('*').order('created_at', { ascending: false }),
        supabase.from('tenant_memberships').select('*'),
        supabase.from('profiles').select('id,email,full_name'),
        supabase.from('orders').select('id,tenant_id,charge_amount,created_at'),
        supabase.from('unified_tickets').select('id,tenant_id'),
        supabase.from('invoices').select('id,tenant_id,total,status'),
      ]);
      if (t.error) throw t.error;

      const tenants: Tenant[] = t.data ?? [];
      const memberships: TenantMembership[] = m.data ?? [];
      const profiles = (p.data ?? []) as Pick<Profile, 'id' | 'email' | 'full_name'>[];
      const orders = (o.data ?? []) as Pick<Order, 'id' | 'tenant_id' | 'charge_amount' | 'created_at'>[];
      const tickets = (tk.data ?? []) as Pick<UnifiedTicket, 'id' | 'tenant_id'>[];
      const invoices = (inv.data ?? []) as Pick<Invoice, 'id' | 'tenant_id' | 'total' | 'status'>[];
      const now = new Date();

      const computed: TenantRow[] = tenants.map(tenant => {
        const tenantOrders = orders.filter(o => o.tenant_id === tenant.id);
        const tenantTickets = tickets.filter(t => t.tenant_id === tenant.id);
        const tenantInvoices = invoices.filter(i => i.tenant_id === tenant.id);
        const tenantMembers = memberships.filter(m => m.tenant_id === tenant.id);
        const owner = tenantMembers.find(m => m.role === 'owner');
        const ownerProfile = profiles.find(p => p.id === owner?.user_id);
        const revenue = tenantOrders.reduce((s, o) => s + (o.charge_amount ?? 0), 0);
        const paidInvoiceTotal = tenantInvoices
          .filter(i => i.status === 'paid')
          .reduce((s, i) => s + (i.total ?? 0), 0);

        const trialEnds = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
        const trialExpired = trialEnds ? trialEnds < now : false;
        let health: Health;
        let trialLabel: string | null = null;
        if (tenant.is_demo) {
          health = 'Demo';
        } else if (trialEnds && trialEnds > now) {
          health = 'Trial';
          const days = Math.ceil((trialEnds.getTime() - now.getTime()) / 86400000);
          trialLabel = `${days}d left`;
        } else if (trialExpired && tenantOrders.length === 0) {
          health = 'At Risk';
        } else {
          health = 'Healthy';
        }

        return {
          tenant,
          ownerName: ownerProfile?.full_name || ownerProfile?.email || '—',
          memberCount: tenantMembers.length,
          orderCount: tenantOrders.length,
          ticketCount: tenantTickets.length,
          revenue,
          paidInvoiceTotal,
          health,
          trialLabel,
        };
      });

      setRows(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant analytics');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading tenant analytics…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;

  const healthDist = [
    { name: 'Healthy', value: rows.filter(r => r.health === 'Healthy').length, color: '#16a34a' },
    { name: 'Trial', value: rows.filter(r => r.health === 'Trial').length, color: '#2563eb' },
    { name: 'At Risk', value: rows.filter(r => r.health === 'At Risk').length, color: '#ef4444' },
    { name: 'Demo', value: rows.filter(r => r.health === 'Demo').length, color: '#94a3b8' },
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tenant Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Health scores and revenue metrics for all workspaces</p>
        </div>
        <div className="flex gap-2">
          <Link to="/superadmin/tenants-list" className="btn-secondary text-xs py-1.5">Manage Tenants</Link>
          <Link to="/superadmin/add-tenant" className="btn-primary text-xs py-1.5">+ Add Tenant</Link>
        </div>
      </div>

      {/* Summary + health donut */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card px-4 py-3 col-span-2 lg:col-span-2 flex items-center gap-5">
          <DonutChart segments={healthDist} />
          <div className="space-y-2">
            {healthDist.map(s => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-slate-600 w-14">{s.name}</span>
                <span className="font-semibold text-slate-800">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
        {[
          { label: 'Total Tenants', value: rows.length },
          { label: 'At Risk', value: rows.filter(r => r.health === 'At Risk').length },
          { label: 'On Trial', value: rows.filter(r => r.health === 'Trial').length },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex flex-col justify-center">
            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tenant table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-slate-800">All Tenants ({rows.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Tenant', 'Owner', 'Members', 'Health', 'Revenue', 'Orders', 'Tickets', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map(r => (
                <tr key={r.tenant.id} className="hover:bg-surface-subtle transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                        <Building2 size={13} className="text-brand-600" />
                      </div>
                      <span className="font-medium text-slate-800">{r.tenant.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{r.ownerName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.memberCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {healthBadge(r.health)}
                      {r.trialLabel && <span className="text-[10px] text-slate-400">{r.trialLabel}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{fmt(r.revenue)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.orderCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.ticketCount}</td>
                  <td className="px-4 py-3">
                    <Link to={`/superadmin/tenants/${r.tenant.id}`}
                      className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
                      View <ArrowUpRight size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400 text-sm">No tenants yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
