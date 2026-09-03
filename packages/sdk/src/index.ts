/**
 * The integration surface.
 *
 * One function in, plain JSON out. A CRM hands it the text of an AIR file and
 * gets back, per passenger, what the ticket is worth and whether that figure
 * can be trusted enough to write into a field.
 *
 * Everything here is deliberately boring:
 *
 *  - No I/O. The caller reads the file; this reads the text. That is what makes
 *    it usable from a queue worker, an HTTP handler, a browser, or a test.
 *  - No bigint, no Date, no class instances in the output. Money crosses the
 *    boundary as a decimal string, because a CRM will put it in JSON, a form
 *    field, or a database column, and every one of those wants a string.
 *  - `prefill` is null unless the calculation is one to act on. A number the
 *    caller must not use looks exactly like one it should, so the decision is
 *    made here rather than left to whoever writes the integration.
 */

import {
  calculate, formatMoney, journeyDestination, DEFAULT_GEO,
  type LayerResult, type Rule, type TicketDocument, type Waterfall,
} from "@commission/engine";
import {
  type Config, DEFAULT_TENANT, carrierRulesFor, compileSubAgentRules, seedConfig,
} from "../../engine/contracts/config.js";
import { parseAmadeusAir, parseStatementCsv } from "@commission/parsers";
import { settle, type SettlementRow } from "../../cli/src/statement.js";

export type { Config };
export { seedConfig, DEFAULT_TENANT };
export {
  discoverFromFiles, discoverFromPassengers, proposedRates, describeDiscovery,
  type DiscoveredContract, type ObservedClass,
} from "./discover.js";

/** Outcomes a caller may write into a commission field without asking anyone. */
const TRUSTWORTHY = new Set(["CALCULATED", "NIL"]);

/**
 * Whether the figure being offered is safe to write unattended.
 *
 * Two things beyond the outcome have to hold, and both were learned from a
 * real record — a ZRH–TLV reissue of a ticket that had already been
 * commissioned $100:
 *
 *  1. The layer being PAID must be the layer that settled. There the carrier
 *     layer resolved cleanly (a clawback of $100) while the sub-agent layer
 *     could not resolve its share at all. Reading the carrier's outcome and
 *     paying the sub-agent's number offered a confident $0.00 on a document
 *     where the answer was unknown.
 *
 *  2. A REVIEW flag disqualifies the document. The engine raises one when two
 *     signed contracts disagree — on that same record, that the host pays $100
 *     out of pocket. A number the engine has already said needs a human is not
 *     a number to bind to a form field.
 */
function isSafeToPrefill(w: Waterfall, paidLayer: LayerResult): boolean {
  if (!TRUSTWORTHY.has(paidLayer.outcome)) return false;
  return !w.flags.some((f) => f.code === "REVIEW" || !TRUSTWORTHY.has(f.code));
}

export interface PricedDocument {
  readonly ticketNumber: string;
  readonly passengerName: string | null;
  readonly documentType: string;
  readonly issueDate: string;
  readonly route: string;
  readonly bookingClasses: string;
  readonly currency: string;

  /** The fare the commission was computed on, as a decimal string. */
  readonly baseFare: string;
  readonly commissionableFare: string | null;
  /** What the consolidator earns from the carrier. */
  readonly carrierCommission: string;
  /** What the sub-agent earns after the retention; null when priced as the host. */
  readonly subAgentCommission: string | null;
  readonly hostSpread: string | null;

  /**
   * Fees the host charges on this document, signed from the sub-agent's view —
   * a charge is negative. Empty on a document priced as the host.
   */
  readonly fees: readonly {
    readonly ruleId: string;
    readonly clause: string | null;
    readonly label: string;
    readonly amount: string;
  }[];

  /**
   * What the sub-agent actually ends up with: their share less every fee.
   *
   * This is the figure that differs from `subAgentCommission` on exactly the
   * tickets that matter. A net or bulk fare earns no commission and costs a
   * flat fee by cabin, so the share reads 0.00 and the net reads -15.00. A
   * caller that shows the share alone is showing the wrong number.
   */
  readonly netToSubAgent: string | null;

  /**
   * The value to write into a commission field, or null.
   *
   * Null whenever the contract did not settle the question — no clause matched,
   * two matched equally, or the document was missing something a clause needed.
   * A caller that writes this without checking is still correct, because the
   * check has already happened.
   */
  readonly prefill: string | null;
  readonly outcome: string;

  /** What the source document itself claims, where it says. */
  readonly claimed: string | null;
  readonly claimedAs: "amount" | "percent" | null;

  readonly ruleId: string | null;
  readonly clause: string | null;
  /** One line a person can read: which clause decided this and why. */
  readonly explanation: string;
  readonly flags: readonly { readonly code: string; readonly message: string }[];
}

