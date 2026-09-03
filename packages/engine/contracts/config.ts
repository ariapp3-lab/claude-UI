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

/** A rate that applies only on one market. */
export interface RouteBand {
  readonly id: string;
  /** Country, region or airport the journey must travel from. */
  readonly from: string;
  readonly to: string;
  /** Whether the reverse direction is covered too. */
  readonly bothWays: boolean;
  /** Class -> rate within this market. */
  readonly rates: Readonly<Record<string, string>>;
  /** Applied to any class this band's table does not list. Empty means none. */
  readonly flatRate: string;
  readonly notes: string;
}

/**
 * How a host splits an airline's commission with ONE sub-agent.
 *
 * Per sub-agent, deliberately. The same host on the same airline routinely
 * keeps two points from one agent and four from another, so a single number on
 * the office cannot express it. `carrier` narrows a split to one airline;
 * '*' is the default that applies where no airline-specific split exists.
 */
export interface SubAgentSplit {
  readonly id: string;
  /** Two-letter carrier code, or '*' for every carrier without its own split. */
  readonly carrier: string;
  /**
   * residual  the host keeps N points and the sub-agent takes the remainder.
   *           Self-correcting: if the airline drops the rate, the host still
   *           keeps N and the sub-agent absorbs the change.
   * points    the sub-agent gets N points regardless of the airline's rate.
   *           If the airline pays less than N, the host pays out of pocket --
   *           the engine flags that rather than silently capping it.
   * fraction  a ratio of whatever the host earned.
   */
  readonly mode: 'residual' | 'points' | 'fraction';
  /** residual: points the HOST keeps. */
  readonly hostRetainsPoints: string;
  /** points: points the SUB-AGENT gets. */
  readonly points: string;
  /** fraction: the sub-agent's share of the host's commission. */
  readonly numerator: string;
  readonly denominator: string;
  readonly notes: string;
}

/** When a host fee bites. */
export type FeeTrigger =
  | 'non_commissionable'  // the contract established that nothing is due
  | 'commission_below'    // commission earned is under a threshold
  | 'exchange'            // a reissue that collected a fare difference
  | 'even_exchange'       // a reissue that collected nothing
  | 'refund'
  | 'void'
  | 'every_ticket';

/**
 * One fee a host charges a sub-agent.
 *
 * Separate from the split, because a fee applies whether or not the split gave
 * the sub-agent anything -- that is the whole point of a non-commissionable fee.
 */
export interface SubAgentFee {
  readonly id: string;
  readonly label: string;
  readonly trigger: FeeTrigger;
  /** Limit to one carrier; empty means every carrier. */
  readonly carrier: string;
  /** Limit to these fare types; empty means every type. */
  readonly fareTypes: readonly string[];
  /** Limit to these booking classes -- how a cabin band is expressed. */
  readonly rbds: readonly string[];
  /** A flat charge. Use this or `rate`, not both. */
  readonly amount: string;
  /** A percentage charge. */
  readonly rate: string;
  readonly basisOf: 'commission' | 'base_fare' | 'ticket_total';
  /** commission_below: the threshold, in the document's currency. */
  readonly threshold: string;
  /**
   * False for a term the host RESERVED the right to apply rather than
   * committed to. An unapproved fee is surfaced as exposure and never booked
   * against the sub-agent.
   */
  readonly approved: boolean;
  readonly notes: string;
}

