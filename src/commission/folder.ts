/**
 * Reading AIR files straight out of a folder.
 *
 * Three thousand documents a week do not arrive one drag at a time. Two routes,
 * both without a server:
 *
 *  - The File System Access API, where the browser supports it (Chrome and Edge
 *    on Windows). The folder is chosen once and the handle is kept, so the app
 *    reconnects to the same folder on every visit and re-reads it on demand.
 *  - A directory input everywhere else. It reads the whole folder in one pick,
 *    but has to be re-picked each time.
 *
 * Files are recognised by their contents, not their extension. A Server Pro
 * capture writes .M07; other feeds write .air, .txt, or no extension at all,
 * and filtering on the name would silently drop a week's work.
 */

import type { LoadedFile } from './data';

export interface FolderScan {
  readonly name: string;
  readonly files: LoadedFile[];
  /** Files that were read but are not AIR records. */
  readonly skipped: number;
  /** Files the browser refused or that could not be decoded. */
  readonly unreadable: string[];
}

export type Progress = (done: number, total: number, current?: string) => void;

/** A real handle, kept across visits — the difference between picking and connecting. */
export function supportsFolderConnection(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * An AIR record opens with a block header and carries an airline element. Two
 * independent markers, because a stray text file in the folder should be
 * skipped rather than parsed into a ticket with no coupons.
 */
export function looksLikeAir(text: string): boolean {
  const head = text.slice(0, 4000);
  return /^AIR-|^AMD\s/m.test(head) && /^[A-Z]-|^T-E?\d{3}/m.test(head);
}

const SIZE_LIMIT = 512 * 1024;   // an AIR record is kilobytes; anything larger is not one

/**
 * How many files to have in flight at once.
 *
 * Was a hundred. A browser reading a hundred files concurrently off a local
 * disk — and especially off a page opened from disk rather than served — is a
 * lot of simultaneous I/O for no gain: the work is bounded by the disk, not by
 * how many requests are outstanding. Eight keeps it moving without a burst
 * large enough to stall the tab.
 */
const CONCURRENCY = 8;

/** Yield to the browser this often, so the page never stops painting. */
const YIELD_EVERY = 25;

async function readEntries(
  entries: { name: string; read: () => Promise<string> }[],
  onProgress?: Progress,
): Promise<Omit<FolderScan, 'name'>> {
  const files: LoadedFile[] = [];
  const unreadable: string[] = [];
  let skipped = 0;
  let done = 0;

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const slice = entries.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (e) => {
      try {
        const text = await e.read();
        if (looksLikeAir(text)) files.push({ name: e.name, text, bundled: false });
        else skipped++;
      } catch (err) {
        // One unreadable file must never end the run — it is reported by name,
        // which is also what identifies the file if a run stops on it.
        unreadable.push(`${e.name}: ${(err as Error).message || 'could not be read'}`);
      }
      done++;
    }));

    // The name of the file in hand, so a run that stops says where it stopped.
    onProgress?.(done, entries.length, slice[slice.length - 1]?.name);
    if (i % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return { files, skipped, unreadable };
}

/** Walk a directory handle, one level deep plus subfolders. */
async function collect(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): Promise<{ name: string; read: () => Promise<string> }[]> {
  const out: { name: string; read: () => Promise<string> }[] = [];
  for await (const [name, handle] of (dir as unknown as {
    entries(): AsyncIterable<[string, FileSystemHandle]>;
  }).entries()) {
    if (handle.kind === 'file') {
      out.push({
        name: prefix + name,
        read: async () => {
          const file = await (handle as FileSystemFileHandle).getFile();
          if (file.size > SIZE_LIMIT) return '';
          return file.text();
        },
      });
    } else if (handle.kind === 'directory') {
      out.push(...await collect(handle as FileSystemDirectoryHandle, `${prefix}${name}/`));
    }
  }
  return out;
}

export async function scanDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  onProgress?: Progress,
): Promise<FolderScan> {
  const entries = await collect(dir);
  return { name: dir.name, ...(await readEntries(entries, onProgress)) };
}

/** Ask for a folder and keep the handle for next time. */
export async function connectFolder(onProgress?: Progress): Promise<FolderScan | null> {
  const picker = (globalThis as {
    showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return null;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await picker({ id: 'airfiles', mode: 'read' });
  } catch {
    return null;                                   // the person cancelled
  }
  await rememberHandle(dir);
  return scanDirectoryHandle(dir, onProgress);
}

/** The directory input: every browser, but re-picked each time. */
export async function readPickedFiles(
  list: FileList | null,
  onProgress?: Progress,
): Promise<FolderScan> {
  const all = Array.from(list ?? []);
  const entries = all.map((f) => ({
    name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    read: async () => (f.size > SIZE_LIMIT ? '' : f.text()),
  }));
  const folder = (all[0] as (File & { webkitRelativePath?: string }) | undefined)
    ?.webkitRelativePath?.split('/')[0];
  return { name: folder ?? 'selected files', ...(await readEntries(entries, onProgress)) };
}

// ---------------------------------------------------------------------------
// Keeping the connection
// ---------------------------------------------------------------------------

const DB = 'commission-desk';
const STORE = 'folders';
const KEY = 'airfiles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rememberHandle(dir: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dir, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* private mode, or storage refused — the folder still works today */ }
}

/**
 * The folder from last time, if the browser will still grant it.
 *
 * Permission is asked for again rather than assumed: a stored handle is a
 * bookmark, not a standing grant, and re-prompting is the browser's design.
 */
export async function reconnectFolder(
  onProgress?: Progress,
): Promise<FolderScan | null> {
  try {
    const db = await openDb();
    const dir = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!dir) return null;

    const perm = dir as unknown as {
      queryPermission(d: { mode: string }): Promise<PermissionState>;
      requestPermission(d: { mode: string }): Promise<PermissionState>;
    };
    let state = await perm.queryPermission({ mode: 'read' });
    if (state === 'prompt') state = await perm.requestPermission({ mode: 'read' });
    if (state !== 'granted') return null;

    return scanDirectoryHandle(dir, onProgress);
  } catch {
    return null;
  }
}

export async function hasRememberedFolder(): Promise<boolean> {
  try {
    const db = await openDb();
    const has = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(Boolean(req.result));
      req.onerror = () => resolve(false);
    });
    db.close();
    return has;
  } catch {
    return false;
  }
}
