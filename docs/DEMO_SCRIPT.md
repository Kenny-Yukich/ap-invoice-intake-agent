# Demo Script (~3 minutes)

## Setup before recording
- `Inbox` empty, `PO_Lines` seeded (PO-5001), flow on, Teams open on second window
- Fixture PDFs staged in a local folder ready to drag

## Beat 1 — The happy path (~60s)
1. One line of setup: "AP invoice intake, three-way match. The rule: AI advises, it never decides about money."
2. Drag `01_clean_match.pdf` into SharePoint `Inbox`.
3. Show the flow run: trigger → Document Intelligence → rules engine → verdict `Ready`, `computed_total: 75`.
4. Show the PDF now sitting in `Filed` and the new `Invoice_Drafts` row. "No human touched that — because six deterministic rules all passed."

## Beat 2 — The exception + the AI's actual job (~60s)
1. Drag `03_extra_charge.pdf` (surprise freight line) into `Inbox`.
2. Show verdict: `Held`, rule 3, "Line not on PO: FRT" — **and** the advisory `glSuggestion: { gl_code: "5100", confidence: 0.99 }`.
3. "The rules caught it. The LLM's only role: suggest where the charge probably belongs. It's labeled advice, not action."
4. Teams adaptive card pops: reason, suggestion, Approve/Reject + note. Click Approve. Show the file move + audit row.

## Beat 3 — The Copilot layer (~45s)
1. Open the Copilot Studio agent in Teams.
2. Ask: "What invoices are waiting on me?" → grounded answer from `Invoice_Drafts`.
3. Ask: "Why is INV-1002 held?" → the rule-3 reason, verbatim from data.
4. "General knowledge is off. It only knows what the system of record knows."

## Beat 4 — Close (~15s)
"Deterministic where money moves, AI where judgment helps, a human where it matters. That's the whole design."

## Fallbacks
- If venue WiFi fights the live flow: pre-recorded run of Beat 1/2 + live Copilot Q&A (lightest network load).
- If the card is slow to post: narrate over the flow-run history screen, which shows every step's inputs/outputs.