/** The whole agreement between this office and one sub-agent. */
export interface SubAgentAgreement {
  readonly id: string;
  /** Stable identifier used in the compiled rules. */
  readonly subAgentId: string;
  readonly name: string;
  readonly splits: readonly SubAgentSplit[];
  readonly fees: readonly SubAgentFee[];
  readonly notes: string;
  readonly files: readonly ContractFile[];
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
  /**
   * Rates that apply only on a particular market, above the table above.
   *
   * Commission letters are not always one table. A carrier commonly pays a
   * different rate on a specific market than on everything else -- "7% on this
   * route, 10% in this class" -- and the route rate is the more specific
   * statement, so it wins where both could apply.
   *
   * `from`/`to` take a country, a region (see geo.ts) or a specific airport.
   * `rates` narrows by class within the market; `flatRate` covers every class
   * on it. A band with both prefers the class table and falls back to the flat
   * rate, which is how a letter that lists two classes and says "all others"
   * actually reads.
   */
  readonly routeRates?: readonly RouteBand[];
  /** Whether the carrier's own surcharge counts toward the commissionable fare. */
  readonly includeYq: boolean;
  /** A tour code the ticket must carry; empty means none is required. */
  readonly requiredTourCode: string;
  /** Countries or regions travel must originate in; empty means anywhere. */
  readonly originIn: readonly string[];
  /** Priced once per ticket, or once per direction of travel. */
  readonly scope: 'ticket' | 'half_rt';
  /**
   * How far a net or bulk fare may be marked up, as a percentage. Empty means
   * the ceiling is not known — which is NOT the same as a ceiling of zero, and
   * is reported as unknown rather than as every ticket being over.
   */
  readonly maxMarkupPercent?: string;
  /** Whether that ceiling is struck on the net fare or the selling fare. */
  readonly markupBasis?: 'net' | 'selling';
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
  /**
   * Agreements with individual sub-agents. Where one exists for the sub-agent
   * being priced, it governs entirely -- `retainsPoints` and `feeSchedule`
   * above are only the fallback for an office that has not been set up yet.
   */
  readonly subAgents?: readonly SubAgentAgreement[];
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
        // Both marked-up records in the folder sit at exactly 25.0000% of the
        // net fare, to four decimal places — the signature of a ceiling being
        // marked to, not a margin chosen per booking. Recorded as observed and
        // pending confirmation from EL AL; see OPEN_QUESTIONS.
        maxMarkupPercent: '25.00',
        markupBasis: 'net',
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
    // Carried by EVERY rule this contract compiles, not just the paying one.
    // The paying clauses match published fares only, so on a bulk fare the rule
    // that fires is an exclusion — and that is exactly the ticket whose markup
    // ceiling matters. The allowance belongs to the contract, so whichever of
    // its clauses fires can answer for it.
    ...(contract.maxMarkupPercent?.trim()
      ? {
          markupAllowance: {
            maxPercent: contract.maxMarkupPercent.trim(),
            basis: contract.markupBasis ?? 'net',
          },
        }
      : {}),
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

