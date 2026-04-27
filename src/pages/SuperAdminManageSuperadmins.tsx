import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { supabase, EDGE_BASE } from '../lib/supabase';
import type { Profile, UserRole } from '../types/superadmin';

interface SuperadminRow {
  userId: string;
  profile: Profile | undefined;
  grantedAt: string;
}

async function callManageSuperadmins(action: string, payload: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${EDGE_BASE}/manage-superadmins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.status === 401) {
    const { data: { session: newSession } } = await supabase.auth.refreshSession();
    const retry = await fetch(`${EDGE_BASE}/manage-superadmins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${newSession?.access_token ?? ''}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    return retry.json();
  }
  return res.json();
}

export default function SuperAdminManageSuperadmins() {
  const [superadmins, setSuperadmins] = useState<SuperadminRow[]>([]);
  const [eligibleProfiles, setEligibleProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [r, p] = await Promise.all([
        supabase.from('user_roles').select('*').eq('role', 'superadmin'),
        supabase.from('profiles').select('*').limit(300),
      ]);
      if (r.error) throw r.error;
      const roles: UserRole[] = r.data ?? [];
      const profiles: Profile[] = p.data ?? [];
      const superadminUserIds = new Set(roles.map(r => r.user_id));

      setSuperadmins(roles.map(role => ({
        userId: role.user_id,
        profile: profiles.find(p => p.id === role.user_id),
        grantedAt: role.created_at,
      })));

      setEligibleProfiles(
        profiles
          .filter(p => !superadminUserIds.has(p.id) && p.email)
          .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load superadmins');
    } finally {
      setLoading(false);
    }
  }

  async function grantSuperadmin() {
    if (!selectedUserId) return;
    setGranting(true);
    setActionError(null);
    try {
      const result = await callManageSuperadmins('grant-superadmin', { user_id: selectedUserId });
      if (result.error) throw new Error(result.error);
      setSelectedUserId('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Grant failed');
    } finally {
      setGranting(false);
    }
  }

  async function revokeSuperadmin(userId: string) {
    setRevoking(userId);
    setActionError(null);
    try {
      const result = await callManageSuperadmins('revoke-superadmin', { user_id: userId });
      if (result.error) throw new Error(result.error);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading superadmins…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Manage Super Admins</h1>
        <p className="text-sm text-slate-500 mt-0.5">Grant and revoke superadmin platform access</p>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{actionError}</div>
      )}

      {/* Grant superadmin */}
      <div className="card px-6 py-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <UserPlus size={15} className="text-brand-600" /> Promote Existing User
        </h2>
        <div className="flex gap-2">
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">Select a user to promote…</option>
            {eligibleProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.full_name ? `${p.full_name} (${p.email})` : p.email}
              </option>
            ))}
          </select>
          <button onClick={grantSuperadmin} disabled={!selectedUserId || granting}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
            {granting ? 'Granting…' : 'Make Superadmin'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          This grants the user, admin, and superadmin roles and approves their signup status.
        </p>
      </div>

      {/* Current superadmins list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex items-center gap-2">
          <ShieldCheck size={15} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-800">Current Superadmins ({superadmins.length})</h2>
        </div>
        <div className="divide-y divide-surface-border">
          {superadmins.map(sa => {
            const name = sa.profile?.full_name || sa.profile?.email || sa.userId;
            const email = sa.profile?.email;
            const initials = name.slice(0, 2).toUpperCase();
            return (
              <div key={sa.userId} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700">
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{name}</p>
                    {email && name !== email && <p className="text-xs text-slate-400">{email}</p>}
                    <p className="text-[10px] text-slate-400">Granted {new Date(sa.grantedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <button
                  onClick={() => revokeSuperadmin(sa.userId)}
                  disabled={superadmins.length <= 1 || revoking === sa.userId}
                  title={superadmins.length <= 1 ? 'Cannot remove the last superadmin' : 'Revoke superadmin'}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ShieldOff size={13} />
                  {revoking === sa.userId ? 'Revoking…' : 'Remove'}
                </button>
              </div>
            );
          })}
          {superadmins.length === 0 && (
            <p className="px-5 py-6 text-sm text-slate-400 text-center">No superadmins found.</p>
          )}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
        <strong>Note:</strong> Revoking superadmin only removes the <code>superadmin</code> role row.
        The user retains their <code>user</code> and <code>admin</code> roles. The last superadmin cannot be removed.
      </div>
    </div>
  );
}
