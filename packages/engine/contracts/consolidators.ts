/**
 * Consolidators.
 *
 * A sub-agent tickets on a consolidator's plate, under the consolidator's
 * carrier contracts, and is paid by the consolidator's weekly statement. An
 * agency that works with more than one holds a different rate card, a different
 * retention and a different statement format for each — so the consolidator is
 * the unit everything else hangs off, not an afterthought.
 *
 * The same registry serves both directions. A host agency running this
 * standalone is the consolidator in one of these entries and reads its own
 * carrier contracts; a sub-agent reads the same entry from the other side.
 */

import type { Rule } from "../src/types.js";
import { LY_MAINST_2026 } from "./ly-mainst-2026.js";
import { AAPPEL_LY_SHARE } from "./subagent-aappel-2026.js";

export interface Consolidator {
  readonly id: string;
  readonly name: string;
  /** The ARC/IATA number tickets are issued under. */
  readonly iata: string;
  /** Carriers we hold a commission letter for through this consolidator. */
  readonly carriers: readonly string[];
  /** The consolidator's contracts with the carriers. */
  readonly carrierRules: readonly Rule[];
  /** Our agreement with this consolidator. */
  readonly subAgentRules: readonly Rule[];
  /** One-line summary of the split, for a reader who will not open the rules. */
  readonly terms: string;
}

/** Main St Travel — the consolidator this agency's EL AL business runs through. */
export const MAIN_ST_TRAVEL: Consolidator = {
  id: "mst",
  name: "Main St Travel",
  iata: "33535983",
  carriers: ["LY"],
  // Filed unapproved in the contract file; a live registry is that approval
  // being exercised, which is a decision a person makes and not a default.
  carrierRules: LY_MAINST_2026.map((r) => ({ ...r, approved: true })),
  subAgentRules: [AAPPEL_LY_SHARE],
  terms: "Consolidator retains 1.00 point of the fare; the sub-agent takes the remainder.",
};

export const CONSOLIDATORS: readonly Consolidator[] = [MAIN_ST_TRAVEL];

export function consolidatorById(id: string): Consolidator | undefined {
  return CONSOLIDATORS.find((c) => c.id === id);
}

/** Everything needed to price a document for one side of one consolidator. */
export function rulesFor(
  c: Consolidator,
  view: "host" | "subagent",
): Rule[] {
  return view === "host"
    ? [...c.carrierRules]
    : [...c.carrierRules, ...c.subAgentRules];
}

/**
 * Which consolidator a document belongs to, read off the ticket rather than
 * chosen. Tickets carry the IATA number they were issued under, so a mixed
 * batch sorts itself.
 */
export function consolidatorForIata(iata: string | undefined): Consolidator | undefined {
  if (!iata) return undefined;
  return CONSOLIDATORS.find((c) => c.iata === iata);
}
