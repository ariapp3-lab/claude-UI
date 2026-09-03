/**
 * The portal's data layer.
 *
 * Everything on screen is computed here, in the browser, by the same engine the
 * command-line reconciler uses and against the same contract file. There are no
 * fixtures behind the UI: change a rule in `contracts/ly-mainst-2026.ts` and
 * every figure in the app moves with it.
 */

import { DEFAULT_GEO, formatMoney, journeyDestination, type Money, type Rule } from '@commission/engine';
import type { TicketDocument } from '@commission/engine';
import type { AirPassenger } from '@commission/parsers';
import { reconcile, type BatchResult, type ReconcileInput } from '@commission/cli';
import { LY_MAINST_2026, ATTACHMENT_A, OPEN_QUESTIONS } from '../../packages/engine/contracts/ly-mainst-2026';
import {
  AAPPEL_2026, HOST_RETAINS_POINTS, SUB_AGENT_ID, rateCard,
} from '../../packages/engine/contracts/subagent-aappel-2026';
import {
  CONSOLIDATORS, consolidatorForIata, type Consolidator,
} from '../../packages/engine/contracts/consolidators';

export { ATTACHMENT_A, OPEN_QUESTIONS, LY_MAINST_2026 };
export { AAPPEL_2026, HOST_RETAINS_POINTS, SUB_AGENT_ID, rateCard };
export { CONSOLIDATORS, consolidatorForIata };
export type { Consolidator };

/** Carrier contract plus the sub-agent agreement, which is what an agent sees. */
export const SUB_AGENT_RULES: Rule[] = [
  ...LY_MAINST_2026.map((r) => ({ ...r, approved: true })),
  ...AAPPEL_2026,
];
export type { BatchResult };

/**
 * The contract is filed unapproved and cannot fire until a human confirms the
 * readings. Opening the portal is that confirmation being exercised, which is
 * why the approval happens here and not in the contract file.
 */
export const RULES: Rule[] = LY_MAINST_2026.map((r) => ({ ...r, approved: true }));

/** The agency's own AIR files, bundled so the portal opens on real work. */
const SAMPLES = import.meta.glob(
  '../../packages/parsers/test/samples/*.air',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export interface LoadedFile {
  readonly name: string;
  readonly text: string;
  /** True for the files that shipped with the app, false for a drop. */
  readonly bundled: boolean;
}

export const BUNDLED_FILES: LoadedFile[] = Object.entries(SAMPLES)
  .map(([path, text]) => ({
    name: path.split('/').pop() ?? path,
    text,
    bundled: true,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Price already-parsed documents.
 *
 * Parsing happens once, in the batch provider, and the source text is dropped
 * there — so this takes tickets rather than files. Pricing a few thousand is
 * well under a second; it is the reading that takes the time.
 */
export function priceBatch(
  passengers: readonly AirPassenger[],
  rules: readonly Rule[],
  warnings: readonly string[] = [],
): BatchResult {
  const inputs: ReconcileInput[] = passengers.map((p) => ({
    ticket: p.ticket,
    // A markup on a net fare is revenue, not a commission claim.
    claimed: p.reportedFM && !p.ticket.bulk ? p.reportedFM.amount : null,
    markup: p.markup,
  }));
  return reconcile(inputs, rules, warnings);
}

/** "1496.00" → "1,496.00". Grouping for display only; never for arithmetic. */
export function money(m: Money | null | undefined): string {
  if (!m) return '—';
  const s = formatMoney(m);
  const neg = s.startsWith('-');
  const [whole, frac] = (neg ? s.slice(1) : s).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

export function isNeg(m: Money | null | undefined): boolean {
  return !!m && m.units < 0n;
}

/** "JFK–TLV" — named by the turnaround, so a round trip is not JFK–JFK. */
export function routeOf(ticket: TicketDocument): string {
  if (ticket.coupons.length === 0) return 'no coupons';
  const to = journeyDestination(ticket.coupons, DEFAULT_GEO);
  return `${ticket.coupons[0].origin}\u2013${to ?? '?'}`;
}

export interface DetectedConsolidator {
  /** The IATA number the tickets were issued under. */
  readonly iata: string;
  /** The consolidator that number belongs to, where we hold their contracts. */
  readonly consolidator: Consolidator | null;
  readonly tickets: number;
}

/**
 * Which consolidator a batch belongs to, read off the tickets.
 *
 * Every document carries the IATA number it was issued under, so there is
 * nothing to choose: a batch identifies its own consolidator, and a mixed batch
 * identifies several. A number we hold no contracts for is reported as itself
 * rather than folded into whichever consolidator happens to be selected —
 * pricing a ticket against the wrong agency's contract is worse than not
 * pricing it.
 */
export function detectConsolidators(
  passengers: readonly { ticket: { iataNumber?: string } }[],
): DetectedConsolidator[] {
  const counts = new Map<string, number>();
  for (const p of passengers) {
    const iata = p.ticket.iataNumber ?? 'unknown';
    counts.set(iata, (counts.get(iata) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([iata, tickets]) => ({
      iata,
      consolidator: iata === 'unknown' ? null : (consolidatorForIata(iata) ?? null),
      tickets,
    }))
    .sort((a, b) => b.tickets - a.tickets);
}
