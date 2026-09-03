/**
 * What the incoming files say about contracts you do not have yet.
 *
 * Setting a system like this up from an empty contract table is the slow part:
 * someone has to know which IATA numbers you ticket under, which airlines each
 * one covers, and what rate applies to each booking class. All of that is
 * already sitting in the folder of AIR files.
 *
 * Two different things are read out of them, and they must not be confused:
 *
 *   OBSERVED   what the agent claimed on the ticket, from the FM element. It is
 *              evidence of what somebody believed the contract said. It is not
 *              the contract, and it is routinely wrong - one of the sample
 *              tickets claims 8% on a class the airline files at 7%.
 *
 *   CONFIGURED what the contract table actually holds.
 *
 * So this proposes a starting point for a human to correct, never a contract to
 * price with. A rate is only offered where every ticket in a class agreed on
 * it; where they disagree, the disagreement itself is reported, because that is
 * usually the more interesting finding.
 */

import type { AirPassenger } from "@commission/parsers";
import { parseAmadeusAir } from "@commission/parsers";
import { type Config, resolveContracts } from "../../engine/contracts/config.js";

export interface ObservedClass {
  readonly rbd: string;
  readonly tickets: number;
  /**
   * The rate every ticket in this class agreed on, or null where they did not.
   * Null is a finding, not a gap: either the contract varies by something not
   * yet modelled, or somebody has been claiming the wrong rate.
   */
  readonly rate: string | null;
  /** Every distinct rate seen, most frequent first. */
  readonly claimed: readonly { readonly rate: string; readonly tickets: number }[];
}

export interface DiscoveredContract {
  readonly iata: string;
  readonly carrier: string;
  readonly tickets: number;
  readonly firstIssued: string;
  readonly lastIssued: string;
  /** True where the tenant already holds a contract covering these tickets. */
  readonly configured: boolean;
  /** Why not, where it is not - an unknown IATA reads differently from a gap. */
  readonly miss: string | null;
  readonly classes: readonly ObservedClass[];
  /** Fare types seen, so a net-fare-only office is obvious at a glance. */
  readonly fareTypes: readonly string[];
  /** Tour codes seen. A contract that mandates one shows up here. */
  readonly tourCodes: readonly string[];
  /** Commission claimed as a flat amount rather than a rate, if any. */
  readonly flatClaims: number;
}

interface Bucket {
  iata: string;
  carrier: string;
  tickets: number;
  first: string;
  last: string;
  byRbd: Map<string, Map<string, number>>;
  fareTypes: Set<string>;
  tourCodes: Set<string>;
  flatClaims: number;
}

/**
 * Group parsed documents by the two things that key a contract, and report what
 * each group looks like.
 */
