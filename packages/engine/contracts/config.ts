/**
 * Contracts as data a person can edit, not code a developer has to.
 *
 * This file is the model and the compiler, and holds no browser: it is pure so
 * that the engine's own tests can prove a contract entered through the app
 * prices identically to one written by hand. Where the configuration is kept —
 * localStorage, a file, a database — is a separate question, answered next to
 * whichever of those is doing the keeping.
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

import type { Rule } from "../src/types.js";
import { LY_MAINST_2026, ATTACHMENT_A } from "./ly-mainst-2026.js";
import { MST_SUBAGENT_2026 } from './mst-subagent-2026.js';

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

/**
 * One IATA office and the contracts held under it.
 *
 * The IATA number, not the agency, is the unit that owns contracts. A single
 * host commonly holds several: the MST agreement's own footnote points at
 * "PNRs created under one of MST's affiliate offices in order to access higher
 * contracted commission levels" — same host, same airline, different number,
 * better rates. Modelling the agency as the owner would make those three
 * contracts fight over one row; modelling the number as the owner makes them
 * three rows that never collide, which is also how a ticket resolves.
 *
 * `agency` is the label that groups them back together for a human.
 */
export interface StoredConsolidator {
  readonly id: string;
  readonly name: string;
  /**
   * Which tenant holds this office. Resolution is always scoped by it: two
   * tenants may legitimately hold different contracts for the same IATA, and
   * neither may ever see the other's.
   */
  readonly tenantId: string;
  /** The agency these offices belong to, for grouping. e.g. "Main St Travel". */
  readonly agency?: string;
  /** The ARC/IATA number tickets are issued under — how a batch is matched. */
  readonly iata: string;
  /** Points of the fare the consolidator retains; the sub-agent takes the rest. */
  readonly retainsPoints: string;
  /**
   * A signed fee schedule to use in place of the plain residual.
   *
   * Most host agreements are one line — "we keep a point" — and `retainsPoints`
   * says it all. A real signed schedule is not: MST's prices net fares by cabin,
   * charges per exchange and per refund, and bills $10 on a ticket that earned
   * nothing. Where one has been encoded, name it here; otherwise the generic
   * residual below applies, which is what any other agency starts from.
   */
  readonly feeSchedule?: 'mst-2026';
  readonly contracts: readonly CarrierContract[];
  readonly notes: string;
}

export interface Config {
  readonly version: 1;
  readonly consolidators: readonly StoredConsolidator[];
}

/** The tenant a single-agency install runs as, until the CRM supplies one. */
export const DEFAULT_TENANT = 'default';

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
      tenantId: DEFAULT_TENANT,
      agency: 'Main St Travel',
      iata: '33535983',
      retainsPoints: '1.00',
      feeSchedule: 'mst-2026',
      notes:
        'Sub-Agent Agreement effective 2026-02-01. MST keeps 1 point on LY published '
        + 'fares (2 on other carriers), charges a flat fee by cabin on net and bulk '
        + 'fares, $25 per exchange and per refund, and $10 on a ticket that earns nothing.',
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
  // Each compiled rule names the condition it enforces. Without it a result
  // says only that nothing is due, which is the least useful true statement
  // the system can make.
  const cite = (clause: string) => ({ ...base.source, clause });
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
      source: cite(`excluded fare types: ${contract.excludeFareTypes.join(', ')}`),
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
      source: cite(`tour code ${contract.requiredTourCode.trim()} required`),
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
      source: cite(`travel must originate in ${contract.originIn.join(' or ')}`),
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
    source: cite(
      `commission by booking class, ${contract.includeYq ? 'base fare plus YQ' : 'base fare'}` +
      `${contract.scope === 'half_rt' ? ', per half round trip' : ''}`,
    ),
  });

  return rules;
}

