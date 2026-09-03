import {
  createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { AirPassenger } from '@commission/parsers';
import { parseAmadeusAir } from '@commission/parsers';
import type { LoadedFile } from './data';
import { BUNDLED_FILES } from './data';

/**
 * The batch of documents, parsed once and shared by every page.
 *
 * Two things here exist because of a browser, not a design preference.
 *
 * Source text is dropped as soon as a file is parsed. Holding the text of a few
 * thousand records alongside the tickets parsed out of them is a second copy of
 * the whole week for no benefit — and it was being held four times over, once
 * per page, because each page kept its own file state.
 *
 * Parsing yields to the event loop every hundred files. A few thousand records
 * parse in well under a second, but doing it in one synchronous block while the
 * page is also rendering is what turns a slow load into a tab that stops
 * responding.
 */
export interface Batch {
  readonly passengers: readonly AirPassenger[];
  readonly source: string;
  readonly fileCount: number;
  readonly skipped: number;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly loading: boolean;
  readonly progress: { done: number; total: number } | null;
  load(files: readonly LoadedFile[], source?: string): Promise<void>;
}

const Ctx = createContext<Batch | null>(null);

interface State {
  passengers: AirPassenger[];
  source: string;
  fileCount: number;
  skipped: number;
  failures: string[];
  warnings: string[];
}

const EMPTY: State = {
  passengers: [], source: 'bundled samples', fileCount: 0,
  skipped: 0, failures: [], warnings: [],
};

async function parseAll(
  files: readonly LoadedFile[],
  source: string,
  onProgress: (done: number, total: number) => void,
): Promise<State> {
  const passengers: AirPassenger[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  const CHUNK = 100;
  for (let i = 0; i < files.length; i += CHUNK) {
    for (const file of files.slice(i, i + CHUNK)) {
      try {
        const parsed = parseAmadeusAir(file.text);
        if (parsed.tickets.length === 0) { skipped++; continue; }
        passengers.push(...parsed.passengers);
        // Only the first few files' notes are worth surfacing; a thousand
        // copies of the same warning is noise, not information.
        for (const w of parsed.warnings) {
          const line = `${file.name}: ${w}`;
          if (warnings.length < 200) warnings.push(line);
        }
      } catch (e) {
        failures.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    onProgress(Math.min(i + CHUNK, files.length), files.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  return { passengers, source, fileCount: files.length, skipped, failures, warnings };
}

export function BatchProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const seeded = useRef(false);

  // The bundled samples parse synchronously on first render so the app opens on
  // real work rather than an empty shell.
  const initial = useMemo(() => {
    if (seeded.current) return null;
    seeded.current = true;
    const passengers: AirPassenger[] = [];
    for (const f of BUNDLED_FILES) {
      try { passengers.push(...parseAmadeusAir(f.text).passengers); } catch { /* sample */ }
    }
    return { ...EMPTY, passengers, fileCount: BUNDLED_FILES.length };
  }, []);

  const current = state.passengers.length > 0 || state.fileCount > 0
    ? state
    : (initial ?? EMPTY);

  const load = useCallback(async (files: readonly LoadedFile[], source = 'selected files') => {
    setProgress({ done: 0, total: files.length });
    const next = await parseAll(files, source, (done, total) => setProgress({ done, total }));
    setState(next);
    setProgress(null);
  }, []);

  const value = useMemo<Batch>(() => ({
    passengers: current.passengers,
    source: current.source,
    fileCount: current.fileCount,
    skipped: current.skipped,
    failures: current.failures,
    warnings: current.warnings,
    loading: progress !== null,
    progress,
    load,
  }), [current, progress, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBatch(): Batch {
  const b = useContext(Ctx);
  if (!b) throw new Error('useBatch must be used inside a BatchProvider');
  return b;
}