export function discoverFromPassengers(
  passengers: readonly AirPassenger[],
  opts: { readonly config: Config; readonly tenantId: string },
): readonly DiscoveredContract[] {
  const buckets = new Map<string, Bucket>();

  for (const p of passengers) {
    const t = p.ticket;
    const iata = t.iataNumber ?? "";
    const carrier = (t.validatingCarrier ?? "").toUpperCase();
    if (!iata || !carrier) continue;

    const key = `${iata} ${carrier}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        iata, carrier, tickets: 0,
        first: t.issueDate, last: t.issueDate,
        byRbd: new Map(), fareTypes: new Set(), tourCodes: new Set(), flatClaims: 0,
      };
      buckets.set(key, b);
    }

    b.tickets += 1;
    if (t.issueDate < b.first) b.first = t.issueDate;
    if (t.issueDate > b.last) b.last = t.issueDate;
    b.fareTypes.add(t.fareType);
    if (t.tourCode) b.tourCodes.add(t.tourCode);

    // A percentage claim is attributable to a class; a flat amount is not, so
    // it is counted rather than folded into a rate it cannot support.
    if (p.reportedFM?.kind === "percent") {
      const rate = p.reportedFM.rate;
      // Attribute to every distinct class on the ticket. A single-class ticket
      // - which is most of them - attributes cleanly; a mixed-class ticket
      // reports the ambiguity by contributing to both.
      for (const rbd of new Set(t.coupons.map((c) => c.rbd))) {
        const seen = b.byRbd.get(rbd) ?? new Map<string, number>();
        seen.set(rate, (seen.get(rate) ?? 0) + 1);
        b.byRbd.set(rbd, seen);
      }
    } else if (p.reportedFM?.kind === "amount" && p.reportedFM.amount.units !== 0n) {
      b.flatClaims += 1;
    }
  }

  return [...buckets.values()]
    .map((b): DiscoveredContract => {
      const resolution = resolveContracts(opts.config, {
        tenantId: opts.tenantId,
        iata: b.iata,
        carrier: b.carrier,
        issueDate: b.last,
      });

      const classes = [...b.byRbd.entries()]
        .map(([rbd, seen]): ObservedClass => {
          const claimed = [...seen.entries()]
            .map(([rate, tickets]) => ({ rate, tickets }))
            .sort((x, y) => y.tickets - x.tickets || x.rate.localeCompare(y.rate));
          return {
            rbd,
            tickets: claimed.reduce((n, c) => n + c.tickets, 0),
            rate: claimed.length === 1 ? claimed[0]!.rate : null,
            claimed,
          };
        })
        .sort((x, y) => y.tickets - x.tickets || x.rbd.localeCompare(y.rbd));

      return {
        iata: b.iata,
        carrier: b.carrier,
        tickets: b.tickets,
        firstIssued: b.first,
        lastIssued: b.last,
        configured: resolution.miss === null,
        miss: resolution.miss === null ? null : resolution.reason,
        classes,
        fareTypes: [...b.fareTypes].sort(),
        tourCodes: [...b.tourCodes].sort(),
        flatClaims: b.flatClaims,
      };
    })
    .sort((x, y) => y.tickets - x.tickets || x.iata.localeCompare(y.iata));
}

/** The same, straight from file text. */
export function discoverFromFiles(
  files: readonly { readonly name: string; readonly text: string }[],
  opts: { readonly config: Config; readonly tenantId: string },
): readonly DiscoveredContract[] {
  const passengers: AirPassenger[] = [];
  for (const f of files) {
    try {
      passengers.push(...parseAmadeusAir(f.text).passengers);
    } catch {
      // A file that will not parse is a parser finding, not a contract one.
    }
  }
  return discoverFromPassengers(passengers, opts);
}

/**
 * Turn one discovery into the rate table a contract form would be filled with.
 *
 * Only classes the tickets agreed on are included. A class where the claims
 * disagreed is deliberately left out rather than resolved by majority: the
 * whole point of a rate table is that somebody checked it against the letter,
 * and seeding it with the more popular of two wrong answers defeats that.
 */
export function proposedRates(
  d: DiscoveredContract,
): { readonly rates: Record<string, string>; readonly unresolved: readonly string[] } {
  const rates: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const c of d.classes) {
    if (c.rate) rates[c.rbd] = c.rate;
    else unresolved.push(c.rbd);
  }
  return { rates, unresolved };
}

/** A one-line summary for a console or a log. */
export function describeDiscovery(d: DiscoveredContract): string {
  const { rates, unresolved } = proposedRates(d);
  const table = Object.entries(rates).map(([k, v]) => `${k} ${v}%`).join(" ") || "none";
  return (
    `IATA ${d.iata} - ${d.carrier} - ${d.tickets} ticket(s) ${d.firstIssued}..${d.lastIssued} - ` +
    `${d.configured ? "configured" : `NOT CONFIGURED (${d.miss})`} - rates: ${table}` +
    (unresolved.length ? ` - disputed: ${unresolved.join(",")}` : "") +
    (d.flatClaims ? ` - ${d.flatClaims} flat-amount claim(s)` : "")
  );
}
