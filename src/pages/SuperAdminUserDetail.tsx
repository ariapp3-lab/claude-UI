import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole, TenantMembership, Order, Todo, OrderHistory } from '../types/superadmin';

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function BarChart({ data, color = '#16a34a' }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const h = 80, w = 360, barW = Math.max(16, (w / data.length) - 4);
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <button onClick={copy} className="text-slate-400 hover:text-brand-600 transition-colors ml-1">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
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
  profile: Profile;
  roles: UserRole[];
  memberships: (TenantMembership & { tenantName: string })[];
  orders: Order[];
  todos: Todo[];
  activity: OrderHistory[];
}

export default function SuperAdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (userId) load(userId); }, [userId]);

  async function load(uid: string) {
    try {
      setLoading(true);
      const [p, r, m, o, t, a, tenants] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).single(),
        supabase.from('user_roles').select('*').eq('user_id', uid),
        supabase.from('tenant_memberships').select('*').eq('user_id', uid),
        supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
        supabase.from('todos').select('*').eq('user_id', uid),
        supabase.from('order_history').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
        supabase.from('tenants').select('id,name'),
      ]);
      if (p.error) throw p.error;
      const tenantList = tenants.data ?? [];
      const memberships = (m.data ?? []).map((mem: TenantMembership) => ({
        ...mem,
        tenantName: tenantList.find((t: { id: string; name: string }) => t.id === mem.tenant_id)?.name ?? '—',
      }));
      setData({
        profile: p.data,
        roles: r.data ?? [],
        memberships,
        orders: o.data ?? [],
        todos: t.data ?? [],
        activity: a.data ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading user…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;
  if (!data) return null;

  const { profile, roles, memberships, orders, todos, activity } = data;
  const totalRevenue = orders.reduce((s, o) => s + (o.charge_amount ?? 0), 0);

  const months = last6Months();
  const ordersByMonth: Record<string, Order[]> = orders.reduce((acc, o) => {
    const k = o.created_at.slice(0, 7);
    (acc[k] ??= []).push(o);
    return acc;
  }, {} as Record<string, Order[]>);
  const ordersData = months.map(m => ({
    label: monthLabel(m),
    value: ordersByMonth[m]?.length ?? 0,
  }));

  const initials = (profile.full_name || profile.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/superadmin/users" className="text-slate-400 hover:text-slate-600"><ArrowLeft size={18} /></Link>
        <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
          {initials}
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{profile.full_name || profile.email || 'Unknown'}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{profile.email}</p>
        </div>
      </div>

      {/* User ID + signup status */}
      <div className="card px-5 py-4 flex flex-wrap gap-6">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">User ID</p>
          <div className="flex items-center">
            <span className="text-xs font-mono text-slate-700">{profile.id}</span>
            <CopyButton text={profile.id} />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Signup Status</p>
          <span className={`badge ${profile.signup_status === 'approved' ? 'bg-emerald-50 text-emerald-700' : profile.signup_status === 'pending' ? 'bg-amber-50 text-amber-700' : profile.signup_status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
            {profile.signup_status ?? 'n/a'}
          </span>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Joined</p>
          <p className="text-xs text-slate-700">{new Date(profile.created_at).toLocaleDateString()}</p>
        </div>
        {profile.signup_rejection_reason && (
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">Rejection Reason</p>
            <p className="text-xs text-slate-700">{profile.signup_rejection_reason}</p>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Orders', value: orders.length },
          { label: 'Order Revenue', value: fmt(totalRevenue) },
          { label: 'Platform Roles', value: roles.length },
          { label: 'Tenant Memberships', value: memberships.length },
        ].map(c => (
          <div key={c.label} className="card px-4 py-3">
            <p className="text-lg font-bold text-slate-900">{c.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="card px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Orders per Month</h2>
        <BarChart data={ordersData} />
      </div>

      {/* Platform roles + Memberships */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Platform Roles</h2>
          {roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <span key={r.id} className="px-3 py-1.5 bg-violet-50 text-violet-700 text-xs rounded-lg font-medium uppercase tracking-wide">
                  {r.role}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No platform roles assigned.</p>
          )}
        </div>

        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Tenant Memberships</h2>
          {memberships.length > 0 ? (
            <div className="space-y-2">
              {memberships.map(m => (
                <div key={m.id} className="flex items-center justify-between">
                  <Link to={`/superadmin/tenants/${m.tenant_id}`} className="text-sm text-slate-700 hover:text-brand-600 transition-colors">
                    {m.tenantName}
                  </Link>
                  <span className={`badge ${m.role === 'owner' ? 'bg-brand-50 text-brand-700' : m.role === 'admin' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No workspace memberships.</p>
          )}
        </div>
      </div>

      {/* Recent orders + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Recent Orders</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {orders.slice(0, 6).map(o => (
              <div key={o.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-xs font-mono font-semibold text-brand-700">{o.order_number || o.id.slice(0, 8)}</p>
                  <p className="text-[10px] text-slate-400">{new Date(o.created_at).toLocaleDateString()}</p>
                </div>
                <span className="text-sm font-semibold text-slate-800">{fmt(o.charge_amount ?? 0)}</span>
              </div>
            ))}
            {orders.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No orders yet.</p>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Activity Log</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {activity.slice(0, 8).map(a => (
              <div key={a.id} className="px-5 py-3">
                <p className="text-xs text-slate-700">{a.description || a.action_type}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{new Date(a.created_at).toLocaleString()}</p>
              </div>
            ))}
            {activity.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No activity recorded.</p>}
          </div>
        </div>
      </div>

      {/* Open todos */}
      {todos.filter(t => !t.completed).length > 0 && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Open Todos ({todos.filter(t => !t.completed).length})</h2>
          <div className="space-y-2">
            {todos.filter(t => !t.completed).slice(0, 5).map(todo => (
              <div key={todo.id} className="flex items-center justify-between">
                <p className="text-sm text-slate-700">{todo.title}</p>
                {todo.due_date && (
                  <span className={`text-xs ${new Date(todo.due_date) < new Date() ? 'text-red-500' : 'text-slate-400'}`}>
                    {new Date(todo.due_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
