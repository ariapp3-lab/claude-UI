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


/** A short, collision-resistant id for a consolidator, contract or file. */
export const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
