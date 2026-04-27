import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { supabase, EDGE_BASE } from '../lib/supabase';
import type { Profile, UserRole, Tenant } from '../types/superadmin';

interface RecentUser {
  profile: Profile;
  roles: UserRole[];
  tenantCount: number;
  topTenant: string;
}

function passwordStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length < 6) return { level: 0, label: 'Too short', color: 'bg-red-400' };
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: 'Weak', color: 'bg-amber-400' };
  if (score <= 2) return { level: 2, label: 'Good', color: 'bg-brand-500' };
  return { level: 3, label: 'Strong', color: 'bg-emerald-500' };
}

async function callEdgeFunction(functionName: string, body: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${EDGE_BASE}/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const { data: { session: newSession } } = await supabase.auth.refreshSession();
    const retry = await fetch(`${EDGE_BASE}/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${newSession?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    return retry.json();
  }
  return res.json();
}

export default function SuperAdminAddAdmin() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Issue 1 fix: tenant selector
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'member' | 'admin' | 'owner'>('member');
  const [tenants, setTenants] = useState<Pick<Tenant, 'id' | 'name'>[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ userId: string; isExisting: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [t, r, m, tenantList] = await Promise.all([
      supabase.from('profiles').select('*').order('updated_at', { ascending: false }).limit(5),
      supabase.from('user_roles').select('*'),
      supabase.from('tenant_memberships').select('*'),
      supabase.from('tenants').select('id,name').order('name'),
    ]);
    const profiles: Profile[] = t.data ?? [];
    const roles: UserRole[] = r.data ?? [];
    const memberships = m.data ?? [];
    const tenantData = (tenantList.data ?? []) as Pick<Tenant, 'id' | 'name'>[];
    setTenants(tenantData);
    setRecentUsers(profiles.map(profile => {
      const userRoles = roles.filter(r => r.user_id === profile.id);
      const userMemberships = memberships.filter((m: { user_id: string }) => m.user_id === profile.id);
      const topTenantId = userMemberships[0]?.tenant_id;
      return {
        profile,
        roles: userRoles,
        tenantCount: userMemberships.length,
        topTenant: tenantData.find(t => t.id === topTenantId)?.name ?? '—',
      };
    }));
  }

  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const strength = passwordStrength(password);
  const canSubmit = emailValid && password.length >= 6 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const body: Record<string, unknown> = {
        action: 'create-user',
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
        role: selectedTenantId ? selectedRole : undefined,
        features: [],
      };
      if (selectedTenantId) body.tenant_id = selectedTenantId;

      const result = await callEdgeFunction('manage-workspace-users', body);
      if (result.error) throw new Error(result.error);
      setSuccess({ userId: result.user_id, isExisting: result.existing_user });
      setEmail('');
      setFullName('');
      setPassword('');
      setSelectedTenantId('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Add User</h1>
        <p className="text-sm text-slate-500 mt-0.5">Create a new platform user account</p>
      </div>

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
          {success.isExisting ? 'Existing account found and updated.' : 'User created successfully.'}{' '}
          <Link to={`/superadmin/users/${success.userId}`} className="underline font-medium">View user →</Link>
          {!selectedTenantId && (
            <p className="mt-1 text-xs text-emerald-600">
              No workspace assigned. Go to <Link to="/superadmin/tenants-list" className="underline">Manage Tenants</Link> to add them to a workspace.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="card px-6 py-5 space-y-5">
        {/* Full name */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="e.g. Jane Smith"
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email *</label>
          <input value={email} onChange={e => setEmail(e.target.value)}
            type="email" placeholder="user@example.com"
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 ${email && !emailValid ? 'border-red-300' : 'border-surface-border'}`} />
          {email && !emailValid && <p className="text-xs text-red-500 mt-1">Enter a valid email address</p>}
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password *</label>
          <div className="relative">
            <input value={password} onChange={e => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 6 characters"
              className="w-full px-3 py-2 pr-10 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1 mb-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i <= strength.level ? strength.color : 'bg-slate-200'}`} />
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {strength.level === 0 ? <ShieldAlert size={11} className="text-red-400" /> :
                 strength.level <= 1 ? <Shield size={11} className="text-amber-400" /> :
                 <ShieldCheck size={11} className="text-emerald-500" />}
                <span className="text-slate-500">{strength.label}</span>
              </div>
            </div>
          )}
        </div>

        {/* Issue 1 fix: optional tenant selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Assign to Workspace <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <select value={selectedTenantId} onChange={e => setSelectedTenantId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">— No workspace —</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!selectedTenantId && (
            <p className="text-xs text-amber-600 mt-1">
              Without a workspace, this user will appear as "Unassigned" in the Users list.
            </p>
          )}
        </div>

        {/* Role (only shown when tenant selected) */}
        {selectedTenantId && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role in Workspace</label>
            <div className="flex gap-2">
              {(['member', 'admin', 'owner'] as const).map(r => (
                <button key={r} type="button" onClick={() => setSelectedRole(r)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${selectedRole === r ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-surface-border hover:border-brand-300'}`}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="submit" disabled={!canSubmit}
          className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting ? 'Creating…' : 'Create User'}
        </button>
      </form>

      {/* Recent users */}
      {recentUsers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Recently Updated Users</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {recentUsers.map(u => (
              <div key={u.profile.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{u.profile.full_name || u.profile.email}</p>
                  <p className="text-xs text-slate-400">{u.profile.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {u.roles.some(r => r.role === 'superadmin' || r.role === 'admin') && (
                      <span className="badge bg-violet-50 text-violet-700 text-[10px]">Platform Admin</span>
                    )}
                    {u.tenantCount > 0 && (
                      <p className="text-[10px] text-slate-400 mt-0.5">{u.topTenant} {u.tenantCount > 1 ? `+${u.tenantCount - 1}` : ''}</p>
                    )}
                  </div>
                  <Link to={`/superadmin/users/${u.profile.id}`} className="text-xs text-brand-600 hover:underline">View</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
