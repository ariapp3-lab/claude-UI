/**
 * Contracts as data a person can edit, not code a developer has to.
 *
 * Until now the EL AL letter lived in a TypeScript file. That is fine for one
 * contract read by the person who wrote the reader; it is useless to an agency
 * that signs a second consolidator in March. So the whole configuration —
 * consolidators, carrier contracts, rate tables, retentions — is stored, edited
 * in the app, and compiled to engine rules on the way in.
 *
 * The stored shape is deliberately narrower than the engine's. A rule can
 * express far more than a commission letter usually says, and offering all of
 * it as a form would be a worse tool than offering the handful of things these
 * letters actually vary on.
 *
 * Everything lives in this browser. Nothing is uploaded anywhere.
 */

import type { Rule } from '@commission/engine';
import { LY_MAINST_2026, ATTACHMENT_A } from '../../packages/engine/contracts/ly-mainst-2026';

export interface ContractFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly addedAt: string;
}

export interface CarrierContract {
  readonly id: string;
  /** Two-letter IATA carrier code — LY, AA, UA. */
  readonly carrier: string;
  readonly title: string;
  /** Ticket-issue window. Commission is earned when the ticket is sold. */
  readonly issuedFrom: string;
  readonly issuedTo: string;
  /** Booking class → percentage, as decimal strings. Attachment A, in effect. */
  readonly rates: Readonly<Record<string, string>>;
  /** Whether the carrier's own surcharge counts toward the commissionable fare. */
  readonly includeYq: boolean;
  /** A tour code the ticket must carry; empty means none is required. */
  readonly requiredTourCode: string;
  /** Countries or regions travel must originate in; empty means anywhere. */
  readonly originIn: readonly string[];
  /** Priced once per ticket, or once per direction of travel. */
  readonly scope: 'ticket' | 'half_rt';
  /** Fare types the contract excludes outright. */
  readonly excludeFareTypes: readonly string[];
  readonly notes: string;
  readonly files: readonly ContractFile[];
}

export interface StoredConsolidator {
  readonly id: string;
  readonly name: string;
  /** The ARC/IATA number tickets are issued under — how a batch is matched. */
  readonly iata: string;
  /** Points of the fare the consolidator retains; the sub-agent takes the rest. */
  readonly retainsPoints: string;
  readonly contracts: readonly CarrierContract[];
  readonly notes: string;
}

export interface Config {
  readonly version: 1;
  readonly consolidators: readonly StoredConsolidator[];
}

const KEY = 'commission-desk.config.v1';

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * The EL AL letter, as first read. It is a starting point that can be edited
 * or deleted like anything else — not a privileged built-in.
 */