/** The sub-agent's side: the consolidator keeps its points, we take the rest. */
export function compileSubAgentRules(c: StoredConsolidator, subAgentId: string): Rule[] {
  if (c.feeSchedule === 'mst-2026') {
    // The signed schedule, rebound to whichever sub-agent is being priced. Its
    // own approval flags are preserved: the clauses MST reserved the right to
    // apply, rather than committed to, stay off until confirmed.
    //
    // `retainsPoints` still governs, because it is the number the agency edits
    // in the UI and a setting that silently does nothing is worse than no
    // setting. It applies to the LY clauses — the schedule prices LY at one
    // point and everything else at two, and it is the LY figure the field
    // stands for. A different carrier keeps the rate as signed.
    const LY_SHARE_RULES = new Set(['MST-SHARE-LY', 'MST-SHARE-LY-EXCH']);
    return MST_SUBAGENT_2026.map((r) =>
      LY_SHARE_RULES.has(r.id)
        ? { ...r, subAgentId, award: { ...r.award, hostRetainsPoints: c.retainsPoints } }
        : { ...r, subAgentId },
    );
  }

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


/** A short, collision-resistant id for a consolidator, contract or file. */
export const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Why a ticket found no contract. Each is a different thing to do about it, so
 * they are never collapsed into one "not found".
 */
export type ResolutionMiss =
  | 'no_iata'          // the document carries no IATA number to match on
  | 'unknown_iata'     // an IATA this tenant holds no office for
  | 'no_carrier'       // the office holds no contract for this airline
  | 'outside_window';  // a contract exists but not for this ticketing date

export interface Resolution {
  readonly office: StoredConsolidator | null;
  readonly contracts: readonly CarrierContract[];
  readonly miss: ResolutionMiss | null;
  /** Plain English, for the queue a human works through. */
  readonly reason: string;
}

/**
 * Find the contracts governing one ticket. The single place this decision is
 * made — the CRM, the app and the CLI all call it, so they cannot drift.
 *
 * The chain is tenant, then IATA, then carrier, then the ticketing date, and it
 * stops at the first step that fails. Each stop reports which step it was:
 * an unknown IATA is a contract to go and get, a carrier gap is a contract to
 * negotiate, and an expired window is a renewal. Reporting all three as
 * "no contract" would hide which one it is.
 *
 * The date tested is the TICKETING date, not travel: commission is earned when
 * the ticket is sold.
 */
export function resolveContracts(
  config: Config,
  q: {
    readonly tenantId: string;
    readonly iata: string | null | undefined;
    readonly carrier: string;
    readonly issueDate: string;
  },
): Resolution {
  const none = (miss: ResolutionMiss, reason: string): Resolution =>
    ({ office: null, contracts: [], miss, reason });

  if (!q.iata) {
    return none('no_iata', 'this document carries no IATA number, so no contract could be selected');
  }

  // Scoped by tenant first, always. Two tenants may hold the same IATA with
  // different terms, and one must never price with the other's contract.
  const office = config.consolidators.find(
    (c) => c.tenantId === q.tenantId && c.iata === q.iata,
  );
  if (!office) {
    return none('unknown_iata', `no office is configured for IATA ${q.iata}`);
  }

  const carrier = q.carrier.toUpperCase();
  const forCarrier = office.contracts.filter((k) => k.carrier.toUpperCase() === carrier);
  if (forCarrier.length === 0) {
    return {
      office,
      contracts: [],
      miss: 'no_carrier',
      reason: `${office.name} (IATA ${q.iata}) holds no ${carrier} contract`,
    };
  }

  const inWindow = forCarrier.filter(
    (k) =>
      (!k.issuedFrom || q.issueDate >= k.issuedFrom) &&
      (!k.issuedTo || q.issueDate <= k.issuedTo),
  );
  if (inWindow.length === 0) {
    const windows = forCarrier.map((k) => `${k.issuedFrom || '−∞'}…${k.issuedTo || '+∞'}`).join(', ');
    return {
      office,
      contracts: [],
      miss: 'outside_window',
      reason:
        `${office.name} holds a ${carrier} contract, but none covering a ticket issued ` +
        `${q.issueDate} (${windows})`,
    };
  }

  return {
    office,
    contracts: inWindow,
    miss: null,
    reason: `${office.name} (IATA ${q.iata}) · ${inWindow.map((k) => k.title).join(', ')}`,
  };
}

/** Every office a tenant holds, newest-looking first for a picker. */
export function officesFor(config: Config, tenantId: string): readonly StoredConsolidator[] {
  return config.consolidators.filter((c) => c.tenantId === tenantId);
}
