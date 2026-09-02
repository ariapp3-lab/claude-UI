# @commission/cli

Price a folder of documents against a contract.

```
npm run reconcile -- <folder> [--all] [--csv out.csv] [--json out.json]
```

Reads every file in the folder, parses what it can, prices each document, and
prints the queue a human works through. Files it cannot parse are reported,
never skipped silently. Exits non-zero when money is at stake, so it can gate a
filing step in a script.

```
COMMISSION RECONCILIATION
════════════════════════════════════════════════════════════════════
  Documents priced                           7
  Fare value                          29951.75   USD, base fare
  Commission claimed                    196.98
  Commission entitled                     0.00

  Forfeited to an exclusion             104.72   recoverable if corrected
  Owed back on reissues                -100.00   the replaced ticket earned more
  Earned nothing at all                      4   bulk fares sold at cost

ticket          doc  cls  fare type     claimed  entitled  at stake  finding
114-7503646565  TKT  S    published      119.68      0.00    104.72  FORFEITED
                EWR–TLV · 2026-08-01 · 104.72 forfeited (§14) — blocked only by tourCode
```

## Reasons

| Reason | Meaning |
| --- | --- |
| `FORFEITED` | The document would have earned, but an exclusion clause bit |
| `CLAWBACK` | A reissue nets negative — the replaced ticket earned more |
| `NOT_ENTITLED` | Commission claimed where the contract pays nothing |
| `OVERCLAIMED` / `UNDERCLAIMED` | Claimed against a different figure than the contract gives |
| `UNCLAIMED` | Entitled, and nothing was claimed |
| `NO_REVENUE` | Bulk fare sold at cost: no commission, and no markup either |
| `MARKUP` | Net fare — revenue is the markup, no commission due |
| `AGREES` | The claim matches the contract |
| `NO_RULE` / `AMBIGUOUS` / `INCOMPLETE` | The engine declined to produce a number |

## The counterfactual

Where a document earns nothing, the reconciler answers *what is this clause
costing us* — without anyone re-keying the ticket.

Two things stand between a document and its commission, and both have to be set
aside to see the figure: an exclusion clause that wins outright (a missing tour
code asserts nil), and the paying clause's own conditions, which usually fail
for the same reason. Lifting only the exclusion is not enough — the tour-code
condition still sits on the clause that pays.

So the reconciler drops winning nil clauses, finds the paying clause that comes
closest, waives the few conditions it failed on, and prices it. **Every waiver
is named in the finding.** The cap matters: waive enough conditions and any
document can be made to look entitled, which would be a lie dressed as a
finding.

Revenue model is decided before any counterfactual runs. A fare sold net is not
forfeiting commission — it was never on the commission model.
