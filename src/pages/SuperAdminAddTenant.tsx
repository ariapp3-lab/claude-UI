import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, X, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tenant, Profile } from '../types/superadmin';

type TenantStatus = 'active' | 'trial' | 'demo';

interface MemberEntry {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

export default function SuperAdminAddTenant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [status, setStatus] = useState<TenantStatus>('active');
  const [trialDays, setTrialDays] = useState(14);
  const [aitanInput, setAitanInput] = useState('');
  const [aitanCodes, setAitanCodes] = useState<string[]>([]);
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingTenant, setLoadingTenant] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  // Member search
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (isEdit && id) loadTenant(id);
  }, [id]);

  useEffect(() => {
    if (!memberSearch.trim()) { setMemberResults([]); return; }
    const t = setTimeout(() => searchProfiles(memberSearch), 300);
    return () => clearTimeout(t);
  }, [memberSearch]);

  async function loadTenant(tenantId: string) {
    setLoadingTenant(true);
    try {
      const [t, m, p] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenantId).single(),
        supabase.from('tenant_memberships').select('*').eq('tenant_id', tenantId),
        supabase.from('profiles').select('id,email,full_name').limit(500),
      ]);
      if (t.error) throw t.error;
      const tenant: Tenant = t.data;
      setName(tenant.name);
      setAitanCodes(tenant.aitan_codes ?? []);
      if (tenant.is_demo) setStatus('demo');
      else if (tenant.trial_ends_at && new Date(tenant.trial_ends_at) > new Date()) {
        setStatus('trial');
        const days = Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000);
        setTrialDays(days);
      } else {
        setStatus('active');
      }
      const profiles = (p.data ?? []) as Pick<Profile, 'id' | 'email' | 'full_name'>[];
      const loadedMembers: MemberEntry[] = (m.data ?? []).map(mem => {
        const prof = profiles.find(pr => pr.id === mem.user_id);
        return {
          userId: mem.user_id,
          email: prof?.email ?? mem.user_id,
          name: prof?.full_name ?? '',
          role: mem.role as MemberEntry['role'],
        };
      });
      setMembers(loadedMembers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant');
    } finally {
      setLoadingTenant(false);
    }
  }

  async function searchProfiles(q: string) {
    setSearching(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id,email,full_name')
        .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
        .limit(20);
      const existing = members.map(m => m.userId);
      setMemberResults((data ?? []).filter((p: { id: string }) => !existing.includes(p.id)) as Profile[]);
    } finally {
      setSearching(false);
    }
  }

  function addMember(profile: Profile) {
    setMembers(prev => [...prev, {
      userId: profile.id,
      email: profile.email,
      name: profile.full_name,
      role: 'member',
    }]);
    setMemberSearch('');
    setMemberResults([]);
  }

  function removeMember(userId: string) {
    setMembers(prev => prev.filter(m => m.userId !== userId));
  }

  function addAitanCode() {
    const code = aitanInput.trim().replace(/\D/g, '');
    if (!code) return;
    if (aitanCodes.includes(code)) return;
    setAitanCodes(prev => [...prev, code]);
    setAitanInput('');
  }

  async function save() {
    if (!name.trim()) { setError('Tenant name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const now = new Date();
      const trial_ends_at = status === 'trial'
        ? new Date(now.getTime() + trialDays * 86400000).toISOString()
        : null;
      const is_demo = status === 'demo';

      if (isEdit && id) {
        const { error: updateErr } = await supabase.from('tenants').update({
          name: name.trim(), is_demo, trial_ends_at, aitan_codes: aitanCodes,
        }).eq('id', id);
        if (updateErr) throw updateErr;

        const { data: existing } = await supabase.from('tenant_memberships').select('*').eq('tenant_id', id);
        const existingUserIds = (existing ?? []).map((m: { user_id: string }) => m.user_id);
        const newUserIds = members.map(m => m.userId);

        const toDelete = existingUserIds.filter((uid: string) => !newUserIds.includes(uid));
        const toAdd = members.filter(m => !existingUserIds.includes(m.userId));
        const toUpdate = members.filter(m => {
          const ex = (existing ?? []).find((e: { user_id: string; role: string }) => e.user_id === m.userId);
          return ex && ex.role !== m.role;
        });

        await Promise.all([
          ...toDelete.map((uid: string) => supabase.from('tenant_memberships').delete().eq('tenant_id', id).eq('user_id', uid)),
          ...toAdd.map(m => supabase.from('tenant_memberships').insert({ tenant_id: id, user_id: m.userId, role: m.role })),
          ...toUpdate.map(m => supabase.from('tenant_memberships').update({ role: m.role }).eq('tenant_id', id).eq('user_id', m.userId)),
        ]);
      } else {
        const { data: tenantData, error: insertErr } = await supabase.from('tenants').insert({
          name: name.trim(), is_demo, trial_ends_at, aitan_codes: aitanCodes,
        }).select().single();
        if (insertErr) throw insertErr;
        const tenantId = tenantData.id;

        if (members.length > 0) {
          const { error: memErr } = await supabase.from('tenant_memberships').insert(
            members.map(m => ({ tenant_id: tenantId, user_id: m.userId, role: m.role }))
          );
          if (memErr) throw memErr;
        }
      }

      navigate('/superadmin/tenants-list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loadingTenant) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading tenant…</div>
  );

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{isEdit ? 'Edit Tenant' : 'Add Tenant'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{isEdit ? 'Update workspace configuration' : 'Create a new workspace tenant'}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="card px-6 py-5 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tenant Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Acme Travel Agency"
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Status</label>
          <div className="flex gap-2">
            {(['active', 'trial', 'demo'] as TenantStatus[]).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${status === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-surface-border hover:border-brand-300'}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {status === 'trial' && (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-slate-600">Trial duration:</label>
              <input type="number" value={trialDays} onChange={e => setTrialDays(Number(e.target.value))}
                min={1} max={365}
                className="w-20 px-3 py-1.5 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="text-xs text-slate-400">days</span>
            </div>
          )}
        </div>

        {/* AITAN Codes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">AITAN Codes</label>
          <p className="text-xs text-slate-400 mb-2">8–10 digit IATA numeric codes for airfile routing</p>
          <div className="flex gap-2 mb-2">
            <input value={aitanInput} onChange={e => setAitanInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && addAitanCode()}
              placeholder="e.g. 8455792116"
              className="flex-1 px-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button onClick={addAitanCode} className="btn-secondary text-xs py-2">
              <Plus size={13} /> Add
            </button>
          </div>
          {aitanCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {aitanCodes.map(code => (
                <span key={code} className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-full font-mono">
                  {code}
                  <button onClick={() => setAitanCodes(prev => prev.filter(c => c !== code))}
                    className="text-slate-400 hover:text-slate-700"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Members */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Members</label>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
              placeholder="Search by name or email to add members…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          {/* Search results */}
          {memberResults.length > 0 && (
            <div className="border border-surface-border rounded-lg bg-white shadow-panel mb-2 max-h-40 overflow-y-auto">
              {searching && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
              {memberResults.map(p => (
                <button key={p.id} onClick={() => addMember(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-surface-subtle flex items-center gap-2 text-sm">
                  <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700">
                    {(p.full_name || p.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-800">{p.full_name || '—'}</p>
                    <p className="text-[10px] text-slate-400">{p.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Member list */}
          {members.length > 0 && (
            <div className="space-y-1.5">
              {members.map(m => (
                <div key={m.userId} className="flex items-center gap-2 px-3 py-2 bg-surface-subtle rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 shrink-0">
                    {(m.name || m.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{m.name || m.email}</p>
                    {m.name && <p className="text-[10px] text-slate-400 truncate">{m.email}</p>}
                  </div>
                  <select value={m.role}
                    onChange={e => setMembers(prev => prev.map(mem => mem.userId === m.userId ? { ...mem, role: e.target.value as MemberEntry['role'] } : mem))}
                    className="text-xs border border-surface-border rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500">
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                  <button onClick={() => removeMember(m.userId)} className="text-slate-400 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={() => navigate('/superadmin/tenants-list')} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Tenant'}
        </button>
      </div>
    </div>
  );
}