export interface PriceResult {
  readonly ok: boolean;
  /** Matched from the IATA number on the ticket, not chosen by the caller. */
  readonly consolidator: { readonly id: string; readonly name: string; readonly iata: string } | null;
  readonly iata: string | null;
  readonly documents: readonly PricedDocument[];
  /** Anything the reader could not resolve. Never fatal, always reported. */
  readonly warnings: readonly string[];
  readonly error: string | null;
}

export interface PriceOptions {
  readonly config: Config;
  /**
   * Which tenant is asking. Contract lookup is scoped by it, always: two
   * tenants may hold different contracts for the same IATA number, and neither
   * may ever price with the other's. Defaults to the single-agency tenant.
   */
  readonly tenantId?: string;
  /** Price as the sub-agent (default) or as the consolidator. */
  readonly view?: "subagent" | "host";
  /** Identifies the sub-agent in the rules; any stable string will do. */
  readonly subAgentId?: string;
}

function describe(w: Waterfall, ticket: TicketDocument): string {
  const clause = w.carrier.clause ? ` (${w.carrier.clause})` : "";
  switch (w.carrier.outcome) {
    case "NO_RULE":
      return "no clause in the configured contracts covers this document";
    case "AMBIGUOUS":
      return w.carrier.notes?.[0] ?? "two clauses match this document equally";
    case "INCOMPLETE":
      return w.carrier.notes?.[0] ?? "the document is missing something a clause needs";
    case "NIL":
      return `no commission is due${clause}`;
    default:
      return `${formatMoney(w.carrier.commission)} ${ticket.currency} due${clause}`;
  }
}

function rulesFor(opts: PriceOptions, iata: string | null): {
  rules: Rule[];
  consolidator: { id: string; name: string; iata: string } | null;
} {
  // Scoped by tenant, then IATA. The office is the owner of contracts, not the
  // agency: one host commonly holds several numbers with different terms on the
  // same airline, and each resolves to its own row.
  const tenantId = opts.tenantId ?? DEFAULT_TENANT;
  const found = iata
    ? opts.config.consolidators.find((c) => c.tenantId === tenantId && c.iata === iata)
    : undefined;
  if (!found) return { rules: [], consolidator: null };

  const subAgentId = opts.subAgentId ?? "subagent";
  const rules = opts.view === "host"
    ? carrierRulesFor(found)
    : [...carrierRulesFor(found), ...compileSubAgentRules(found, subAgentId)];
  return { rules, consolidator: { id: found.id, name: found.name, iata: found.iata } };
}

/**
 * Price every passenger on one AIR record.
 *
 * A record can carry several tickets, so the result is a list. A record the
 * reader cannot make sense of comes back with `ok: false` and a reason rather
 * than throwing: a feed that stops on one bad file is a feed that stops.
 */
export function priceAirFile(airText: string, opts: PriceOptions): PriceResult {
  let parsed;
  try {
    parsed = parseAmadeusAir(airText);
  } catch (e) {
    return {
      ok: false, consolidator: null, iata: null, documents: [],
      warnings: [], error: `this file could not be read: ${(e as Error).message}`,
    };
  }

  const iata = parsed.agencyIata;
  const { rules, consolidator } = rulesFor(opts, iata);
  const warnings = [...parsed.warnings];

  if (!consolidator) {
    warnings.push(
      iata
        ? `no consolidator is configured for IATA ${iata}, so nothing was priced`
        : "this document carries no IATA number, so no contract could be selected",
    );
  }

  const subAgentId = opts.view === "host" ? undefined : (opts.subAgentId ?? "subagent");

  const documents = parsed.passengers.map((p): PricedDocument => {
    const t = p.ticket;
    const route = t.coupons.length
      ? `${t.coupons[0].origin}–${journeyDestination(t.coupons, DEFAULT_GEO) ?? "?"}`
      : "no coupons";

    let w: Waterfall | null = null;
    let error: string | null = null;
    if (consolidator) {
      try {
        w = calculate({ ticket: t, rules, subAgentId });
      } catch (e) {
        error = (e as Error).message;
      }
    }

    const outcome = !consolidator ? "NO_CONTRACT" : w ? w.carrier.outcome : "ERROR";
    const payable = w
      ? (subAgentId ? (w.subAgent?.commission ?? w.carrier.commission) : w.carrier.commission)
      : null;

    return {
      ticketNumber: t.ticketNumber,
      passengerName: t.passengerName ?? null,
      documentType: t.documentType,
      issueDate: t.issueDate,
      route,
      bookingClasses: [...new Set(t.coupons.map((c) => c.rbd))].join("/"),
      currency: t.currency,

      baseFare: formatMoney(t.baseFare),
      commissionableFare: w?.carrier.basis ? formatMoney(w.carrier.basis) : null,
      carrierCommission: w ? formatMoney(w.carrier.commission) : "0.00",
      subAgentCommission: w?.subAgent ? formatMoney(w.subAgent.commission) : null,
      hostSpread: w ? formatMoney(w.hostSpread) : null,

      fees: (w?.fees ?? []).map((fee) => ({
        ruleId: fee.ruleId,
        clause: fee.clause ?? null,
        label: fee.label,
        amount: formatMoney(fee.amount),
      })),
      netToSubAgent: w && subAgentId ? formatMoney(w.netToSubAgent) : null,

      prefill:
        w && payable && isSafeToPrefill(w, subAgentId ? (w.subAgent ?? w.carrier) : w.carrier)
          ? formatMoney(payable)
          : null,
      outcome,

      claimed: p.reportedFM ? formatMoney(p.reportedFM.amount) : null,
      claimedAs: p.reportedFM?.kind ?? null,

      ruleId: w?.carrier.ruleId ?? null,
      clause: w?.carrier.clause ?? null,
      explanation: w
        ? describe(w, t)
        : error
          ? `this document could not be priced: ${error}`
          : "no contract is configured for the IATA number on this document",
      flags: (w?.flags ?? []).map((f) => ({ code: f.code, message: f.message })),
    };
  });

  return {
    ok: documents.length > 0,
    consolidator,
    iata,
    documents,
    warnings,
    error: documents.length === 0 ? "this file carried no ticket" : null,
  };
}

