import { useEffect, useState } from 'react';
import { FolderOpen, FolderSync, RefreshCw, Upload } from 'lucide-react';
import { useBatch } from '../batch';
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
export function FolderSource({ count }: { count: number }) {
  const batch = useBatch();
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [reading, setReading] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [remembered, setRemembered] = useState(false);
  const canConnect = supportsFolderConnection();

  useEffect(() => { void hasRememberedFolder().then(setRemembered); }, []);

  // Reading and parsing are two passes over the same files, and both are
  // reported: a stalled progress bar with no explanation is what a crash looks
  // like from the outside.
  const busy = reading ?? batch.progress;
  const phase = reading ? 'reading' : batch.progress ? 'parsing' : null;

  async function run(fn: () => Promise<FolderScan | null>) {
    setReading({ done: 0, total: 0 });
    try {
      const result = await fn();
      setReading(null);
      if (result) {
        setScan(result);
        // Hand over the files and let go of them here: the batch keeps the
        // tickets, not the text.
        await batch.load(result.files, result.name);
      }
    } finally {
      setReading(null);
    }
  }

  const progress = (done: number, total: number, current?: string) =>
    setReading({ done, total, current });

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
              ? `${phase} ${busy.done.toLocaleString()} of ${busy.total.toLocaleString()} files`
              : 'opening the folder…'}
            {reading?.current && (
              <span className="text-slate-400"> · {reading.current}</span>
            )}
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

      {scan && !busy && scan.unreadable.length > 0 && (
        <ul className="text-[11.5px] text-amber-700 font-mono space-y-0.5 max-h-24 overflow-y-auto">
          {scan.unreadable.slice(0, 20).map((u, i) => <li key={i}>{u}</li>)}
        </ul>
      )}

      {/* The Windows picker lists folders only, so a folder of loose files looks
          empty and reads as a failure. Saying so up front costs one line. */}
      {!scan && !busy && (
        <p className="text-[12.5px] text-slate-600 max-w-[74ch] bg-surface-subtle border border-surface-border rounded-lg px-3 py-2">
          <b className="font-semibold">The picker will look empty — that is normal.</b>{' '}
          It lists folders, not files. Open the folder so its name shows in the
          <span className="font-mono text-[11.5px]"> Folder:</span> box at the bottom,
          then click <b className="font-semibold">Select Folder</b>.
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
