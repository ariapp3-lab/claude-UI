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

## The sub-agent side

A sub-agent's economics are the revenue share *minus* the host's fee schedule.
Both are modelled as ordinary rules, so an exchange is charged an exchange fee
by the same machinery that awards commission.

**How the split is worded matters.** These are not the same agreement:

| Mode | Wording | At carrier 8% | At carrier 6% |
| --- | --- | --- | --- |
| `points` | "you get 7" | 149.80 | **149.80** — more than the host earned; flagged |
| `residual` | "I keep 1" | 149.80 | 107.00 — host still keeps exactly one point |

`residual` is self-correcting and cannot promise more than the carrier granted.
`points` is what most agreements literally say, so the engine computes it as
written and flags the conflict rather than choosing a winner.

**Fees** are gated on document type, so they fire on the transaction they
belong to:

```ts
{ match: { documentType: { in: ["EXCH"] } },
  award: { kind: "fee", amount: "25.00", currency: "USD" } }

{ match: {},                                    // every transaction
  award: { kind: "fee", rate: "2.50",           // merchant account charge
           basisOf: "ticket_total", minimum: "5.00" } }
```

Fees stack — every matching clause applies, they are not exclusive. Percentage
fees are taken on the magnitude, so a refund still costs the sub-agent its
processing charge rather than handing one back.

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

## Lifecycle

A ticket is not a row. Void, refund and reissue each reverse part of what an
earlier document recognised, and the engine takes that figure from the source
document rather than recomputing it — or says it could not.

| Event | Behaviour |
| --- | --- |
| **Void** | Reverses the whole commission. The sale never happened. |
| **Full refund** | Reverses the whole commission at the original figure. |
| **Partial refund** | Reverses the refunded share only, split with `allocate` so the refunded and retained parts always sum back to the original. |
| **Penalty** | Excluded from the refunded fare. It is fare the carrier keeps, so the commission on it stands. |
| **Reissue** | Commission on the new fare, less what the replaced ticket already earned. `added_collection_only` and `full_fare` are supported where a contract says so. |

Each of these returns `INCOMPLETE` rather than a number when the document does
not say what the earlier one earned. Assuming zero is exactly what produces a
double payment.

## Not yet implemented

ADM/ACM handling and PLB period settlement. `plb` awards are computed as
accruals and deliberately kept out of the per-ticket payable figure. See §13 of
the specification.