/** Price a whole folder's worth in one call. Order is preserved. */
export function priceAirFiles(
  files: readonly { readonly name: string; readonly text: string }[],
  opts: PriceOptions,
): readonly (PriceResult & { readonly file: string })[] {
  return files.map((f) => ({ file: f.name, ...priceAirFile(f.text, opts) }));
}

// ---------------------------------------------------------------------------
// The statement side
// ---------------------------------------------------------------------------

export interface StatementCheck {
  readonly ok: boolean;
  readonly rows: readonly {
    readonly ticketNumber: string;
    readonly reason: string;
    readonly severity: string;
    readonly expected: string;
    readonly stated: string | null;
    readonly variance: string;
    readonly explanation: string;
  }[];
  readonly totals: {
    readonly currency: string;
    readonly expected: string;
    readonly shortPaid: string;
    readonly missing: string;
    readonly overPaid: string;
    readonly unexplainedDeductions: string;
  };
  readonly warnings: readonly string[];
  readonly error: string | null;
}

/**
 * Check a consolidator's statement against the documents it should cover.
 *
 * The two halves are kept apart on purpose: what was earned is computed from
 * the tickets, what was paid is read from the statement, and this says only
 * where they differ. A caller that wants one number can add them up; a caller
 * chasing money wants the rows.
 */
export function checkStatement(
  statementCsv: string,
  airFiles: readonly { readonly name: string; readonly text: string }[],
  opts: PriceOptions,
): StatementCheck {
  const empty = {
    currency: "USD", expected: "0.00", shortPaid: "0.00",
    missing: "0.00", overPaid: "0.00", unexplainedDeductions: "0.00",
  };
  let statement;
  try {
    statement = parseStatementCsv(statementCsv);
  } catch (e) {
    return { ok: false, rows: [], totals: empty, warnings: [],
      error: `the statement could not be read: ${(e as Error).message}` };
  }

  const tickets: TicketDocument[] = [];
  const warnings = [...statement.warnings];
  let rules: Rule[] = [];
  for (const file of airFiles) {
    try {
      const parsed = parseAmadeusAir(file.text);
      if (rules.length === 0) {
        rules = rulesFor(opts, parsed.agencyIata).rules;
      }
      for (const p of parsed.passengers) tickets.push(p.ticket);
    } catch (e) {
      warnings.push(`${file.name}: ${(e as Error).message}`);
    }
  }

  if (rules.length === 0) {
    return { ok: false, rows: [], totals: empty, warnings,
      error: "no contract is configured for the IATA number on these documents" };
  }

  const result = settle({
    tickets, statement: statement.lines, rules,
    subAgentId: opts.subAgentId ?? "subagent",
  });

  const row = (r: SettlementRow) => ({
    ticketNumber: r.ticketNumber,
    reason: r.reason,
    severity: r.severity,
    expected: formatMoney(r.expected),
    stated: r.statedGross ? formatMoney(r.statedGross) : r.statedNet ? formatMoney(r.statedNet) : null,
    variance: formatMoney(r.variance),
    explanation: r.explanation,
  });

  return {
    ok: true,
    rows: result.rows.map(row),
    totals: {
      currency: result.totals.expected.currency,
      expected: formatMoney(result.totals.expected),
      shortPaid: formatMoney(result.totals.shortPaid),
      missing: formatMoney(result.totals.missing),
      overPaid: formatMoney(result.totals.overPaid),
      unexplainedDeductions: formatMoney(result.totals.unexplainedDeductions),
    },
    warnings: [...warnings, ...result.warnings],
    error: null,
  };
}
