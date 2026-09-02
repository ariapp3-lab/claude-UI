# @commission/parsers

Source adapters. Each one reads a file format and produces a canonical
`TicketDocument`; nothing downstream knows where a ticket came from.

## Amadeus AIR

```ts
import { parseAmadeusAir } from "@commission/parsers";
const { ticket, markup, reportedFM, warnings } = parseAmadeusAir(text);
```

Reads the elements that bear on commission and carries the rest through in
`raw`. It **reports rather than defaults**: anything it could not read lands in
`warnings` for a human, because a defaulted field in a commission calculation is
a wrong number wearing a confident face.

| Element | Read as | Note |
| --- | --- | --- |
| `T-` | ticket number | |
| `A-` | validating carrier | |
| `B-` | document type | `TTP/EXCH` → reissue, `TTP/RFND` → refund |
| `D-` | issue date | **second field**, the ticketing date — see below |
| `H-` | coupons | origin, destination, carrier, flight, RBD, dates |
| `M-` | fare basis | positional, one per coupon |
| `KS-` / `KN-` | selling and net fare | a gap between them is a net fare |
| `K-B` | fare | exchanges carry one fare line, not a pair |
| `KSTB` / `KNTB` / `KFTB` | itemised taxes | the authoritative tax stack |
| `TAX-` | *ignored* | aggregates small taxes into XT |
| `Q-` | fare calculation | also the `M/BT` bulk-fare marker |
| `FT` | tour code | absence is a finding, not a blank |
| `FM` | commission or markup as recorded | |
| `FO` | the ticket being replaced | original fare, tax and commission |
| `RM*EXA*` | additional collection | |
| `RI` | airline change fee | kept out of the fare |

### Six things that are easy to get wrong

Each of these was found by a real ticket, not by reading a spec.

**The `D-` element carries three dates.** Creation, ticketing, invoice. On a
straight issue they are identical, which hides the problem; on a reissue they
are not — one sample was created 30 Aug and ticketed 2 Sep. Commission turns on
the *ticketing* date, so the second field governs. The parser cross-checks it
against the `TK` element and warns if they disagree.

**`TAX-` is not the tax stack.** It aggregates small taxes into a single `XT`
line — 103.40 standing in for nine separate codes. A rule that names a tax code
cannot see through it. The `KSTB`/`KNTB`/`KFTB` breakdown is the real thing.

**The digits after `H-` are not coupon numbers.** They are Amadeus element
references (`010`, `021`, `006`). Coupons are numbered by the order they appear.

**`U-` elements look exactly like coupons and are not.** They are waitlisted or
unconfirmed segments (`RQ`/`HL`) that were never ticketed. One sample carries a
single ticketed coupon alongside four waitlisted ones — counting them would
price the ticket five times over.

**Line shapes vary.** The fare line is `KS-`/`KN-` on a straight issue, `K-B` on
one exchange and `K-F` on another; the tax breakdown is `KSTB`, `KNTB`, `KFTB`
*or* `KFTF`. Matching a single literal loses the fare or the entire tax stack
silently.

**`FM` is a percentage as often as an amount.** `FM*G*2475.75A` is a sum of
money; `FM*M*5` is five per cent. The trailing `A` is the only thing that
distinguishes them, and reading one as the other is wrong by three orders of
magnitude.

**Several `RI` lines can appear, and the first is not the fee.** On a reissue
the first is the credit for the exchanged ticket, as a negative amount. The
change fee has to be matched by its description.

### Exchanges

The `FO` element is the reason reissues are tractable at all:

```
FO114-7507683087EWR30AUG26/33535983/114-75080510872E1*B2022.00/X117.00/C0.00
   └─ replaced ticket                                  base ──┘   tax ──┘  comm ──┘
```

`originalBase` and `originalCommission` are what a reissue must net against.
Without them, commission is paid twice on the fare carried over from the
original ticket.