export function seedConfig(): Config {
  const commission = LY_MAINST_2026.find((r) => r.id === 'LY-MAINST-2026-ATTACH-A');
  return {
    version: 1,
    consolidators: [{
      id: 'mst',
      name: 'Main St Travel',
      iata: '33535983',
      retainsPoints: '1.00',
      notes: 'Consolidator retains 1.00 point of the fare; the sub-agent takes the remainder.',
      contracts: [{
        id: 'ly-2026',
        carrier: 'LY',
        title: 'EL AL Agency Commission Letter 2026',
        issuedFrom: '2026-01-15',
        issuedTo: '2026-12-31',
        rates: { ...ATTACHMENT_A },
        includeYq: false,
        requiredTourCode: '0NYZE71545',
        originIn: ['US', 'CA'],
        scope: 'half_rt',
        excludeFareTypes: ['group', 'private', 'consolidator'],
        notes: commission?.source?.clause
          ? `Rates from ${commission.source.clause}. Commission per half round trip on the class booked.`
          : '',
        files: [],
      }],
    }],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedConfig();
    const parsed = JSON.parse(raw) as Config;
    if (parsed?.version !== 1 || !Array.isArray(parsed.consolidators)) return seedConfig();
    return parsed;
  } catch {
    // Private browsing, cleared storage, a half-written value — the seed is a
    // working configuration, so falling back to it always leaves a usable app.
    return seedConfig();
  }
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

export const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Compiling a contract into rules
// ---------------------------------------------------------------------------

/**
 * Turn one stored carrier contract into the rules the engine evaluates.
 *
 * The order matters and is the same reading as the hand-written contract file:
 * exclusions sit above the paying clause and assert nil, so a ticket that fails
 * one earns nothing *because a clause says so* — which is a different fact from
 * no clause covering it, and only the first is safe to act on.
 */
export function compileContract(
  consolidator: StoredConsolidator,
  contract: CarrierContract,
): Rule[] {
  const base = {
    contractId: `${consolidator.id}:${contract.id}`,
    version: 1,
    approved: true,
    effective: { issuedBetween: { from: contract.issuedFrom, to: contract.issuedTo } },
    source: { document: contract.title, extractedBy: 'human' as const },
  };
  const rules: Rule[] = [];

  if (contract.excludeFareTypes.length > 0) {
    rules.push({
      ...base,
      id: `${contract.id}-EXCLUDED-FARES`,
      layer: 'carrier_to_host',
      priority: 980,
      match: {
        validatingCarrier: contract.carrier,
        fareType: { in: [...contract.excludeFareTypes] },
      },
      award: { kind: 'nil' },
    });
  }

  if (contract.requiredTourCode.trim()) {
    rules.push({
      ...base,
      id: `${contract.id}-NO-TOUR-CODE`,
      layer: 'carrier_to_host',
      priority: 950,
      match: {
        validatingCarrier: contract.carrier,
        tourCode: { notIn: [contract.requiredTourCode.trim()] },
      },
      award: { kind: 'nil' },
    });
  }

  if (contract.originIn.length > 0) {
    rules.push({
      ...base,
      id: `${contract.id}-ORIGIN-EXCLUDED`,
      layer: 'carrier_to_host',
      priority: 900,
      match: {
        validatingCarrier: contract.carrier,
        originNotIn: [...contract.originIn],
      },
      award: { kind: 'nil' },
    });
  }

  rules.push({
    ...base,
    id: `${contract.id}-RATES`,
    layer: 'carrier_to_host',
    priority: 500,
    scope: contract.scope,
    match: {
      validatingCarrier: contract.carrier,
      marketingCarrier: { in: [contract.carrier] },
      ...(contract.originIn.length > 0 ? { originIn: [...contract.originIn] } : {}),
      ...(contract.requiredTourCode.trim()
        ? { tourCode: { in: [contract.requiredTourCode.trim()] } }
        : {}),
      fareType: { in: ['published'] },
    },
    award: {
      kind: 'percent',
      rateTable: { by: 'rbd', rates: { ...contract.rates }, otherwise: 'nil' },
      basis: contract.includeYq ? ['base_fare', 'yq'] : ['base_fare'],
      rounding: { mode: 'half_up' },
    },
  });

  return rules;
}

/** The sub-agent's side: the consolidator keeps its points, we take the rest. */
export function compileSubAgentRules(c: StoredConsolidator, subAgentId: string): Rule[] {
  return [{
    id: `${c.id}-RESIDUAL`,
    layer: 'host_to_subagent',
    contractId: `${c.id}:subagent`,
    version: 1,
    priority: 500,
    subAgentId,
    approved: true,
    match: {},
    award: {
      kind: 'share_of_upstream',
      mode: 'residual',
      hostRetainsPoints: c.retainsPoints,
      whenUpstreamNil: 'no_share',
      rounding: { mode: 'half_up' },
    },
    source: { document: 'sub-agent agreement', clause: `retains ${c.retainsPoints} point(s)` },
  }];
}

export function carrierRulesFor(c: StoredConsolidator): Rule[] {
  return c.contracts.flatMap((contract) => compileContract(c, contract));
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
