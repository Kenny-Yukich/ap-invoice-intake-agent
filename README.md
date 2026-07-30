# AP Invoice Intake Agent
**VSLive! Microsoft AI Hackathon 2026 — Solo build**

> **Design principle: the LLM advises, it never decides about money.**

An accounts-payable intake agent that watches a SharePoint inbox, extracts vendor invoices with Azure AI Document Intelligence, three-way-matches them against PO and receiving data with a **deterministic rules engine** (a coded Azure Function), auto-files clean invoices, and routes exceptions to a human via a Teams adaptive card. A Copilot Studio agent grounded in the same SharePoint data gives AP staff a conversational window into the queue.

**Categories:** Best Microsoft Copilot Integration (primary) · Best AI Agent / Workflow Automation (secondary)

---

## The problem

In many small and mid-size companies, AP invoice intake is still a person reading PDFs out of an email inbox, re-keying line items, and eyeballing them against purchase orders in an ERP. It's slow, error-prone, and the failure mode is expensive: paying an invoice you shouldn't. This project automates the intake and matching while keeping every money decision either **deterministic** or **human-approved** — never delegated to a language model.

## Architecture

```
SharePoint /Inbox (PDF dropped)
        │  trigger: file created (Power Automate)
        ▼
Azure AI Document Intelligence  (prebuilt-invoice, v4.x, API 2024-11-30)
        │  structured fields + per-field confidence
        ▼
Azure Function "extract"  ◄── the coded web service
  6 deterministic match rules (no model in the decision path)
        │
   pass │            │ fail
        ▼            ▼
  status: Ready   status: Held
  file → /Filed     │ line has no PO match? → Azure OpenAI proposes
  (autonomous)      │   a GL code + confidence  (ADVISORY ONLY)
                    ▼
              Teams adaptive card — Approve / Reject + note
               approve → /Filed + audit row
               reject  → /Rejected + audit row

Copilot Studio agent (Teams, Entra auth, general knowledge OFF)
  reads Invoice_Drafts + PO_Lines: "what's waiting on me?" / "why is
  INV-1002 held?" / conversational approve
```

Two surfaces sit on the same data: the **adaptive card** is push (fires once, waits for one decision) and the **Copilot Studio agent** is pull (answers on demand).

## The six rules

| # | Rule | Why it exists |
|---|------|---------------|
| 1 | Invoice number not already processed | Duplicate-payment prevention |
| 2 | PO exists | No PO, no pay |
| 3 | Every invoice line matches a PO line by item code | Catches surprise charges (freight, fees). The **only** rule that triggers an LLM call — an advisory GL-code suggestion |
| 4 | Qty billed ≤ qty received | Three-way match against receiving |
| 5 | Unit price within ±5% of PO price | Price-creep detection |
| 6 | Extraction confidence ≥ 0.80 on money fields | If the extractor isn't sure, a human looks |

First failure wins; the invoice Holds with a specific, human-readable reason.

## Why the total is computed, not extracted

Testing showed `prebuilt-invoice` extracts `InvoiceTotal` at only **~41% confidence** on zero-tax invoices (where subtotal = total, the model hedges), while line items extract at **92–98%**. A control test on a receipt (98.6%) confirmed this is document-type-specific. So the system **always derives `computed_total` by summing line items** and never trusts the extracted total. Measuring extraction confidence instead of assuming it is itself part of the safety story.

Second finding: `prebuilt-invoice` **silently merges multi-invoice PDFs** into one cross-contaminated document rather than returning an array. Mitigation: the `Pages` parameter on the v4.x connector action.

## Safety & security

- **No model in the money path.** All pass/fail is deterministic code; the LLM output is a labeled *suggestion* that a human must approve before it touches any record.
- **Advisory failure is non-fatal.** If the Azure OpenAI call errors, the invoice still Holds and routes to a human — degradation, not failure.
- **Secrets in App Settings.** `AOAI_ENDPOINT`, `AOAI_KEY`, `AOAI_DEPLOYMENT` live as Azure environment variables; nothing in this repo contains a credential. Function access is key-gated (`authLevel: function`) and keys are rotated.
- **Copilot Studio agent runs with general knowledge OFF** and Entra authentication — it answers only from the grounded SharePoint data.
- **Synthetic data only.** All vendors, POs, and the bill-to company are fictional.

## Stack

Azure Functions (Node.js) · Azure AI Document Intelligence · Azure OpenAI · Power Automate · SharePoint · Microsoft Teams (adaptive cards) · Copilot Studio

## Repo map

```
azure-function/extract/   the deployed rules engine (index.js + bindings)
power-automate/           flow design: trigger → DI → mapping → function → routing
tests/                    the two verified smoke-test payloads (Ready path, Held path)
docs/                     architecture notes and demo script
fixtures/                 synthetic invoice PDFs + PO seed data
```

## Real-world grounding

Modeled on an actual manual AP workflow (email → OCR tool → ERP) observed in a manufacturing environment — this isn't a toy problem, it's a Tuesday.

---
## About the builder

I'm not a developer. I'm a Lean / continuous-improvement practitioner who moved
into a tech-adjacent role about six months ago — my background is process, not
programming. Every line of code in this repo was written with AI coding
assistants, at this event, with me directing the architecture, testing every
path, and making every design decision.

That's not a disclaimer — it's the point of the project. The core design
principle ("the LLM advises, it never decides about money") came from process
discipline, not a CS degree. If AI collapses the distance between someone who
deeply understands a workflow and working software, then the people who
understand the workflows are about to become builders. This repo is one data
point.

---

*Built solo in ~8 hours across two evenings at Microsoft HQ, Redmond. MIT licensed.*
