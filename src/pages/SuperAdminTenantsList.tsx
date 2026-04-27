import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Edit2, Eye, Trash2, AlertTriangle, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tenant, TenantMembership, Profile } from '../types/superadmin';

type Status = 'All' | 'Active' | 'Trial' | 'Demo';

interface TenantRow {
  tenant: Tenant;
  ownerName: string;
  ownerEmail: string;
  memberCount: number;
  status: 'Active' | 'Trial' | 'Demo';
}

interface DeleteCounts {
  orders: number;
  tickets: number;
  airfiles: number;
  customers: number;
}

export default function SuperAdminTenantsList() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status>('All');
  const [deletingTenant, setDeletingTenant] = useState<TenantRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteCounts, setDeleteCounts] = useState<DeleteCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [t, m, p] = await Promise.all([
        supabase.from('tenants').select('*').order('created_at', { ascending: false }),
        supabase.from('tenant_memberships').select('*'),
        supabase.from('profiles').select('id,email,full_name'),
      ]);
      if (t.error) throw t.error;
      const tenants: Tenant[] = t.data ?? [];
      const memberships: TenantMembership[] = m.data ?? [];
      const profiles = (p.data ?? []) as Pick<Profile, 'id' | 'email' | 'full_name'>[];
      const now = new Date();
      const computed: TenantRow[] = tenants.map(tenant => {
        const tenantMembers = memberships.filter(m => m.tenant_id === tenant.id);
        const owner = tenantMembers.find(m => m.role === 'owner');
        const ownerProfile = profiles.find(p => p.id === owner?.user_id);
        let status: 'Active' | 'Trial' | 'Demo';
        if (tenant.is_demo) status = 'Demo';
        else if (tenant.trial_ends_at && new Date(tenant.trial_ends_at) > now) status = 'Trial';
        else status = 'Active';
        return {
          tenant,
          ownerName: ownerProfile?.full_name || ownerProfile?.email || '—',
          ownerEmail: ownerProfile?.email || '',
          memberCount: tenantMembers.length,
          status,
        };
      });
      setRows(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }

  async function openDeleteDialog(row: TenantRow) {
    setDeletingTenant(row);
    setDeleteConfirmName('');
    setDeleteCounts(null);
    setLoadingCounts(true);
    try {
      const [orders, tickets, airfiles, customers] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', row.tenant.id),
        supabase.from('unified_tickets').select('id', { count: 'exact', head: true }).eq('tenant_id', row.tenant.id),
        supabase.from('parsed_airfiles').select('id', { count: 'exact', head: true }).eq('tenant_id', row.tenant.id),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', row.tenant.id),
      ]);
      setDeleteCounts({
        orders: orders.count ?? 0,
        tickets: tickets.count ?? 0,
        airfiles: airfiles.count ?? 0,
        customers: customers.count ?? 0,
      });
    } catch {
      setDeleteCounts({ orders: 0, tickets: 0, airfiles: 0, customers: 0 });
    } finally {
      setLoadingCounts(false);
    }
  }

  async function confirmDelete() {
    if (!deletingTenant) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('tenants').delete().eq('id', deletingTenant.tenant.id);
      if (error) throw error;
      setDeletingTenant(null);
      setDeleteConfirmName('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchesSearch = !q || r.tenant.name.toLowerCase().includes(q)
      || r.ownerName.toLowerCase().includes(q)
      || r.ownerEmail.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'All' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (s: string) => {
    const styles: Record<string, string> = {
      Active: 'bg-emerald-50 text-emerald-700',
      Trial: 'bg-blue-50 text-blue-700',
      Demo: 'bg-slate-100 text-slate-600',
    };
    return <span className={`badge ${styles[s] ?? ''}`}>{s}</span>;
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Manage Tenants</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create, edit, and delete workspace tenants</p>
        </div>
        <Link to="/superadmin/add-tenant" className="btn-primary text-xs py-1.5">+ Add Tenant</Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tenant name or owner…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(['All', 'Active', 'Trial', 'Demo'] as Status[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Loading tenants…</div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Tenant', 'Owner', 'Members', 'Status', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filtered.map(r => (
                <tr key={r.tenant.id} className="hover:bg-surface-subtle transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.tenant.name}</td>
                  <td className="px-5 py-3 text-slate-600 text-xs">{r.ownerName}</td>
                  <td className="px-5 py-3 text-slate-600">{r.memberCount}</td>
                  <td className="px-5 py-3">{statusBadge(r.status)}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {new Date(r.tenant.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/superadmin/edit-tenant/${r.tenant.id}`}
                        className="flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600 transition-colors">
                        <Edit2 size={12} /> Edit
                      </Link>
                      <Link to={`/superadmin/tenants/${r.tenant.id}`}
                        className="flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600 transition-colors">
                        <Eye size={12} /> View
                      </Link>
                      <button onClick={() => openDeleteDialog(r)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors">
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400 text-sm">No tenants match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation dialog — Issue 5 fix: shows cascade counts */}
      {deletingTenant && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={18} />
                <h2 className="text-base font-bold">Delete Tenant</h2>
              </div>
              <button onClick={() => setDeletingTenant(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-slate-700 mb-3">
              You are about to permanently delete <strong>{deletingTenant.tenant.name}</strong>.
              This action cannot be undone.
            </p>

            {loadingCounts ? (
              <div className="text-xs text-slate-400 mb-4">Calculating affected records…</div>
            ) : deleteCounts && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                <p className="text-xs font-semibold text-red-700 mb-2">This will permanently delete:</p>
                <div className="grid grid-cols-2 gap-1 text-xs text-red-600">
                  <span>{deleteCounts.orders} orders</span>
                  <span>{deleteCounts.tickets} tickets</span>
                  <span>{deleteCounts.airfiles} airfiles</span>
                  <span>{deleteCounts.customers} customers</span>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500 mb-2">
              Type <strong>{deletingTenant.tenant.name}</strong> to confirm:
            </p>
            <input
              value={deleteConfirmName}
              onChange={e => setDeleteConfirmName(e.target.value)}
              placeholder={deletingTenant.tenant.name}
              className="w-full px-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
            />

            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletingTenant(null)} className="btn-secondary text-xs py-1.5">Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirmName !== deletingTenant.tenant.name || deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
