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
import { parseAmadeusAir, type AirPassenger } from '@commission/parsers';
import { reconcile, type BatchResult, type ReconcileInput } from '@commission/cli';
import { LY_MAINST_2026, ATTACHMENT_A, OPEN_QUESTIONS } from '../../packages/engine/contracts/ly-mainst-2026';
import {
  AAPPEL_2026, HOST_RETAINS_POINTS, SUB_AGENT_ID, rateCard,
} from '../../packages/engine/contracts/subagent-aappel-2026';

export { ATTACHMENT_A, OPEN_QUESTIONS, LY_MAINST_2026 };
export { AAPPEL_2026, HOST_RETAINS_POINTS, SUB_AGENT_ID, rateCard };

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

export interface Batch {
  readonly result: BatchResult;
  readonly passengers: readonly AirPassenger[];
  readonly fileCount: number;
  readonly failures: readonly string[];
}

export function priceFiles(files: readonly LoadedFile[]): Batch {
  const inputs: ReconcileInput[] = [];
  const passengers: AirPassenger[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];

  for (const file of files) {
    let parsed;
    try {
      parsed = parseAmadeusAir(file.text);
    } catch (e) {
      failures.push(`${file.name}: could not be read — ${(e as Error).message}`);
      continue;
    }
    if (parsed.tickets.length === 0) {
      failures.push(`${file.name}: no tickets found in this file`);
      continue;
    }
    for (const p of parsed.passengers) {
      passengers.push(p);
      inputs.push({
        ticket: p.ticket,
        // A markup on a net fare is revenue, not a commission claim.
        claimed: p.reportedFM && !p.ticket.bulk ? p.reportedFM.amount : null,
        markup: p.markup,
      });
    }
    for (const w of parsed.warnings) warnings.push(`${file.name}: ${w}`);
  }

  return {
    result: reconcile(inputs, RULES, warnings),
    passengers,
    fileCount: files.length,
    failures,
  };
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
  if (ticket.coupons.length === 0) return '?';
  return `${ticket.coupons[0].origin}\u2013${journeyDestination(ticket.coupons, DEFAULT_GEO)}`;
}
