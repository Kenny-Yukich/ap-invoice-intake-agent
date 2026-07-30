# Architecture & Design Decisions

## Core principle

**The LLM advises, it never decides about money.**

Every architectural choice flows from that sentence:

| Decision | Consequence |
|---|---|
| Matching is a coded rules engine (Azure Function), not a prompt | Verdicts are deterministic, testable, and explainable — same input, same output, always |
| The LLM is called only on rule-3 failures | Its entire job is one advisory suggestion: "this unmatched charge looks like GL 5100 Freight-In, confidence 0.99" |
| The suggestion is labeled and routed to a human | A person clicks Approve/Reject on a Teams card before anything is filed |
| Advisory call failure is swallowed, not thrown | If Azure OpenAI is down, the invoice still Holds and reaches a human — the system degrades, it doesn't fail |
| `computed_total` is summed from line items | The extracted `InvoiceTotal` measured ~41% confidence on zero-tax docs; line items measured 92–98%. Trust is earned per-field, not assumed per-model |

## Component responsibilities

- **SharePoint** — system of record. Document libraries (`Inbox`/`Filed`/`Rejected`) model the invoice lifecycle as physical file location; lists (`PO_Lines`, `Invoice_Drafts`) hold structured data both the flow and the Copilot Studio agent read.
- **Power Automate** — orchestration only. No business logic lives in the flow; it moves data between services and branches on the function's verdict.
- **Document Intelligence** — perception. Turns pixels into structured fields *with confidence scores*, which the rules engine treats as first-class inputs (rule 6).
- **Azure Function** — judgment. The one hand-coded component, deliberately: match logic is exactly the kind of thing that should be code you can read, test, and diff — not a prompt.
- **Azure OpenAI** — advice. Narrowly scoped, structured-output-only, human-gated.
- **Teams adaptive card** — decision surface. Post-and-wait: one card, one human, one auditable answer.
- **Copilot Studio** — context surface. Conversational read access ("what's waiting on me?", "why is INV-1002 held?") over the same SharePoint data, general knowledge off, Entra-authenticated.

## Empirical findings that shaped the design

1. **`InvoiceTotal` hedging on zero-tax invoices.** All four fixture invoices (zero tax, subtotal = total) extracted `InvoiceTotal` at ~41% confidence. A receipt control test scored 98.6%, proving it's document-type-specific, not a model defect. Design response: never use the extracted total; sum the lines.

2. **Multi-invoice PDF merging.** `prebuilt-invoice` merges a multi-invoice PDF into a single cross-contaminated document instead of returning an array. Design response: the `Pages` parameter on the v4.x connector (string type, under Advanced Parameters → Show all). This alone justifies the confidence-floor rule — silent failure modes exist.

3. **Connector version matters.** The v3.x Document Intelligence connector caps at API `2023-07-31`; v4.x (API `2024-11-30`) was required for the fields and behavior above.

## Security posture

- Credentials (`AOAI_ENDPOINT`, `AOAI_KEY`, `AOAI_DEPLOYMENT`) are Azure App Settings — environment variables, never in code, never in this repo.
- Function is `authLevel: function`; the key is carried in a flow variable and was rotated mid-event after an exposure. Rotation is a one-click, zero-redeploy operation by design.
- Copilot Studio agent: Entra authentication, general knowledge disabled — it cannot hallucinate answers from outside the grounded data.
- All demo data is synthetic. Fictional bill-to entity and vendors; no real companies, people, or invoices anywhere in the repo.

## What "agent" means here

The system is autonomous where autonomy is safe (clean matches file themselves) and semi-autonomous where it isn't (exceptions require a human decision). The boundary between those two modes is drawn by deterministic rules, not by model confidence — which is the whole point.
