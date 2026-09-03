from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
)

INK    = colors.HexColor("#14181d")
MUTED  = colors.HexColor("#5b6672")
RULE   = colors.HexColor("#d4dae0")
ACCENT = colors.HexColor("#0f5c4a")
BAND   = colors.HexColor("#eef2f4")
WARN   = colors.HexColor("#8a4b12")

ss = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, parent=ss["Normal"], **kw)

Title   = S("T", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=INK, spaceAfter=4)
Sub     = S("Sub", fontName="Helvetica", fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=2)
H1      = S("H1", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=ACCENT,
            spaceBefore=17, spaceAfter=7)
H2      = S("H2", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=INK,
            spaceBefore=11, spaceAfter=4)
Body    = S("B", fontName="Helvetica", fontSize=9.6, leading=14.2, textColor=INK,
            spaceAfter=7, alignment=TA_LEFT)
Small   = S("S", fontName="Helvetica", fontSize=8.6, leading=12.4, textColor=MUTED, spaceAfter=6)
Mono    = S("M", fontName="Courier", fontSize=8.4, leading=12.4, textColor=INK)
MonoB   = S("MB", fontName="Courier-Bold", fontSize=8.4, leading=12.4, textColor=INK)
Cell    = S("C", fontName="Helvetica", fontSize=8.5, leading=11.6, textColor=INK)
CellB   = S("CB", fontName="Helvetica-Bold", fontSize=8.5, leading=11.6, textColor=INK)
CellM   = S("CM", fontName="Courier", fontSize=8.1, leading=11.6, textColor=INK)
Head    = S("HD", fontName="Helvetica-Bold", fontSize=8.3, leading=11, textColor=colors.white)

def table(rows, widths, head=True, zebra=True):
    data = []
    for i, r in enumerate(rows):
        out = []
        for c in r:
            if isinstance(c, Paragraph):
                out.append(c)
            else:
                st = Head if (head and i == 0) else Cell
                out.append(Paragraph(str(c), st))
        data.append(out)
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
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
    return t

