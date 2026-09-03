/**
 * Sub-agent agreement — A. Appel and Co under Main St Travel.
 *
 * Ticketing runs on the host's ARC number (IATA 33535983), so every EL AL
 * document the CRM receives is issued under the host's plate and priced by the
 * host's contract. What the sub-agent earns is what is left after the host's
 * retention.
 *
 * THE TERM, as stated by the agency: **the consolidator keeps one point.**
 *
 * That is a residual share, not a fixed rate, and the distinction is the whole
 * point of modelling it this way. "One point to the host" tracks Attachment A
 * automatically: a D-class ticket at 9% leaves 8, an S at 7% leaves 6, a Y at
 * 5% leaves 4. Had it been written the other way — "the sub-agent gets 8" — a
 * carrier rate cut would leave the agreement promising more than the host
 * earns, and the host paying the difference out of pocket.
 *
 * The revenue share below is the agency's own term. The fee schedule is NOT:
 * no fees have been supplied, so none are modelled. A fee the host charges and
 * this file does not know about does not reduce these figures.
 */

import type { Rule } from "../src/types.js";
import { ATTACHMENT_A } from "./ly-mainst-2026.js";

export const SUB_AGENT_ID = "aappel";
export const HOST_RETAINS_POINTS = "1.00";

/**
 * Whatever EL AL pays the host on a document, the host keeps one point of the
 * fare and the sub-agent takes the remainder. Expressed relative to the rule
 * that actually fired upstream, so it needs no edit when Attachment A changes.
 */
export const AAPPEL_LY_SHARE: Rule = {
  id: "AAPPEL-LY-RESIDUAL-2026",
  layer: "host_to_subagent",
  contractId: "ct_aappel_mainst_2026",
  version: 1,
  priority: 500,
  subAgentId: SUB_AGENT_ID,
  approved: true,
  match: { validatingCarrier: "LY" },
  award: {
    kind: "share_of_upstream",
    mode: "residual",
    hostRetainsPoints: HOST_RETAINS_POINTS,
    // Where EL AL pays the host nothing there is nothing to divide. The host
    // may still charge a fee for issuing such a ticket, but that is a fee and
    // has to be stated as one — it is not a negative share.
    whenUpstreamNil: "no_share",
    rounding: { mode: "half_up" },
  },
  source: {
    document: "stated by the agency, pending the signed agreement",
    clause: "consolidator retains 1 point",
    extractedBy: "human",
  },
};

export const AAPPEL_2026: Rule[] = [AAPPEL_LY_SHARE];

/**
 * The rate card: what each EL AL booking class actually pays this sub-agent.
 *
 * Derived from Attachment A rather than typed out, so it cannot drift from the
 * contract the host is settled on. This is the table an agent wants at the
 * point of sale, not at reconciliation.
 */
export interface RateCardRow {
  readonly rbd: string;
  readonly carrierRate: string;
  readonly hostKeeps: string;
  readonly subAgentRate: string;
}

export function rateCard(
  attachment: Record<string, string> = ATTACHMENT_A,
  hostPoints: string = HOST_RETAINS_POINTS,
): RateCardRow[] {
  const keeps = Number(hostPoints);
  return Object.entries(attachment)
    .map(([rbd, rate]) => {
      const carrier = Number(rate);
      const sub = Math.max(0, carrier - keeps);
      return {
        rbd,
        carrierRate: carrier.toFixed(2),
        hostKeeps: Math.min(keeps, carrier).toFixed(2),
        subAgentRate: sub.toFixed(2),
      };
    })
    .sort((a, b) =>
      Number(b.subAgentRate) - Number(a.subAgentRate) || a.rbd.localeCompare(b.rbd));
}
