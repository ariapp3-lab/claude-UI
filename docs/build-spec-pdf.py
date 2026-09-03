"""Build docs/commission-module-spec.pdf — the developer's integration spec.

Run from the repository root:  python3 docs/build-spec-pdf.py
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    KeepTogether, SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

INK = colors.HexColor("#14181d")
MUTED = colors.HexColor("#5b6672")
RULE = colors.HexColor("#d4dae0")
ACCENT = colors.HexColor("#0f5c4a")
BAND = colors.HexColor("#eef2f4")
WARN = colors.HexColor("#8a4b12")
GOOD = colors.HexColor("#14663f")

ss = getSampleStyleSheet()


def S(name, **kw):
    return ParagraphStyle(name, parent=ss["Normal"], **kw)


Title = S("T", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=INK, spaceAfter=4)
Sub = S("Sb", fontName="Helvetica", fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=2)
H1 = S("H1", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=ACCENT,
       spaceBefore=13, spaceAfter=6)
H2 = S("H2", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=INK,
       spaceBefore=11, spaceAfter=4)
Body = S("B", fontName="Helvetica", fontSize=9.6, leading=14.2, textColor=INK,
         spaceAfter=7, alignment=TA_LEFT)
Small = S("S", fontName="Helvetica", fontSize=8.6, leading=12.4, textColor=MUTED, spaceAfter=6)
Mono = S("M", fontName="Courier", fontSize=8.4, leading=12.4, textColor=INK)
Cell = S("C", fontName="Helvetica", fontSize=8.5, leading=11.6, textColor=INK)
Head = S("HD", fontName="Helvetica-Bold", fontSize=8.3, leading=11, textColor=colors.white)


def table(rows, widths, head=True, zebra=True, gap=8):
    """A table, plus trailing space so the next paragraph never abuts it."""
    data = [
        [c if isinstance(c, Paragraph) else Paragraph(str(c), Head if (head and i == 0) else Cell)
         for c in r]
        for i, r in enumerate(rows)
    ]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]
    if head:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                 ("LINEBELOW", (0, 0), (-1, 0), 0, colors.white)]
    if zebra:
        start = 1 if head else 0
        for i in range(start, len(data)):
            if (i - start) % 2 == 1:
                cmds.append(("BACKGROUND", (0, i), (-1, i), BAND))
    t.setStyle(TableStyle(cmds))
    return [t, Spacer(1, gap)]


def code(lines, gap=10):
    body = [[Paragraph(l.replace(" ", "&nbsp;") or "&nbsp;", Mono)] for l in lines]
    t = Table(body, colWidths=[6.9 * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f6f8f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return [t, Spacer(1, gap)]


def callout(text, tone=WARN, gap=10):
    fill = colors.HexColor("#fdf5ec") if tone is WARN else colors.HexColor("#eef5f1")
    edge = colors.HexColor("#c98432") if tone is WARN else ACCENT
    p = Paragraph(text, S("N", fontName="Helvetica", fontSize=8.8, leading=12.8, textColor=tone))
    t = Table([[p]], colWidths=[6.9 * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return [t, Spacer(1, gap)]


note = callout


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(0.85 * inch, 0.62 * inch, LETTER[0] - 0.85 * inch, 0.62 * inch)
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.85 * inch, 0.45 * inch,
                      "Commission & Consolidator Payouts - module specification")
    canvas.drawRightString(LETTER[0] - 0.85 * inch, 0.45 * inch, "Page %d" % doc.page)
    canvas.restoreState()


P = lambda t, st=Body: [Paragraph(t, st)]
F = []

# --------------------------------------------------------------------- cover
F += [Spacer(1, 6)]
F += P("Commission &amp; Consolidator Payouts", Title)
F += P("Module specification for CRM integration", Sub)
F += P("A. Appel and Co - sub-agent under Main St. Travel (IATA 33535983)", Small)
F += [Spacer(1, 10)]

F += P(
    "This module answers one question on every ticket: <b>how much will the host agency's "
    "cheque be, and is it right.</b> It reads the ticket, finds the contract that governs it, "
    "computes the figure, and pre-fills the commission field. Once a week the host's statement "
    "is uploaded and the module reconciles what was paid against what was owed.")

F += P(
    "It is built as a <b>pure function</b>: text in, JSON out. No database calls, no clock, no "
    "network. The same ticket always produces the same number, and the same code runs inside "
    "the CRM, in a queue worker, in an Edge Function, and in tests.")

F += P(
    "Everything here has been checked against real documents - two signed contracts, a real "
    "weekly statement, and real AIR files. Where a rule is inferred rather than stated, it says "
    "so. Where a real document contradicted an earlier assumption, the contradiction is recorded "
    "rather than quietly corrected, because the same mistake is easy to make twice.")

F += P("Scope for the first build", H1)
F += P(
    "<b>EL AL (LY) under Main St. Travel only.</b> That is where the volume is, and one airline "
    "under one host proves the whole path end to end. The data model already keys on tenant, "
    "host and airline, so a second host is new rows rather than a rewrite - but do not build ten "
    "before one works.")

# --------------------------------------------------------------------- 1
F += P("1 - The three figures", H1)
F += P("Every ticket produces three numbers, in this order. They must not be collapsed into one.")

F += table([
    ["#", "Figure", "What it is"],
    ["1", "<b>Commission</b>",
     "What the airline pays, less the host's share. Zero on a net or bulk fare, and zero on a "
     "published fare that fails a contract condition."],
    ["2", "<b>Fees</b>",
     "What the host charges: per exchange, per refund, on a net fare, on a ticket that earned "
     "nothing. Always negative."],
    ["3", "<b>Markup</b>",
     "On a net fare, the agent's own margin - selling fare less net fare. It is the agent's "
     "commission on that ticket, self-set inside a ceiling the airline permits."],
], [0.3 * inch, 1.15 * inch, 5.45 * inch])

F += P("The cheque", H2)
F += code(["    cheque  =  commission  +  markup  -  fees"])

F += P(
    "<b>The markup belongs in the cheque.</b> The whole ticket, markup included, is collected "
    "under the host's accreditation and settles to them - so the markup is not money the agent "
    "already holds, it is money the host is holding on the agent's behalf and has to remit. From "
    "the agent's side there is one figure, and this is it.")

F += note(
    "<b>The single most expensive thing to get wrong.</b> Reconciling a statement against the "
    "COMMISSION alone reports every marked-up bulk ticket as paid-where-nothing-was-due, and a "
    "bulk ticket missing from the statement as agreement rather than a shortfall. On the sample "
    "batch that is the difference between an expected total of $89.76 and $3,245.26 - the gap is "
    "markup being silently written off. Reconcile against the cheque.")

F += P("Worked, on real tickets", H2)
F += table([
    ["Ticket", "Fare", "Base", "Commission", "Fee", "Markup", "<b>Cheque</b>"],
    ["bulk business", "net", "12,378.75", "0.00", "-123.79", "2,475.75", "<b>2,351.96</b>"],
    ["marked-up economy", "net", "3,398.75", "0.00", "-33.99", "679.75", "<b>645.76</b>"],
    ["published S", "published", "1,496.00", "0.00", "-10.00", "0.00", "<b>-10.00</b>"],
    ["exchange", "net", "3,707.00", "0.00", "-25.00", "0.00", "<b>-25.00</b>"],
], [1.35 * inch, 0.72 * inch, 0.85 * inch, 1.0 * inch, 0.78 * inch, 0.85 * inch, 0.85 * inch])

F += P("A ticket can be <b>negative</b>: it earned no commission and still cost a fee. That is a "
       "real outcome, not an error, and the UI has to show it.")

# --------------------------------------------------------------------- 2
F += P("2 - Net fares: the rule that governs them", H1)
F += P("On a net fare the airline files a fare it will accept and lets the agent sell above it. "
       "The agent's margin is their commission on that ticket. The host's fee follows one "
       "principle:")

F += note(
    "<b>The host cannot be worse off because the agent chose to issue net.</b> Whatever the host "
    "would have earned had the same fare gone out published with commission, they earn. The "
    "agent's choice of how to take their margin is theirs, and it is not allowed to cost the "
    "host anything.")

F += P("So the host's fee on a net fare is <b>the higher of</b> the point they keep on a "
       "published fare and a flat figure by cabin. The cabin figure is a FLOOR, not the fee.")

F += code([
    "  net fare fee = max( published-fare point x base fare,  cabin floor )",
    "",
    "  12,378.75 business:  1% = 123.79   floor 50   ->  123.79",
    "     900.00 economy:   1% =   9.00   floor 15   ->   15.00",
])

F += P("Reading the cabin figure as the fee rather than as a floor understates the host on every "
       "large fare - $50 where $123.79 is owed on the sample business ticket - and would have "
       "the reconciler reporting the host's own correct deduction as an unexplained one.")

F += P("The markup ceiling", H2)
F += P(
    "The airline permits a markup up to a limit, which varies by fare. Where that limit is known "
    "and configured, the module reports the markup as a percentage and the <b>headroom</b> left "
    "under it. Headroom is the one loss no statement can show: marking up 10% where 25% was "
    "permitted leaves money behind, nobody short-paid anything, and reconciliation says AGREES. "
    "An unconfigured ceiling reports as <b>unknown</b>, never as zero.")

F += P("Reading the markup from the file", H2)
F += P(
    "Amadeus records it in the FM element as <code>FM*G*679.75A</code>. Those digits match the "
    "commission-amount pattern exactly, so <b>the <code>*G*</code> must be tested first</b> - "
    "otherwise the agent's own margin is filed as commission the host owes, and every marked-up "
    "ticket reports a shortfall. Cross-check against selling base less net base "
    "(<code>KS-</code> less <code>KN-</code>): the two are independent and must agree. On both "
    "real records they agree exactly.")

# --------------------------------------------------------------------- 3
F += P("3 - Finding the contract", H1)
F += P(
    "Every ticket carries the IATA number it was issued under. <b>The IATA number owns the "
    "contract, not the agency</b> - one host commonly holds several numbers with different rates "
    "on the same airline. The MST agreement says so itself: \"PNRs created under one of MST's "
    "affiliate offices in order to access higher contracted commission levels.\"")

F += table([
    ["#", "Step", "If it fails", "What that means"],
    ["1", "Tenant", "reject", "Never price across tenants"],
    ["2", "IATA on the ticket", "<b>no_iata</b>", "Nothing to match on"],
    ["3", "Office for that IATA", "<b>unknown_iata</b>", "A contract to go and get"],
    ["4", "Contract for the airline", "<b>no_carrier</b>", "A contract to negotiate"],
    ["5", "Ticketing date in window", "<b>outside_window</b>", "A renewal"],
    ["6", "Clause: route, class, fare type, tour code", "<b>NO_RULE</b>",
     "Contract held, nothing covers this"],
], [0.3 * inch, 2.35 * inch, 1.35 * inch, 2.9 * inch])

F += P("Steps 1-5 are the <b>fallback</b>: no contract could be chosen, so no figure is written. "
       "Step 6 is different - a contract exists and no clause covers the ticket.")

F += note(
    "<b>NIL and NO_RULE must never merge.</b> NIL means a clause asserted zero - EL AL forfeits "
    "commission when the mandatory tour code is missing, and that is a settled answer. NO_RULE "
    "means nobody has worked it out. Both display as $0.00; only NIL may be written into a "
    "field. Merging them books zero on tickets that were actually owed money.")

F += P("The folder is not all yours", H2)
F += P(
    "In a 15-file sample drawn from the live airfile folder, <b>9 belonged to a different "
    "agency</b> - IATA 33770903, a separate travel business, with its own passengers and its own "
    "contracts. Any total computed across the folder without filtering by IATA is wrong, and "
    "wrong in a direction that looks plausible. <b>Filter by IATA before anything else.</b>")

F += P("Bootstrapping from the files", H2)
F += P(
    "<code>discoverFromFiles()</code> groups incoming documents by IATA and carrier and reports "
    "ticket counts, date ranges, fare types, tour codes, and the rates actually claimed per "
    "booking class - flagging each group as configured or not. Use it to populate the contract "
    "table from history, and to see at a glance which IATA numbers are in the folder.")

F += P(
    "It proposes a rate only where <b>every</b> ticket in a class agreed on one. Where they "
    "disagree it reports the disagreement instead: what an agent claimed is evidence, not a "
    "contract, and seeding a table with the more popular of two wrong answers would encode the "
    "mistake as policy and reconcile against it forever.")

# --------------------------------------------------------------------- 4
F += P("4 - Data model", H1)
F += P("Everything is editable, contracts are uploadable, and every query is scoped by tenant.")

F += table([
    ["Table", "Key columns"],
    ["<b>tenant</b>", "id, name. Every query below is scoped by tenant_id."],
    ["<b>office</b>",
     "id, tenant_id, <b>iata</b> (the join key, unique per tenant), name, agency (label grouping "
     "several offices under one host), retains_points, fee_schedule"],
    ["<b>carrier_contract</b>",
     "id, office_id, <b>carrier</b>, issued_from, issued_to, rates (JSON: class -&gt; percent), "
     "include_yq, required_tour_code, origin_in, scope, max_markup_percent, markup_basis, files[]"],
    ["<b>host_agreement</b>",
     "id, office_id, the fee schedule: per-fare-type splits and the fee rows (exchange, refund, "
     "net fare by cabin, non-commissionable). Each row carries <b>approved: boolean</b>."],
    ["<b>ticket_document</b>",
     "One row per passenger per document: ticket number, type, issue date, carrier, iata, base "
     "fare, net fare, taxes, coupons, fare type, tour code, plus the computed commission, fees, "
     "markup, cheque and outcome."],
    ["<b>statement_line</b>",
     "One row per line of an uploaded statement: <b>invoice number</b>, ticket number (usually "
     "null), passenger, vendor, invoice date, travel date, itinerary, signed amount, remark."],
], [1.4 * inch, 5.5 * inch])

F += note(
    "<b>Keep the <code>approved</code> flag.</b> Clauses that depend on facts an AIR file does "
    "not carry - corporate bookings, promotional net fares, discretionary minimum fees - are "
    "encoded but left unapproved, so the engine surfaces them as exposure rather than booking "
    "them as certainty. An unapproved clause never spends.")

# --------------------------------------------------------------------- 5
F += P("5 - The pre-fill rule", H1)
F += P("The module returns <code>prefill</code>: a decimal string, or <code>null</code>. "
       "<b>Bind it straight to the field.</b> The decision about whether a number is safe to "
       "write has already been made.")

F += table([
    ["Outcome", "prefill", "Meaning"],
    ["CALCULATED", "the amount", "A clause matched and produced a figure"],
    ["NIL", "0.00", "A clause asserted nothing is due - a settled answer"],
    ["NO_RULE", "null", "Contract held, no clause covers this ticket"],
    ["AMBIGUOUS", "null", "Two clauses matched equally. Never guessed"],
    ["INCOMPLETE", "null", "A clause needed something the document lacked"],
    ["NO_CONTRACT", "null", "No contract for this IATA - the fallback"],
    ["ERROR", "null", "Could not be priced at all"],
], [1.15 * inch, 0.85 * inch, 4.9 * inch])

F += P("Two further conditions suppress a pre-fill even on a good outcome:")

F += table([
    ["Condition", "Why"],
    ["The layer being paid must be the layer that settled",
     "On a Zurich-Tel Aviv reissue the carrier layer resolved cleanly (a $100 clawback) while "
     "the sub-agent layer could not resolve its share. Reading one and paying the other offered "
     "a confident $0.00 on an open question."],
    ["No REVIEW flag on the document",
     "REVIEW is raised when two signed contracts disagree - on that same ticket, that the host "
     "pays $100 out of pocket. A figure already flagged for a human is not one to bind to a "
     "field."],
], [2.15 * inch, 4.75 * inch])

F += P("Every result carries <code>explanation</code>, <code>clause</code> and "
       "<code>ruleId</code>. Show the explanation beside the field. A number the agent cannot "
       "trace to a line of the contract is one they cannot dispute, which defeats the point.")

# --------------------------------------------------------------------- 6
F += P("6 - The weekly statement", H1)
F += P(
    "This section was rewritten after reading a real one. Every assumption the first version "
    "made about the format was wrong.")

F += note(
    "<b>It is not a commission statement. It is an accounts ledger.</b> One line per thing the "
    "host billed or credited, and the balance at the foot is the payout. On the statement read "
    "here: 149 lines, 141 invoices, charges $1,643.00, credits -$32,162.65, "
    "<b>payout -$30,519.65</b>.")

F += P("Three facts about the format", H2)
F += table([
    ["#", "Fact", "Consequence"],
    ["1", "<b>The key is the INVOICE number, not the ticket number.</b> 11 of 149 lines carry a "
     "ticket number and every one of those 11 is $0.00 - they are the airline's own issue "
     "records. Every line carrying money has no ticket number at all.",
     "A reconciler matching on ticket number matches <b>nothing</b>. See §7."],
    ["2", "<b>Sign carries the meaning.</b> Negative is a credit the host owes the agent - "
     "markup and commission. Positive is the host's fee.",
     "Sum the signed amounts; a negative total is what the host owes."],
    ["3", "<b>One invoice can carry several lines</b>, and the host nets them itself, printing a "
     "subtotal on a line of its own. A $50 credit against a $25 exchange fee prints as -$25.00.",
     "Subtotal lines are restatements, not transactions. Counting them double-counts."],
], [0.3 * inch, 3.5 * inch, 3.1 * inch])

F += P("Parsing it", H2)
F += P(
    "A fixed-width report, two lines per invoice, six pages - each page carrying its own header "
    "at <b>different column offsets</b>, and rows that do not reliably align to their own page's "
    "header. So fields are recovered by what they are, not where they sit: a ticket number is a "
    "run of digits at the front, a date is a date, the passenger carries a \"/\", the vendor is "
    "what sits between them.")

F += callout(
    "<b>Validate against the statement's own bottom line.</b> The reader sums its lines to "
    "exactly the balance the statement prints at its foot, -$30,519.65, with no warnings. That "
    "is a check against arithmetic nobody on our side did, and it is what makes every other "
    "figure believable. Keep this assertion in the test suite.", GOOD)

F += P("Two bugs it caught, both of which produced plausible wrong numbers rather than errors: "
       "\"Total Open\" and \"Account Balance\" each restate the balance, and counting them as "
       "transactions <b>tripled</b> the payout to -$91,558.95; and 8/16/2026 was being read as "
       "the 8th of the 16th month.")

# --------------------------------------------------------------------- 7
F += P("7 - Matching tickets to statement lines", H1)
F += P(
    "This is the hardest part of the module and the part most likely to be got wrong quietly. "
    "The statement's money lines carry <b>no ticket number</b>, so the join has to be made on "
    "what is there: passenger, itinerary and travel date.")

F += P("The matching rule", H2)
F += code([
    "  match  =  surname equal",
    "            AND travel date equal",
    "            AND given name compatible (statement truncates it)",
    "",
    "  no confident match  ->  report as unmatched, never guess",
])

F += callout(
    "<b>Surname alone is not enough, and the failure is silent.</b> A first pass matching on "
    "surname produced eleven \"discrepancies\" on eight tickets: Klein/Joel paired with "
    "Klein/Esther, Landau/David with a different Landau trip, Raab against a booking from a "
    "month earlier. All false. Adding the travel date cut it to two confident matches and three "
    "honest gaps. <b>Two real findings beat eleven that fall apart when checked.</b>")

F += P("What the first real reconciliation found", H2)
F += P("Eight of the agent's tickets fell inside the statement period. Two matched a statement "
       "line confidently. <b>Both disagreed with the contract, and in the same direction.</b>")

F += table([
    ["Passenger", "Ticket", "Cls", "Fare", "Contract says", "MST charged", "Gap"],
    ["AHARONI/SHOSHAN", "…4473", "I", "6,085.00", "-10.00", "<b>-50.00</b>", "<b>40.00</b>"],
    ["AHARONI/YEHUDA", "…4478", "Q", "2,714.00", "-10.00", "<b>-30.00</b>", "<b>20.00</b>"],
], [1.5 * inch, 0.72 * inch, 0.42 * inch, 0.9 * inch, 1.15 * inch, 1.05 * inch, 0.66 * inch])

F += P(
    "Both are <b>published</b> fares (<code>K-F</code>, no <code>SIAB;;BT</code>) that earned no "
    "commission for want of the tour code. The schedule prices that at a flat <b>$10</b>. MST "
    "charged <b>$50</b> and <b>$30</b> - which are exactly the schedule's <i>net-fare cabin</i> "
    "figures ($30 premium, $50 business).")

F += note(
    "<b>Open question, and the most valuable one in this document.</b> Either MST applies the "
    "cabin fees to published fares too, or the net-fare row is being read wrongly, or these are "
    "net fares the AIR file does not mark. It is $60 on two tickets - but it is a rule that "
    "applies to <b>every zero-commission ticket</b>, and none of the sampled tickets carry the "
    "tour code. Put this to MST before phase 2.")

F += P("Six of the agent's tickets had no statement line at all - three children on one family "
       "booking (the fourth passenger was billed), and three passengers on another. On the "
       "current reading those cost $10 each, so not being billed is $60 <i>in the agent's "
       "favour</i>. The fee is not being applied consistently in either direction, which is "
       "itself the finding.")

# --------------------------------------------------------------------- 8
F += P("8 - Reconciliation output", H1)
F += P("Each line lands in exactly one of eight states. Nothing is dropped: a statement line "
       "matching no ticket, and a ticket on no line, are both findings.")

F += table([
    ["Status", "Severity", "Meaning", "Action"],
    ["<b>SHORT_PAID</b>", "critical", "Paid less than the contract gives", "Claim the difference"],
    ["<b>NOT_ON_<br/>STATEMENT</b>", "critical", "Owed, and the statement omits it",
     "Claim in full"],
    ["OVER_PAID", "warning", "Paid more than the contract gives", "Expect a clawback"],
    ["PAID_WHERE_<br/>NONE_DUE", "warning", "Paid on a document owed nothing",
     "Verify before spending"],
    ["NOT_IN_TICKETS", "warning", "Paid for a document not in our records", "Investigate"],
    ["DEDUCTION", "warning", "A fee withheld no agreement covers", "Query the fee"],
    ["<b>UNMATCHED</b>", "warning", "No confident join to a ticket", "Match by hand"],
    ["AGREES / CORRECTLY_NIL", "ok", "Both sides agree", "-"],
], [1.35 * inch, 0.65 * inch, 2.75 * inch, 1.75 * inch])

F += P("Excel export", H2)
F += P("One row per ticket, sorted <b>worst first</b>. <code>Variance</code> is the money column; "
       "negative means underpaid. Red fill on negative, amber on positive, freeze the header.")

F += table([
    ["Column", "Example", "Column", "Example"],
    ["Status", "OVER_CHARGED", "Commission", "0.00"],
    ["Ticket", "114-7504084473", "Fees", "-10.00"],
    ["Passenger", "AHARONI/SHOSHAN", "Markup", "0.00"],
    ["Travel date", "2026-08-05", "<b>Cheque due</b>", "<b>-10.00</b>"],
    ["Route", "MIA-TLV", "MST invoice", "10109752"],
    ["Class / fare", "I / published", "MST amount", "-50.00"],
    ["Base fare", "6085.00", "<b>Variance</b>", "<b>-40.00</b>"],
    ["Match basis", "surname+date", "Why", "nil: tour code required"],
], [0.95 * inch, 1.55 * inch, 1.15 * inch, 2.35 * inch])

F += P("Add a totals row splitting variance into <i>short-paid</i>, <i>over-charged</i>, "
       "<i>missing</i> and <i>unexplained deductions</i>, plus a count of unmatched rows on both "
       "sides. Those five figures are the week.")

# --------------------------------------------------------------------- 9
F += P("9 - API", H1)
F += code([
    "import { priceAirFile, parseMstClientStatement, discoverFromFiles }",
    "  from '@commission/sdk'",
    "",
    "const result = priceAirFile(airText, {",
    "  config, tenantId: 'acme', view: 'subagent',",
    "})",
    "",
    "for (const doc of result.documents) {",
    "  doc.prefill            // '645.76' or null -> leave the field empty",
    "  doc.outcome            // 'CALCULATED' | 'NIL' | 'NO_RULE' | ...",
    "  doc.subAgentCommission // '0.00'     airline's commission, less host share",
    "  doc.fees               // [{ clause, label, amount }]",
    "  doc.markup             // '679.75'   the agent's own margin",
    "  doc.totalToSubAgent    // '645.76'   THE CHEQUE - reconcile against this",
    "  doc.markupPercent      // '25.0000' or null if no ceiling configured",
    "  doc.markupHeadroom     // '0.00' = at the ceiling; negative = over it",
    "  doc.explanation, doc.clause, doc.flags",
    "}",
    "",
    "const st = parseMstClientStatement(statementText)",
    "  st.lines[]             // invoice, ticketNumber (usually null), passenger,",
    "                         // vendor, issueDate, startDate, itinerary, amount",
    "  st.invoices[]          // grouped, with net and the printed subtotal",
    "  st.totals.payout       // our sum",
    "  st.totals.statedBalance// the statement's own - ASSERT THESE MATCH",
])

F += P("All money crosses the boundary as decimal strings - no bigint, no floats, no Date - so "
       "the whole response survives <code>JSON.stringify</code>. An HTTP wrapper is provided "
       "(<code>POST /price</code>, <code>POST /statement</code>) with no dependencies.")

# --------------------------------------------------------------------- 10
F += P("10 - Known gaps", H1)
F += P("Found on real files. Fix before trusting a full-folder run.")

F += table([
    ["Gap", "What happens", "Fix"],
    ["<b>EMDs unrecognised</b>",
     "A baggage EMD reads as a TKT with ticket number UNKNOWN, carrier ??, fare 0.00. Seen twice "
     "in a 15-file sample.",
     "Detect <code>EMD</code>/<code>TMCD</code> and type it as EMD"],
    ["<b>Validating carrier missed</b>",
     "Where the <code>A-</code> line is empty the carrier reads <code>??</code>, so no contract "
     "resolves. Seen on United and Arkia tickets.",
     "Fall back to the <code>FV</code> element"],
    ["<b>Foreign currency fare</b>",
     "<code>K-FPLN6789.00;USD1811.00</code> is read as PLN 6,789. The statement settles in USD, "
     "so the ticket prices in the wrong currency or throws a mismatch.",
     "Take the second field, the settlement currency"],
    ["<b>Other agencies in the folder</b>",
     "9 of 15 sampled files belonged to IATA 33770903. Totals across the folder are wrong.",
     "Filter by IATA first, and surface the others as a finding"],
], [1.45 * inch, 3.15 * inch, 2.3 * inch])

# --------------------------------------------------------------------- 11
F += P("11 - Build order", H1)
F += table([
    ["Phase", "Scope", "Done when"],
    ["<b>0</b>", "Fix the four gaps in §10. They are all on real files.",
     "A full-folder run produces no UNKNOWN tickets or ?? carriers"],
    ["<b>1</b>", "Contract tables + resolution. <b>Read-only</b>: compute and display.",
     "Every LY/MST ticket shows a cheque figure and an explanation"],
    ["<b>2</b>", "Pre-fill. Write the number into the field.",
     "Agents stop entering commission by hand on CALCULATED and NIL tickets"],
    ["<b>3</b>", "Statement upload, matching, reconciliation, Excel export.",
     "A week's statement produces a sorted exception list"],
    ["<b>4</b>", "Contract editing and PDF upload in the UI.",
     "A new airline can be added without a deploy"],
    ["<b>5</b>", "Second host agency; then standalone for other agencies.",
     "The engine has no CRM dependency - packaging, not a rewrite"],
], [0.62 * inch, 3.23 * inch, 3.05 * inch])

F += P("<b>Phase 1 being read-only is the important one.</b> It lets the computed figure be "
       "compared against what agents actually entered, across thousands of historical files, "
       "before a single number is written automatically. That comparison is the cheapest "
       "validation available - it is how a ticket claiming 8% on a class EL AL files at 7% was "
       "found.")

F += P("Non-negotiables", H1)
F += table([
    ["Rule", "Reason"],
    ["Money is integer minor units, never floats",
     "A half-cent bias is invisible per ticket and material across a year"],
    ["NIL and NO_RULE never merge", "Both show $0.00; only one is an answer"],
    ["Reconcile against the cheque, not the commission",
     "Otherwise every marked-up ticket reports wrongly"],
    ["Match on surname AND travel date, or not at all",
     "Surname alone produced eleven false discrepancies out of eleven"],
    ["Filter by IATA before any total", "The folder holds other agencies' files"],
    ["Assert our statement sum equals the statement's own balance",
     "It is the only external check on the reader"],
    ["A tie is never broken arbitrarily", "Two clauses matching equally returns AMBIGUOUS"],
    ["Every figure cites its clause", "The output is evidence in a dispute"],
    ["Unapproved clauses do not spend", "A term nobody confirmed is exposure, not income"],
], [2.5 * inch, 4.4 * inch])

F += [KeepTogether(P("Open questions for Main St. Travel", H1) + table([
    ["Question", "Impact"],
    ["<b>Why was a published, non-commissionable fare charged $50 and $30 rather than the "
     "schedule's $10?</b> Both are the net-fare cabin figures.",
     "Applies to every zero-commission ticket; $60 on two sampled"],
    ["Is the commissionable basis the base fare alone, or base plus YQ/YR? Neither contract "
     "states it.", "~$35 per ticket on a long-haul fare"],
    ["Is the host's point on a NET fare struck on the selling fare or the net fare before "
     "markup?", "$33.99 vs $27.19 on one sampled ticket"],
    ["Which booking classes count as Economy, Premium and Business for the cabin floor?",
     "Decides a $15 floor from a $50 one"],
    ["Is the tour code enforced in practice? No sampled ticket carries it.",
     "Forfeits the commission on every published fare"],
    ["Why do some tickets on a family booking get no statement line at all?",
     "Six sampled tickets unbilled; direction varies"],
    ["Statements are weekly, settlement is monthly - which is authoritative?",
     "Whether a weekly shortfall is real or timing"],
], [4.0 * inch, 2.9 * inch]))]

doc = SimpleDocTemplate(
    "docs/commission-module-spec.pdf", pagesize=LETTER,
    leftMargin=0.85 * inch, rightMargin=0.85 * inch,
    topMargin=0.75 * inch, bottomMargin=0.85 * inch,
    title="Commission & Consolidator Payouts - Module Specification",
    author="A. Appel and Co")
doc.build(F, onFirstPage=footer, onLaterPages=footer)
print("built")
