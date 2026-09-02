# @commission/engine

Deterministic airline commission calculation for host agencies and sub-agents.
Implements §3–§6 and §12 of [`docs/commission-engine-spec.html`](../../docs/commission-engine-spec.html).

## What it guarantees

- **No floating point.** Every amount is a `bigint` of currency minor units.
  `parseMoney("2140.00", "USD")`, never `2140.0`.
- **No clock, no I/O, no randomness.** The same ticket and rule set produce the
  same waterfall forever, so any past figure can be reproduced and any fix can
  be replayed over history before it is applied.
- **`share + spread === carrier commission`,** to the minor unit, always. The
  host spread is computed by subtraction rather than as a second percentage, so
  two roundings can never disagree.
- **Nothing is inferred.** A missing clause is `NO_RULE`, an unknown airport is
  `INCOMPLETE`, and two clauses tied on specificity are `AMBIGUOUS`. None of
  them is silently zero.

## Usage

```ts
import { calculate, explain } from "@commission/engine";

const waterfall = calculate({ ticket, rules, subAgentId: "sa_4471" });

waterfall.carrier.commission;  // Money — what the carrier owes the host
waterfall.subAgent.commission; // Money — the sub-agent's share
waterfall.hostSpread;          // Money — what the host keeps
waterfall.netToSubAgent;       // Money — share less fees charged
waterfall.flags;               // anything a human must look at

console.log(explain(waterfall));
```

```
Ticket 114-2401234567   USD
──────────────────────────────────────────────
  Base fare                            2140.00
× YQ                                    386.00
× US                                     45.80
× AY                                     11.20
× XF                                      4.50
× IL                                    296.80
  Ticket total                         2884.30
──────────────────────────────────────────────
  Commissionable basis                 2140.00
  Carrier commission                    171.20
  Sub-agent share                       149.80
  Host spread                            21.40
──────────────────────────────────────────────
  NET TO SUB-AGENT                      149.80

Rule: LY-US-IL-J-2026H1 §4.2(a)
Excluded from basis: YQ 386.00, US 45.80, AY 11.20, XF 4.50, IL 296.80
```

The `×` column is the point of the whole exercise: it shows that YQ 386.00 was
seen and deliberately excluded, and cites the clause that excluded it. Had YQ
been commissionable, the answer would have been 202.08 rather than 171.20.

## Layout

| File | Responsibility |
| --- | --- |
| `money.ts` | Exact integer arithmetic, parsing, rounding modes, weighted allocation |
| `types.ts` | The canonical ticket and rule model |
| `geo.ts` | Airport → country → region, and journey turnaround resolution |
| `match.ts` | Rule evaluation, condition traces, priority/specificity selection |
| `calculate.ts` | The two-layer waterfall |
| `explain.ts` | Human-readable rendering — a test surface, not a convenience |

## Tests

```
npm test
```

Three suites, 50 assertions:

- `money.test.ts` — exactness, rounding modes, allocation invariants
- `engine.test.ts` — the specification's worked examples, reproduced to the cent
- `invariants.test.ts` — properties over 500 generated tickets per case, plus a
  4,000-ticket batch that must reconcile exactly (a half-cent bias is invisible
  on one ticket and $20 a week at real volume)

## Not yet implemented

Refund and exchange netting, ADM handling, PLB period settlement, and the
ingestion adapters. `plb` awards are computed as accruals and deliberately kept
out of the per-ticket payable figure. See §13 of the specification.
