import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ExternalLink, RefreshCw } from 'lucide-react';
import { supabase, EDGE_BASE } from '../lib/supabase';

type TimeRange = '1h' | '6h' | '24h';
type MethodFilter = 'All' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type StatusFilter = 'All' | '2xx' | '4xx' | '5xx';

interface LogEntry {
  event_message: string;
  method: string;
  path: string;
  status_code: number;
  timestamp: number;
  id: string;
}

interface ParsedLog extends LogEntry {
  ip: string;
  requestId: string;
  fullUrl: string;
  userAgent: string;
}

function parseLog(entry: LogEntry): ParsedLog {
  // format: "METHOD | STATUS | IP | REQUEST_ID | FULL_URL | USER_AGENT"
  const parts = entry.event_message.split(' | ');
  return {
    ...entry,
    ip: parts[2] ?? '—',
    requestId: parts[3] ?? '—',
    fullUrl: parts[4] ?? entry.path,
    userAgent: parts[5] ?? '—',
  };
}

function statusColor(code: number) {
  if (code >= 500) return 'bg-red-50 text-red-700';
  if (code >= 400) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

export default function SuperAdminLogsAnalytics() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ParsedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  useEffect(() => { fetchLogs(); }, [timeRange]);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const now = new Date();
      const hours = timeRange === '1h' ? 1 : timeRange === '6h' ? 6 : 24;
      const isoStart = new Date(now.getTime() - hours * 3600000).toISOString();
      const isoEnd = now.toISOString();

      const res = await fetch(`${EDGE_BASE}/superadmin-logs-analytics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ iso_start: isoStart, iso_end: isoEnd }),
      });

      const data = await res.json();

      if (data.setup_required) {
        setSetupRequired(true);
        setLogs([]);
        return;
      }

      setSetupRequired(false);
      const rawLogs: LogEntry[] = data.logs?.api ?? [];
      setLogs(rawLogs.map(parseLog));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }

  const filtered = logs.filter(l => {
    const q = search.toLowerCase();
    const matchesSearch = !q || l.path.toLowerCase().includes(q) || l.event_message.toLowerCase().includes(q);
    const matchesMethod = methodFilter === 'All' || l.method === methodFilter;
    const matchesStatus = statusFilter === 'All' ||
      (statusFilter === '2xx' && l.status_code >= 200 && l.status_code < 300) ||
      (statusFilter === '4xx' && l.status_code >= 400 && l.status_code < 500) ||
      (statusFilter === '5xx' && l.status_code >= 500);
    return matchesSearch && matchesMethod && matchesStatus;
  });

  function openDetail(log: ParsedLog) {
    navigate(`/superadmin/request-detail?data=${encodeURIComponent(JSON.stringify(log))}`);
  }

  // Issue 7 fix: detailed setup guidance
  if (setupRequired) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Logs & Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">API request logs from Supabase Management API</p>
        </div>

        <div className="card px-6 py-6 border-amber-200 border-2">
          <h2 className="text-base font-bold text-amber-800 mb-2">Setup Required</h2>
          <p className="text-sm text-slate-600 mb-4">
            The <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">ACCESS_TOKEN</code> secret
            is not configured. Follow these steps to enable logs:
          </p>
          <ol className="space-y-3 text-sm text-slate-700 list-decimal list-inside">
            <li>
              Get a personal access token from your Supabase account:
              <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline text-xs font-medium">
                Open token page <ExternalLink size={11} />
              </a>
            </li>
            <li>
              In your Supabase project, go to{' '}
              <strong>Project Settings → Edge Functions → Secrets</strong>
            </li>
            <li>
              Add a new secret:
              <div className="mt-1 bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-xs text-slate-700">
                Name: <span className="font-bold">ACCESS_TOKEN</span><br />
                Value: <span className="text-slate-400">your personal access token</span>
              </div>
            </li>
            <li>Redeploy the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">superadmin-logs-analytics</code> edge function</li>
            <li>Return to this page and refresh</li>
          </ol>
          <div className="mt-5 flex gap-2">
            <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noopener noreferrer"
              className="btn-primary text-sm">
              Get Access Token <ExternalLink size={13} />
            </a>
            <button onClick={fetchLogs} className="btn-secondary text-sm">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Logs & Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? 'Fetching logs…' : `${filtered.length} of ${logs.length} requests`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Time range */}
          <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
            {(['1h', '6h', '24h'] as TimeRange[]).map(t => (
              <button key={t} onClick={() => setTimeRange(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${timeRange === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Last {t}
              </button>
            ))}
          </div>
          <button onClick={fetchLogs} disabled={loading} className="btn-secondary text-xs py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search path or message…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(['All', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as MethodFilter[]).map(m => (
            <button key={m} onClick={() => setMethodFilter(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${methodFilter === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5">
          {(['All', '2xx', '4xx', '5xx'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Log table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Fetching logs…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-subtle border-b border-surface-border">
                  {['Time', 'Method', 'Status', 'Path', 'IP'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {filtered.map((log, i) => (
                  <tr key={i} onClick={() => openDetail(log)}
                    className="hover:bg-surface-subtle cursor-pointer transition-colors">
                    <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap font-mono">
                      {new Date(log.timestamp * 1000).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono font-semibold text-slate-700">{log.method}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge text-xs font-mono ${statusColor(log.status_code)}`}>{log.status_code}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 font-mono max-w-xs truncate">{log.path}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{log.ip}</td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 text-sm">No log entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400">Max 200 entries · click a row for full details · max window 24h</p>
    </div>
  );
}
