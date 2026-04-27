import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile, TenantMembership, UserRole, Tenant } from '../types/superadmin';

type AccessFilter = 'All' | 'Platform Admin' | 'Tenant Admin' | 'Member' | 'Unassigned';
type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

interface UserRow {
  profile: Profile;
  roles: UserRole[];
  memberships: (TenantMembership & { tenantName: string })[];
  accessCategory: 'platform-admin' | 'tenant-admin' | 'member' | 'unassigned';
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
const PAGE_SIZE = 12;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button onClick={copy} className="text-slate-400 hover:text-brand-600 transition-colors">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

export default function SuperAdminUsers() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('All');
  const [sort, setSort] = useState<SortOption>('newest');
  const [page, setPage] = useState(1);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [p, m, r, t] = await Promise.all([
        supabase.from('profiles').select('*').limit(1000),
        supabase.from('tenant_memberships').select('*'),
        supabase.from('user_roles').select('*'),
        supabase.from('tenants').select('id,name'),
      ]);
      if (p.error) throw p.error;
      const profiles: Profile[] = p.data ?? [];
      const memberships: TenantMembership[] = m.data ?? [];
      const roles: UserRole[] = r.data ?? [];
      const tenants = (t.data ?? []) as Pick<Tenant, 'id' | 'name'>[];

      const computed: UserRow[] = profiles.map(profile => {
        const userRoles = roles.filter(r => r.user_id === profile.id);
        const userMemberships = memberships
          .filter(m => m.user_id === profile.id)
          .map(m => ({ ...m, tenantName: tenants.find(t => t.id === m.tenant_id)?.name ?? '—' }));

        let accessCategory: UserRow['accessCategory'];
        const roleNames = userRoles.map(r => r.role);
        if (roleNames.includes('admin') || roleNames.includes('superadmin')) {
          accessCategory = 'platform-admin';
        } else if (userMemberships.some(m => m.role === 'owner' || m.role === 'admin')) {
          accessCategory = 'tenant-admin';
        } else if (userMemberships.length > 0) {
          accessCategory = 'member';
        } else {
          accessCategory = 'unassigned';
        }

        return { profile, roles: userRoles, memberships: userMemberships, accessCategory };
      });

      setRows(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      r.profile.email?.toLowerCase().includes(q) ||
      r.profile.full_name?.toLowerCase().includes(q) ||
      r.profile.id.toLowerCase().includes(q);
    const matchesAccess = accessFilter === 'All' || (
      accessFilter === 'Platform Admin' ? r.accessCategory === 'platform-admin' :
      accessFilter === 'Tenant Admin' ? r.accessCategory === 'tenant-admin' :
      accessFilter === 'Member' ? r.accessCategory === 'member' :
      r.accessCategory === 'unassigned'
    );
    return matchesSearch && matchesAccess;
  }).sort((a, b) => {
    if (sort === 'newest') return new Date(b.profile.created_at).getTime() - new Date(a.profile.created_at).getTime();
    if (sort === 'oldest') return new Date(a.profile.created_at).getTime() - new Date(b.profile.created_at).getTime();
    if (sort === 'name-asc') return (a.profile.full_name || a.profile.email || '').localeCompare(b.profile.full_name || b.profile.email || '');
    return (b.profile.full_name || b.profile.email || '').localeCompare(a.profile.full_name || a.profile.email || '');
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const accessBadge = (cat: UserRow['accessCategory']) => {
    const styles: Record<string, string> = {
      'platform-admin': 'bg-violet-50 text-violet-700',
      'tenant-admin': 'bg-blue-50 text-blue-700',
      'member': 'bg-slate-100 text-slate-600',
      'unassigned': 'bg-red-50 text-red-600',
    };
    const labels: Record<string, string> = {
      'platform-admin': 'Platform Admin',
      'tenant-admin': 'Tenant Admin',
      'member': 'Member',
      'unassigned': 'Unassigned',
    };
    return <span className={`badge ${styles[cat]}`}>{labels[cat]}</span>;
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">All platform users across tenants</p>
        </div>
        <Link to="/superadmin/add-admin" className="btn-primary text-xs py-1.5">+ Add User</Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, email, or user ID…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(['All', 'Platform Admin', 'Tenant Admin', 'Member', 'Unassigned'] as AccessFilter[]).map(f => (
            <button key={f} onClick={() => { setAccessFilter(f); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${accessFilter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {f}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortOption)}
          className="px-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Loading users…</div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {paginated.map((r, i) => {
              const initials = (r.profile.full_name || r.profile.email || '?').slice(0, 2).toUpperCase();
              const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
              return (
                <div key={r.profile.id} className="card px-4 py-4 hover:shadow-card-hover transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarColor}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link to={`/superadmin/users/${r.profile.id}`}
                          className="text-sm font-semibold text-slate-800 hover:text-brand-600 transition-colors truncate">
                          {r.profile.full_name || r.profile.email || 'Unknown'}
                        </Link>
                        {accessBadge(r.accessCategory)}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{r.profile.email}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-400 font-mono truncate">{r.profile.id.slice(0, 16)}…</span>
                        <CopyButton text={r.profile.id} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-surface-border">
                    {r.memberships.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.memberships.slice(0, 3).map(m => (
                          <span key={m.id} className="text-[10px] bg-surface-muted text-slate-600 px-2 py-0.5 rounded-full">
                            {m.tenantName} · {m.role}
                          </span>
                        ))}
                        {r.memberships.length > 3 && (
                          <span className="text-[10px] text-slate-400">+{r.memberships.length - 3} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">No workspace assigned</span>
                    )}
                  </div>
                  {r.roles.length > 0 && (
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {r.roles.map(role => (
                        <span key={role.id} className="text-[9px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">
                          {role.role}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-2">
                    Joined {new Date(r.profile.created_at).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">No users match your filters.</div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} users
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1.5 rounded border border-surface-border text-slate-600 hover:bg-surface-muted disabled:opacity-40">
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded text-xs font-medium transition-colors ${page === p ? 'bg-brand-600 text-white' : 'border border-surface-border text-slate-600 hover:bg-surface-muted'}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-1.5 rounded border border-surface-border text-slate-600 hover:bg-surface-muted disabled:opacity-40">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
