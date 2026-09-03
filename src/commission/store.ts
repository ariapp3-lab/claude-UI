/**
 * Where the configuration is kept.
 *
 * The model and the rule compiler live in the engine, free of any browser, so
 * they can be tested without one. This file is only storage: localStorage for
 * the configuration, IndexedDB for the signed letters, and a working seed
 * whenever either refuses. Everything stays on this machine.
 */

import {
  type CarrierContract, type Config, type ContractFile, type StoredConsolidator,
  DEFAULT_TENANT, carrierRulesFor, compileContract, compileSubAgentRules, newId,
  officesFor, resolveContracts, seedConfig,
} from '../../packages/engine/contracts/config';

export type { CarrierContract, Config, ContractFile, StoredConsolidator };
export {
  DEFAULT_TENANT, carrierRulesFor, compileContract, compileSubAgentRules, newId,
  officesFor, resolveContracts, seedConfig,
};

const KEY = 'commission-desk.config.v1';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedConfig();
    const parsed = JSON.parse(raw) as Config;
    if (parsed?.version !== 1 || !Array.isArray(parsed.consolidators)) return seedConfig();
    return migrate(parsed);
  } catch {
    // Private browsing, cleared storage, a half-written value — the seed is a
    // working configuration, so falling back to it always leaves a usable app.
    return seedConfig();
  }
}

/**
 * Bring a stored configuration up to the current shape.
 *
 * Contract lookup is scoped by tenant, and a configuration saved before that
 * existed carries no tenant at all — which would resolve to nothing and read,
 * from the outside, exactly like an agency whose contracts had vanished. So an
 * office with no tenant is adopted by the single-agency default rather than
 * left unreachable.
 */
function migrate(config: Config): Config {
  const needsTenant = config.consolidators.some((c) => !c.tenantId);
  if (!needsTenant) return config;
  return {
    ...config,
    consolidators: config.consolidators.map((c) =>
      c.tenantId ? c : { ...c, tenantId: DEFAULT_TENANT }),
  };
}

export function saveConfig(config: Config): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function resetConfig(): Config {
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  return seedConfig();
}


// ---------------------------------------------------------------------------
// Contract documents
// ---------------------------------------------------------------------------

/**
 * The signed letter itself, kept beside the rules read out of it.
 *
 * A rate table without the paper it came from is an assertion; with it, anyone
 * can check the reading. Files live in IndexedDB rather than localStorage
 * because a scanned contract is megabytes, and they never leave this browser.
 */
const FILE_DB = 'commission-desk-files';
const FILE_STORE = 'contracts';

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putContractFile(id: string, file: File): Promise<boolean> {
  try {
    const db = await openFileDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).put(file, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function getContractFile(id: string): Promise<File | null> {
  try {
    const db = await openFileDb();
    const file = await new Promise<File | undefined>((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, 'readonly');
      const req = tx.objectStore(FILE_STORE).get(id);
      req.onsuccess = () => resolve(req.result as File | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return file ?? null;
  } catch {
    return null;
  }
}

export async function deleteContractFile(id: string): Promise<void> {
  try {
    const db = await openFileDb();
    await new Promise((resolve) => {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  } catch { /* already gone */ }
}
