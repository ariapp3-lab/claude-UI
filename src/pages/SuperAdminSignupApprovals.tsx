import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/superadmin';

type SignupStatus = 'pending' | 'approved' | 'rejected';

export default function SuperAdminSignupApprovals() {
  const [requests, setRequests] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // Issue 4 fix: rejection reason dialog
  const [rejectDialog, setRejectDialog] = useState<{ id: string; name: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('signup_status', ['pending', 'approved', 'rejected'])
        .order('signup_requested_at', { ascending: false });
      if (error) throw error;
      setRequests(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signup requests');
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(id: string, status: SignupStatus, reason?: string) {
    setActing(id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const update: Record<string, unknown> = {
        signup_status: status,
        signup_reviewed_at: new Date().toISOString(),
        signup_reviewed_by: user?.id ?? null,
        signup_rejection_reason: status === 'rejected' ? (reason?.trim() || 'Rejected by admin') : null,
      };
      const { error } = await supabase.from('profiles').update(update).eq('id', id);
      if (error) throw error;
      setRequests(prev => prev.map(r => r.id === id ? { ...r, ...update } as Profile : r));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActing(null);
    }
  }

  function openRejectDialog(profile: Profile) {
    setRejectDialog({ id: profile.id, name: profile.full_name || profile.email || profile.id });
    setRejectionReason('');
  }

  async function confirmReject() {
    if (!rejectDialog) return;
    await setStatus(rejectDialog.id, 'rejected', rejectionReason);
    setRejectDialog(null);
    setRejectionReason('');
  }

  const pending = requests.filter(r => r.signup_status === 'pending');
  const approved = requests.filter(r => r.signup_status === 'approved');
  const rejected = requests.filter(r => r.signup_status === 'rejected');

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading signup requests…</div>;
  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Signup Approvals</h1>
        <p className="text-sm text-slate-500 mt-0.5">Review and approve or reject pending user registrations</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pending', value: pending.length, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Approved', value: approved.length, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Rejected', value: rejected.length, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(c => (
          <div key={c.label} className="card px-4 py-4">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${c.bg}`}>
              <c.icon size={17} className={c.color} />
            </div>
            <p className="text-2xl font-bold text-slate-900">{c.value}</p>
            <p className="text-xs text-slate-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Pending section */}
      {pending.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border bg-amber-50">
            <h2 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <Clock size={14} /> Pending Approval ({pending.length})
            </h2>
          </div>
          <div className="divide-y divide-surface-border">
            {pending.map(r => (
              <div key={r.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                    {(r.full_name || r.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{r.full_name || '—'}</p>
                    <p className="text-xs text-slate-400">{r.email}</p>
                    {r.signup_requested_at && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Requested {new Date(r.signup_requested_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStatus(r.id, 'approved')}
                    disabled={acting === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
                    <CheckCircle size={13} />
                    {acting === r.id ? '…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => openRejectDialog(r)}
                    disabled={acting === r.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg border border-red-200 transition-colors disabled:opacity-50">
                    <XCircle size={13} />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved section */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-slate-800">Approved ({approved.length})</h2>
        </div>
        <div className="divide-y divide-surface-border">
          {approved.slice(0, 10).map(r => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{r.full_name || r.email}</p>
                <p className="text-xs text-slate-400">{r.signup_reviewed_at ? `Approved ${new Date(r.signup_reviewed_at).toLocaleDateString()}` : ''}</p>
              </div>
              <span className="badge bg-emerald-50 text-emerald-700">Approved</span>
            </div>
          ))}
          {approved.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No approved signups.</p>}
          {approved.length > 10 && (
            <p className="px-5 py-3 text-xs text-slate-400">…and {approved.length - 10} more</p>
          )}
        </div>
      </div>

      {/* Rejected section */}
      {rejected.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-slate-800">Rejected ({rejected.length})</h2>
          </div>
          <div className="divide-y divide-surface-border">
            {rejected.map(r => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{r.full_name || r.email}</p>
                  <p className="text-xs text-red-500 mt-0.5">{r.signup_rejection_reason}</p>
                  <p className="text-[10px] text-slate-400">{r.signup_reviewed_at ? new Date(r.signup_reviewed_at).toLocaleDateString() : ''}</p>
                </div>
                <button
                  onClick={() => setStatus(r.id, 'approved')}
                  disabled={acting === r.id}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-50">
                  Approve instead
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issue 4 fix: Rejection reason dialog */}
      {rejectDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">Reject Signup</h2>
              <button onClick={() => setRejectDialog(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Rejecting <strong>{rejectDialog.name}</strong>. Provide a reason (optional, visible to admins):
            </p>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="e.g. Duplicate account, incomplete information, not a valid business…"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRejectDialog(null)} className="btn-secondary text-xs py-1.5">Cancel</button>
              <button onClick={confirmReject}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors">
                <XCircle size={13} /> Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
