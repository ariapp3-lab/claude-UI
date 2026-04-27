import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Check } from 'lucide-react';

interface LogEntry {
  event_message: string;
  method: string;
  path: string;
  status_code: number;
  timestamp: number;
  id: string;
  ip?: string;
  requestId?: string;
  fullUrl?: string;
  userAgent?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <button onClick={copy} className="text-slate-400 hover:text-brand-600 transition-colors">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 border-b border-surface-border last:border-0">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-1">{label}</p>
      <div className="flex items-start gap-2">
        <p className="text-sm text-slate-800 break-all flex-1 font-mono">{value || '—'}</p>
        {value && <CopyButton text={value} />}
      </div>
    </div>
  );
}

function statusColor(code: number) {
  if (code >= 500) return 'bg-red-50 text-red-700';
  if (code >= 400) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

export default function SuperAdminRequestDetail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [log, setLog] = useState<LogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = searchParams.get('data');
    if (!raw) { navigate('/superadmin/logs-analytics'); return; }
    try {
      setLog(JSON.parse(decodeURIComponent(raw)));
    } catch {
      setError('Invalid request data. Please go back and try again.');
    }
  }, []);

  if (error) return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="text-red-500 text-sm">{error}</div>
      <button onClick={() => navigate('/superadmin/logs-analytics')} className="mt-4 text-xs text-brand-600 hover:underline">
        ← Back to Logs
      </button>
    </div>
  );

  if (!log) return null;

  // Parse query params from fullUrl
  let queryParams: { key: string; value: string }[] = [];
  try {
    const url = new URL(log.fullUrl || log.path, 'https://example.com');
    queryParams = [...url.searchParams.entries()].map(([key, value]) => ({ key, value }));
  } catch { /* not parseable */ }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/superadmin/logs-analytics')} className="text-slate-400 hover:text-slate-600">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Request Detail</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {new Date(log.timestamp * 1000).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Status + method header */}
      <div className="flex items-center gap-3">
        <span className={`badge text-sm font-mono font-semibold px-3 py-1 ${statusColor(log.status_code)}`}>
          {log.status_code}
        </span>
        <span className="text-base font-mono font-bold text-slate-800">{log.method}</span>
        <span className="text-sm text-slate-500 font-mono truncate">{log.path}</span>
      </div>

      {/* Fields */}
      <div className="card px-5 divide-y divide-surface-border">
        <Field label="Method" value={log.method} />
        <Field label="Status Code" value={String(log.status_code)} />
        <Field label="IP Address" value={log.ip ?? '—'} />
        <Field label="Request ID" value={log.requestId ?? log.id} />
        <Field label="Full URL" value={log.fullUrl ?? log.path} />
        <Field label="User Agent" value={log.userAgent ?? '—'} />
      </div>

      {/* Query parameters */}
      {queryParams.length > 0 && (
        <div className="card px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Query Parameters</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="pb-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Key</th>
                <th className="pb-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {queryParams.map((p, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4 text-xs font-mono text-slate-700">{p.key}</td>
                  <td className="py-2 text-xs font-mono text-slate-600">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Raw event message */}
      <div className="card px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-800">Raw Event Message</h2>
          <CopyButton text={log.event_message} />
        </div>
        <pre className="bg-surface-muted rounded-lg px-4 py-3 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre-wrap break-all">
          {log.event_message}
        </pre>
      </div>
    </div>
  );
}
