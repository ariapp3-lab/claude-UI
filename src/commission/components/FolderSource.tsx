import { useEffect, useState } from 'react';
import { FolderOpen, FolderSync, RefreshCw, Upload } from 'lucide-react';
import type { LoadedFile } from '../data';
import {
  connectFolder, hasRememberedFolder, readPickedFiles, reconnectFolder,
  supportsFolderConnection, type FolderScan,
} from '../folder';

/**
 * Where the documents come from.
 *
 * A folder of a few thousand files is the normal case, so it leads. Individual
 * uploads stay as an escape hatch, and the bundled samples remain until
 * something real replaces them.
 */
export function FolderSource({
  onFiles, count,
}: { onFiles(files: LoadedFile[], scan: FolderScan | null): void; count: number }) {
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [remembered, setRemembered] = useState(false);
  const canConnect = supportsFolderConnection();

  useEffect(() => { void hasRememberedFolder().then(setRemembered); }, []);

  async function run(fn: () => Promise<FolderScan | null>) {
    setBusy({ done: 0, total: 0 });
    try {
      const result = await fn();
      if (result) { setScan(result); onFiles(result.files, result); }
    } finally {
      setBusy(null);
    }
  }

  const progress = (done: number, total: number) => setBusy({ done, total });

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canConnect && (
          <button className="btn-primary" disabled={!!busy}
                  onClick={() => void run(() => connectFolder(progress))}>
            <FolderOpen size={14} /> Connect a folder
          </button>
        )}
        {canConnect && remembered && (
          <button className="btn-secondary" disabled={!!busy}
                  onClick={() => void run(() => reconnectFolder(progress))}>
            <FolderSync size={14} /> Reopen last folder
          </button>
        )}
        <label className={`btn-secondary ${busy ? 'opacity-50' : 'cursor-pointer'}`}>
          <Upload size={14} /> {canConnect ? 'Or choose a folder' : 'Choose a folder'}
          {/* Any extension: a Server Pro capture writes .M07, other feeds do not. */}
          <input type="file" className="hidden" multiple
                 // @ts-expect-error — directory selection is not in the DOM types
                 webkitdirectory="" directory=""
                 onChange={(e) => void run(() => readPickedFiles(e.target.files, progress))} />
        </label>
        {scan && (
          <button className="btn-secondary" disabled={!!busy}
                  onClick={() => void run(() => reconnectFolder(progress))}>
            <RefreshCw size={14} /> Re-read
          </button>
        )}
      </div>

      {busy && (
        <div>
          <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
            <div className="h-full bg-brand-600 transition-[width] duration-150"
                 style={{ width: busy.total ? `${(busy.done / busy.total) * 100}%` : '8%' }} />
          </div>
          <p className="text-[12px] text-slate-500 mt-1.5 font-mono tabular-nums">
            {busy.total
              ? `reading ${busy.done.toLocaleString()} of ${busy.total.toLocaleString()} files`
              : 'opening the folder…'}
          </p>
        </div>
      )}

      {scan && !busy && (
        <p className="text-[12.5px] text-slate-600">
          <span className="font-mono text-slate-900">{scan.name}</span>
          {' — '}
          <b className="font-semibold">{scan.files.length.toLocaleString()}</b> AIR records read
          {scan.skipped > 0 && <span className="text-slate-400">
            {' · '}{scan.skipped.toLocaleString()} file{scan.skipped === 1 ? '' : 's'} skipped, not AIR records
          </span>}
          {scan.unreadable.length > 0 && <span className="text-amber-700">
            {' · '}{scan.unreadable.length} could not be read
          </span>}
        </p>
      )}

      {!scan && !busy && (
        <p className="text-[12.5px] text-slate-500 max-w-[74ch]">
          {canConnect
            ? 'Point it at the folder your capture writes to. The folder is remembered, so it reopens next time and can be re-read on demand. Files are recognised by their contents — .M07, .air, or no extension at all.'
            : 'Choose the folder your capture writes to. This browser cannot keep a folder connected, so it has to be chosen each time — Chrome or Edge can remember it.'}
          {' '}Currently showing {count} bundled sample{count === 1 ? '' : 's'}. Nothing leaves this machine.
        </p>
      )}
    </div>
  );
}