  // Route bands sit ABOVE the general table. A letter that names a market is
  // making the more specific statement, and specificity is what should decide
  // -- not the order the bands happen to be stored in. Each band gets its own
  // priority step so two bands covering one ticket never tie.
  for (const [i, band] of (contract.routeRates ?? []).entries()) {
    if (!band.from || !band.to) continue;
    const hasClassRates = Object.keys(band.rates).length > 0;
    if (!hasClassRates && !band.flatRate.trim()) continue;

    rules.push({
      ...base,
      id: `${contract.id}-ROUTE-${band.id}`,
      layer: 'carrier_to_host',
      priority: 700 + i,
      scope: contract.scope,
      match: {
        validatingCarrier: contract.carrier,
        marketingCarrier: { in: [contract.carrier] },
        market: {
          from: band.from,
          to: band.to,
          direction: band.bothWays ? 'either' : 'outbound',
        },
        ...(contract.requiredTourCode.trim()
          ? { tourCode: { in: [contract.requiredTourCode.trim()] } }
          : {}),
        fareType: { in: ['published'] },
      },
      award: {
        kind: 'percent',
        // A band with a class table AND a flat rate reads the way a letter
        // does: these classes at these rates, everything else at the flat one.
        ...(hasClassRates
          ? {
              rateTable: {
                by: 'rbd' as const,
                rates: { ...band.rates },
                ...(band.flatRate.trim()
                  ? { otherwiseRate: band.flatRate.trim() }
                  : { otherwise: 'nil' as const }),
              },
            }
          : { rate: band.flatRate.trim() }),
        basis: contract.includeYq ? ['base_fare', 'yq'] : ['base_fare'],
        rounding: { mode: 'half_up' },
      },
      source: cite(
        `${band.from}–${band.to}${band.bothWays ? ' (both ways)' : ''}: ` +
        (hasClassRates
          ? Object.entries(band.rates).map(([k, v]) => `${k} ${v}%`).join(', ') +
            (band.flatRate.trim() ? `, all others ${band.flatRate}%` : '')
          : `${band.flatRate}%`),
      ),
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
/**
 * Turn one stored sub-agent agreement into rules.
 *
 * Splits and fees compile separately because they behave differently: exactly
 * one split applies to a document, and every matching fee applies. A fee is
 * not a smaller split -- it bites whether or not the split paid anything, which
 * is the entire point of a charge on a non-commissionable ticket.
 */
export function compileAgreement(
  c: StoredConsolidator,
  agreement: SubAgentAgreement,
): Rule[] {
  const base = {
    layer: 'host_to_subagent' as const,
    contractId: `${c.id}:${agreement.id}`,
    version: 1,
    subAgentId: agreement.subAgentId,
    effective: undefined,
  };
  const cite = (clause: string) => ({
    document: `sub-agent agreement — ${agreement.name}`,
    clause,
    extractedBy: 'human' as const,
  });
  const rules: Rule[] = [];

  // --- splits ---------------------------------------------------------------
  // A carrier-specific split is the more specific statement, so it outranks the
  // default. Without the gap in priority the two would tie and the engine would
  // correctly refuse to choose -- an AMBIGUOUS on every ticket.
  for (const split of agreement.splits) {
    const specific = split.carrier !== '*' && split.carrier !== '';
    rules.push({
      ...base,
      id: `${agreement.id}-SPLIT-${split.carrier || 'ANY'}`,
      priority: specific ? 600 : 500,
      approved: true,
      match: specific ? { validatingCarrier: split.carrier.toUpperCase() } : {},
      award: {
        kind: 'share_of_upstream',
        mode: split.mode,
        ...(split.mode === 'residual' ? { hostRetainsPoints: split.hostRetainsPoints } : {}),
        ...(split.mode === 'points' ? { points: split.points } : {}),
        ...(split.mode === 'fraction'
          ? { numerator: split.numerator, denominator: split.denominator }
          : {}),
        // Fees still apply where the airline paid nothing, so the split must
        // step aside rather than suppress the whole layer.
        whenUpstreamNil: 'fee_only',
        rounding: { mode: 'half_up' },
      },
      source: cite(describeSplit(split)),
    });
  }

  // --- fees -----------------------------------------------------------------
  for (const fee of agreement.fees) {
    const match: Record<string, unknown> = {};
    if (fee.carrier) match.validatingCarrier = fee.carrier.toUpperCase();
    if (fee.fareTypes.length) match.fareType = { in: [...fee.fareTypes] };
    if (fee.rbds.length) match.rbd = { in: [...fee.rbds] };

    switch (fee.trigger) {
      case 'non_commissionable':
        // Gated on the contract having ESTABLISHED nothing is due. A document
        // nobody could price has established nothing, and charging off it would
        // be inventing a fee.
        match.upstreamCommission = 'nil';
        match.documentType = { in: ['TKT'] };
        break;
      case 'commission_below':
        match.upstreamCommission = 'nonzero';
        match.upstreamCommissionBelow = fee.threshold || '0.00';
        break;
      case 'exchange':
        match.documentType = { in: ['EXCH'] };
        match.additionalCollection = 'nonzero';
        break;
      case 'even_exchange':
        match.documentType = { in: ['EXCH'] };
        match.additionalCollection = 'zero';
        break;
      case 'refund':
        match.documentType = { in: ['RFND'] };
        break;
      case 'void':
        match.documentType = { in: ['VOID'] };
        break;
      case 'every_ticket':
        break;
    }

    rules.push({
      ...base,
      id: `${agreement.id}-FEE-${fee.id}`,
      priority: 900,
      approved: fee.approved,
      match: match as Rule['match'],
      award: {
        kind: 'fee',
        ...(fee.rate ? { rate: fee.rate, basisOf: fee.basisOf } : { amount: fee.amount || '0' }),
        currency: 'USD',
        per: 'ticket',
        direction: 'debit_subagent',
        rounding: { mode: 'half_up' },
      },
      source: cite(fee.label),
    });
  }

  return rules;
}

function describeSplit(s: SubAgentSplit): string {
  const who = s.carrier === '*' || !s.carrier ? 'all carriers' : s.carrier.toUpperCase();
  switch (s.mode) {
    case 'residual':
      return `${who}: host retains ${s.hostRetainsPoints} point(s)`;
    case 'points':
      return `${who}: sub-agent receives ${s.points} point(s)`;
    default:
      return `${who}: sub-agent receives ${s.numerator}/${s.denominator} of commission`;
  }
}

/** A blank agreement, for the UI's "add sub-agent" action. */
export function newAgreement(subAgentId: string, name: string): SubAgentAgreement {
  return {
    id: newId('sa'),
    subAgentId,
    name,
    splits: [{
      id: newId('sp'),
      carrier: '*',
      mode: 'residual',
      hostRetainsPoints: '1.00',
      points: '0.00',
      numerator: '1',
      denominator: '1',
      notes: '',
    }],
    fees: [],
    notes: '',
    files: [],
  };
}

export function compileSubAgentRules(c: StoredConsolidator, subAgentId: string): Rule[] {
  // A stored agreement for this sub-agent governs entirely. The office-level
  // retention and the built-in schedule below are only what an office that has
  // not been set up yet falls back to.
  const agreement = c.subAgents?.find((a) => a.subAgentId === subAgentId);
  if (agreement) return compileAgreement(c, agreement);

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