def code(lines):
    body = [[Paragraph(l.replace(" ", "&nbsp;") or "&nbsp;", Mono)] for l in lines]
    t = Table(body, colWidths=[6.9 * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f6f8f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t

def note(text):
    t = Table([[Paragraph(text, S("N", fontName="Helvetica", fontSize=8.8, leading=12.8,
                                  textColor=WARN))]], colWidths=[6.9 * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fdf5ec")),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, colors.HexColor("#c98432")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE); canvas.setLineWidth(0.4)
    canvas.line(0.85 * inch, 0.62 * inch, LETTER[0] - 0.85 * inch, 0.62 * inch)
    canvas.setFont("Helvetica", 7.6); canvas.setFillColor(MUTED)
    canvas.drawString(0.85 * inch, 0.45 * inch,
                      "Commission & Consolidator Payouts — module specification")
    canvas.drawRightString(LETTER[0] - 0.85 * inch, 0.45 * inch, "Page %d" % doc.page)
    canvas.restoreState()

E = lambda h: Spacer(1, h)
F = []

# ---------------------------------------------------------------- cover
F += [
    E(6),
    Paragraph("Commission &amp; Consolidator Payouts", Title),
    Paragraph("Module specification for CRM integration", Sub),
    Paragraph("A. Appel and Co · sub-agent under Main St. Travel (IATA 33535983)", Small),
    E(10),
]

F += [Paragraph(
    "This module answers one question automatically, on every ticket: "
    "<b>how much commission is due, and to whom.</b> It reads the ticket, finds the contract "
    "that governs it, computes the figure, and pre-fills the commission field. Once a week the "
    "consolidator statement is uploaded and the module reconciles what was actually paid against "
    "what was owed, flagging every difference.", Body)]

F += [Paragraph(
    "It is deliberately built as a <b>pure function</b>: text in, JSON out. No database calls, no "
    "clock, no network. That is what lets the same code run inside the CRM, in a queue worker, in "
    "an Edge Function, and in tests — and it is why the same ticket always produces the same "
    "number.", Body)]

# ---------------------------------------------------------------- 1
F += [Paragraph("1 · The flow", H1)]
# two columns, pipes locked to fixed positions so nothing drifts
L, Rc = 10, 46
def _row(left="", right=""):
    return (" " * L + left).ljust(Rc) + right
_flow = [
    _row("AIR file arrives", "Weekly statement arrives").replace(" " * L + "AIR", " " * (L - 3) + "AIR"),
    _row("|", "|"),
    _row("v", "v"),
    _row("parse ticket", "parse statement"),
    _row("|", "|"),
    _row("|  read IATA from ticket", "|"),
    _row("|", "|"),
    _row("+-- no contract --> FALLBACK", "|"),
    _row("|      (commission left empty)", "|"),
    _row("v", "v"),
    (" " * L + "calculate").ljust(24) + "-" * (Rc - 24 - 2) + "> RECONCILE",
    _row("|", "|"),
    _row("v", "v"),
    _row("pre-fill commission", "flag every difference"),
    _row("", "|"),
    _row("", "v"),
    _row("", "export .xlsx for review"),
]
F += [code(_flow)]

# ---------------------------------------------------------------- 2
F += [Paragraph("2 · Contract resolution — the lookup chain", H1)]
F += [Paragraph(
    "This is the core of the module. Every ticket carries the IATA number it was issued under; "
    "that number identifies the consolidator, and the consolidator owns the contracts. The chain "
    "is walked <b>in order</b>, and stops at the first step that fails.", Body)]

F += [table([
    ["#", "Step", "Read from", "If it fails"],
    ["1", "Tenant", "the CRM session", "reject — never price across tenants"],
    ["2", "IATA number", "ticket number prefix / agency field in the AIR file",
     "<b>FALLBACK</b> — no contract can be chosen"],
    ["3", "Consolidator", "contracts table, matched on IATA + tenant",
     "<b>FALLBACK</b> — IATA is not one we hold"],
    ["4", "Carrier contract", "validating carrier + issue date inside the contract’s validity window",
     "<b>FALLBACK</b> — no contract for this airline"],
    ["5", "Clause", "route / origin / booking class / fare type / tour code",
     "<b>NO_RULE</b> — contract exists, no clause covers this ticket"],
    ["6", "Rate", "rate table by booking class",
     "<b>NIL</b> or <b>AMBIGUOUS</b> — see §4"],
], [0.3*inch, 1.05*inch, 2.5*inch, 3.05*inch])]

F += [E(9), Paragraph(
    "Steps 5 and 6 are <b>not</b> a fallback. A contract that exists and says <i>nothing is due</i> "
    "is a different fact from having no contract at all, and the module must never merge them. "
    "The first is a settled answer worth writing down; the second is a gap in the data.", Body)]

F += [note(
    "<b>The distinction that matters most.</b> NIL means a clause asserted zero — for example, "
    "El Al forfeits commission when the mandatory tour code is missing. NO_RULE means nobody has "
    "worked it out yet. Both display as $0.00. Only NIL may be written into the commission field; "
    "NO_RULE must stay empty and go to a queue. Merging them silently books zero on tickets that "
    "were actually owed money.")]

# ---------------------------------------------------------------- 3
F += [Paragraph("3 · Data model", H1)]
F += [Paragraph("Five tables. Everything is editable, and contracts are uploadable as files.", Body)]

F += [Paragraph("tenant", H2)]
F += [table([
    ["Column", "Notes"],
    ["id, name", "Every query below is scoped by tenant_id. Contracts never cross tenants."],
], [1.5*inch, 5.4*inch])]

F += [Paragraph("consolidator", H2)]
F += [table([
    ["Column", "Notes"],
    ["id, tenant_id, name", "e.g. “Main St Travel”"],
    ["iata", "<b>The join key.</b> Matched against the IATA on the ticket. Unique per tenant."],
    ["retains_points", "Points of the fare the consolidator keeps; the sub-agent takes the rest."],
    ["fee_schedule", "Optional. Names a signed fee schedule (see §6). Null ⇒ plain retention only."],
], [1.5*inch, 5.4*inch])]

F += [Paragraph("carrier_contract", H2)]
F += [table([
    ["Column", "Notes"],
    ["id, consolidator_id", ""],
    ["carrier", "Validating carrier, e.g. LY."],
    ["issued_from, issued_to", "Validity window, tested against the <b>ticketing date</b>."],
    ["rates", "JSON: booking class → percentage. <code>{\"I\":\"9.00\",\"S\":\"7.00\", …}</code>"],
    ["include_yq", "Whether the commissionable basis is base fare only, or base + YQ/YR."],
    ["required_tour_code", "If set, a ticket without it earns nothing (asserted NIL)."],
    ["origin_in", "Origination countries the contract covers, e.g. [US, CA]."],
    ["scope", "ticket | coupon | half_rt — how the rate is applied."],
    ["files[]", "Uploaded PDFs. Stored for audit; the rules above are what actually run."],
], [1.5*inch, 5.4*inch])]

F += [Paragraph("ticket_document  ·  statement_row", H2)]
F += [table([
    ["Table", "Notes"],
    ["ticket_document", "One row per passenger per document. Ticket number, type (TKT/EXCH/RFND/VOID), "
     "issue date, carrier, IATA, base fare, taxes, coupons, fare type, tour code, plus the "
     "computed commission and outcome."],
    ["statement_row", "One row per line of an uploaded consolidator statement: ticket number, "
     "amount paid, fees withheld, statement date."],
], [1.5*inch, 5.4*inch])]

# ---------------------------------------------------------------- 4
F += [Paragraph("4 · The pre-fill rule", H1)]
F += [Paragraph(
    "The module returns a <code>prefill</code> field that is either a decimal string or "
    "<code>null</code>. <b>Bind it directly to the commission field.</b> The decision about whether "
    "a number is safe to write has already been made — the caller does not repeat it.", Body)]

F += [table([
    ["Outcome", "prefill", "Meaning"],
    ["CALCULATED", "the amount", "A clause matched and produced a figure."],
    ["NIL", "0.00", "A clause asserted that nothing is due. A settled answer."],
    ["NO_RULE", "null", "A contract exists but no clause covers this ticket."],
    ["AMBIGUOUS", "null", "Two clauses matched equally well. Never guessed."],
    ["INCOMPLETE", "null", "A clause needed something the document did not carry."],
    ["NO_CONTRACT", "null", "No contract for this IATA. <b>This is the fallback.</b>"],
    ["ERROR", "null", "The document could not be priced at all."],
], [1.15*inch, 0.85*inch, 4.9*inch])]

F += [E(9), Paragraph(
    "Two further conditions suppress a pre-fill even on a good outcome, and both were learned from "
    "real tickets:", Body)]

F += [table([
    ["Condition", "Why"],
    ["The layer being paid must be the layer that settled",
     "On a Zürich–Tel Aviv reissue the carrier layer resolved cleanly (a $100 clawback) while "
     "the sub-agent layer could not resolve its share at all. Reading one and paying the other "
     "offered a confident $0.00 on an open question."],
    ["No REVIEW flag on the document",
     "The engine raises REVIEW when two signed contracts disagree — on that same ticket, that the "
     "host pays $100 out of pocket. A figure already flagged for a human is not one to bind to a "
     "form field."],
], [2.15*inch, 4.75*inch])]

F += [E(9), Paragraph(
    "Every result also carries <code>explanation</code>, <code>clause</code> and "
    "<code>ruleId</code>. Show the explanation next to the field. A number the agent cannot trace "
    "back to a line of the contract is a number they cannot argue with the consolidator about, "
    "which defeats the point of the module.", Body)]

F += [Paragraph("Fees are separate from commission", H2)]
F += [Paragraph(
    "<code>subAgentCommission</code> is what was earned. <code>netToSubAgent</code> is what is "
    "actually received after the consolidator’s fees. On a net or bulk fare these differ on every "
    "ticket — the commission reads 0.00 while the ticket costs $15 to $50. "
    "<b>Show the net.</b> Each fee line carries the clause it came from.", Body)]

# ---------------------------------------------------------------- 5
F += [Paragraph("5 · Weekly statement reconciliation", H1)]
F += [Paragraph(
    "The statement is uploaded as CSV or Excel. Each row is matched to a ticket by ticket number, "
    "and every row lands in exactly one of eight states. Nothing is dropped: a row that matches no "
    "ticket, and a ticket that appears on no row, are both findings.", Body)]

F += [table([
    ["Status", "Severity", "Meaning", "Action"],
    ["<b>SHORT_PAID</b>", "critical", "Paid less than the contract gives", "Claim the difference"],
    ["<b>NOT_ON_STATEMENT</b>", "critical", "Earned, but the statement omits it entirely", "Claim in full"],
    ["OVER_PAID", "warning", "Paid more than the contract gives", "Expect a clawback"],
    ["PAID_WHERE_<br/>NONE_DUE", "warning", "Paid on a document owed nothing", "Verify before spending"],
    ["NOT_IN_TICKETS", "warning", "Paid for a document not in our records", "Investigate"],
    ["DEDUCTION", "warning", "A fee withheld that no supplied agreement covers", "Query the fee"],
    ["AGREES", "ok", "Matches to the cent", "—"],
    ["CORRECTLY_NIL", "ok", "Both sides agree nothing is due", "—"],
], [1.78*inch, 0.65*inch, 2.62*inch, 1.85*inch])]

F += [E(9), Paragraph(
    "The two critical states are the ones that cost money and are invisible without this module: "
    "a short payment and an omission both look like a normal week on a statement.", Body)]

F += [Paragraph("Excel export — column layout", H2)]
F += [Paragraph(
    "One row per ticket, sorted <b>worst first</b> (critical, then warning, then ok) so the rows "
    "that need attention are at the top and everything below can be ignored. "
    "<code>Variance</code> is the money column: negative means underpaid.", Body)]

F += [table([
    ["Column", "Example", "Column", "Example"],
    ["Status", "SHORT_PAID", "Expected", "70.00"],
    ["Ticket", "114-7503646565", "Paid", "55.04"],
    ["Passenger", "COHEN/EDMOUND", "<b>Variance</b>", "<b>-14.96</b>"],
    ["Type", "TKT", "Fees withheld", "0.00"],
    ["Issue date", "2026-03-02", "Net expected", "70.00"],
    ["Route", "JFK–TLV", "Contract", "EL AL 2026"],
    ["Class", "S", "Clause", "Attachment A"],
    ["Fare type", "published", "Why", "S files at 7%, 8% was claimed"],
], [0.95*inch, 1.55*inch, 1.15*inch, 2.35*inch])]

F += [E(8), Paragraph(
    "Add a totals row: sum of variance, split into <i>short-paid</i>, <i>over-paid</i>, "
    "<i>missing</i> and <i>unexplained deductions</i>. That single figure is what the week is "
    "worth arguing about, and it is what the agent takes to the consolidator.", Body)]

F += [note(
    "<b>Conditional formatting.</b> Red fill on the Variance cell where it is negative, amber where "
    "positive, none where zero. Freeze the header row. The point is that the agent should be able "
    "to open the file and see the week’s exposure without reading a single number carefully.")]

# ---------------------------------------------------------------- 6
F += [Paragraph("6 · API surface", H1)]
F += [Paragraph(
    "Three functions. All take strings and return plain JSON — no bigint, no Date, no class "
    "instances — so the whole response survives <code>JSON.stringify</code> into a database "
    "column or an HTTP body. Money is always a decimal string.", Body)]

F += [code([
    "import { priceAirFile, priceAirFiles, checkStatement }",
    "  from '@commission/sdk'",
    "",
    "// One AIR file -> what each passenger's ticket is worth",
    "const result = priceAirFile(airText, {",
    "  config,               // contracts, loaded from your DB",
    "  view: 'subagent',     // or 'host'",
    "})",
    "",
    "for (const doc of result.documents) {",
    "  doc.ticketNumber        // '114-7503646565'",
    "  doc.prefill             // '60.00'  or null -> leave the field empty",
    "  doc.outcome             // 'CALCULATED' | 'NIL' | 'NO_RULE' | ...",
    "  doc.subAgentCommission  // '60.00'   what was earned",
    "  doc.netToSubAgent       // '-15.00'  what is actually received",
    "  doc.fees                // [{ clause, label, amount }]",
    "  doc.explanation         // show this next to the field",
    "  doc.flags               // [{ code: 'REVIEW', message }]",
    "}",
    "",
    "// A whole folder at once",
    "priceAirFiles([{ name, text }, ...], opts)",
    "",
    "// Weekly reconciliation",
    "checkStatement(statementCsv, airFiles, opts)",
])]

F += [E(8), Paragraph(
    "An HTTP wrapper is also provided (<code>POST /price</code>, <code>POST /statement</code>, "
    "<code>GET /health</code>) with no dependencies, for callers that cannot import JavaScript.", Body)]

F += [Paragraph("Where the config comes from", H2)]
F += [Paragraph(
    "<code>config</code> is a plain JSON object built from the three contract tables in §3. Load "
    "it per tenant, cache it, and rebuild it whenever a contract is edited. It has no behaviour of "
    "its own — it is data — which is what keeps contracts editable without a deploy.", Body)]

F += [Paragraph("Signed fee schedules", H2)]
F += [Paragraph(
    "Most host agreements are one line: <i>we keep a point</i>. That is <code>retains_points</code> "
    "and needs nothing further. A real signed schedule is richer — a percentage on published "
    "fares, a flat fee by cabin on net fares, a charge per exchange and per refund, and a charge on "
    "tickets that earn nothing. Where one has been encoded, name it in "
    "<code>fee_schedule</code>; otherwise the plain retention applies, which is what any new agency "
    "starts from.", Body)]

F += [note(
    "<b>Clauses that cannot be decided from a ticket are left switched off.</b> Corporate bookings, "
    "promotional net fares and discretionary minimum fees depend on facts an AIR file does not "
    "carry. They are encoded but marked unapproved, so the engine surfaces them as exposure rather "
    "than booking them as certainty. Keep that flag in the schema: <code>approved: boolean</code>.")]

# ---------------------------------------------------------------- 7
F += [Paragraph("7 · Build order", H1)]
F += [Paragraph(
    "CRM first, standalone second. The CRM has real tickets arriving every day, which is the only "
    "way to find the record shapes that break a parser — and every serious bug so far has come "
    "from a real file, not from a test. A standalone product built first would be a guess about "
    "what other agencies need, validated by nobody.", Body)]

F += [table([
    ["Phase", "Scope", "Done when"],
    ["<b>1</b>", "Contract tables + resolution chain (§2, §3). Read-only: compute and "
     "display, write nothing.", "Every ticket in the CRM shows an outcome and an explanation."],
    ["<b>2</b>", "Pre-fill (§4). Write the number into the commission field.",
     "Agents stop entering commission by hand on CALCULATED tickets."],
    ["<b>3</b>", "Statement upload + reconciliation + Excel export (§5).",
     "A week’s statement produces a sorted exception list."],
    ["<b>4</b>", "Contract editing and PDF upload in the UI.",
     "A new airline contract can be added without a deploy."],
    ["<b>5</b>", "Extract as standalone for other agencies.",
     "The engine already has no CRM dependency — this is packaging, not a rewrite."],
], [0.5*inch, 3.3*inch, 3.1*inch])]

F += [E(6), Paragraph(
    "Phase 1 being read-only is deliberate. It lets the computed figure be compared against what "
    "agents actually entered, across thousands of historical tickets, before a single number is "
    "written automatically. That comparison is the cheapest validation available.", Body)]

F += [Paragraph("Non-negotiables", H1)]
F += [table([
    ["Rule", "Reason"],
    ["Money is integer minor units, never floats",
     "A half-cent bias is invisible per ticket and material across a year."],
    ["NIL and NO_RULE never merge",
     "Both show $0.00; only one is an answer."],
    ["A tie is never broken arbitrarily",
     "Two clauses matching equally returns AMBIGUOUS. A wrong confident number costs more than a queued one."],
    ["Every figure cites its clause",
     "The output is evidence in a dispute, not just a number."],
    ["The engine does no I/O",
     "No database, no clock, no randomness — the same ticket always prices the same."],
    ["Unapproved clauses do not spend",
     "A term nobody has confirmed is exposure, not income."],
], [2.35*inch, 4.55*inch])]

F += [Paragraph("Open questions for the consolidator", H1)]
F += [Paragraph(
    "These are money, and each needs an answer rather than a guess. They are recorded in the code "
    "alongside the clause they come from.", Body)]

F += [table([
    ["Question", "Impact"],
    ["Is the commissionable basis the base fare alone, or base plus YQ/YR? Neither contract states it.",
     "Roughly $35 per ticket on a typical long-haul fare"],
    ["Which booking classes count as Economy, Premium and Business for the net-fare fee?",
     "Decides a $15 fee from a $50 one on every net fare"],
    ["Is the tour code enforced in practice, or only on paper?",
     "Currently forfeits the commission on every sampled ticket"],
    ["Is the minimum fee on small commissions applied automatically or at discretion?",
     "$10 per affected ticket"],
    ["Statements are weekly but settlement is monthly — which is authoritative?",
     "Decides whether a weekly shortfall is real or just timing"],
], [4.0*inch, 2.9*inch])]

doc = SimpleDocTemplate(
    "docs/commission-module-spec.pdf", pagesize=LETTER,
    leftMargin=0.85*inch, rightMargin=0.85*inch,
    topMargin=0.75*inch, bottomMargin=0.85*inch,
    title="Commission & Consolidator Payouts — Module Specification",
    author="A. Appel and Co",
)
doc.build(F, onFirstPage=footer, onLaterPages=footer)
print("built")
