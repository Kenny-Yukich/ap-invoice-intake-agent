# Power Automate Flow — Invoice Intake

The orchestration layer. Six core steps, verified end-to-end against fixture `01_clean_match.pdf` (HTTP 200 / `Ready` / `computed_total: 75`).

## Steps

1. **Trigger — When a file is created (SharePoint)**
   Library: `Inbox`. A vendor invoice PDF landing here starts everything.

2. **Get file content (SharePoint)**
   Pulls the PDF bytes for the extraction call.

3. **Analyze Document (AI Builder / Document Intelligence v4.x connector)**
   Model: `prebuilt-invoice`, API `2024-11-30`.
   ⚠️ **`Pages` parameter set** (Advanced Parameters → Show all) — without it, the model silently merges multi-invoice PDFs into one cross-contaminated result.
   Confirmed extracting `PurchaseOrder` at 98.4% confidence and `ProductCode` per line item.

4. **Get items — `PO_Lines` (SharePoint list)**
   The PO + receiving side of the three-way match.

5. **Get items — `Invoice_Drafts` (SharePoint list)**
   Supplies `existingInvoiceNos` for duplicate detection (rule 1).

6. **Select — `Select_Lines`**
   Transforms Document Intelligence's nested `Items.valueArray` into the flat
   `lines[]` shape the function expects. Five key/value mappings:

   | Output key | Source (per DI line item) |
   |---|---|
   | `item_code` | `item()?['valueObject']?['ProductCode']?['valueString']` |
   | `description` | `item()?['valueObject']?['Description']?['valueString']` |
   | `qty` | `item()?['valueObject']?['Quantity']?['valueNumber']` |
   | `unit_price` | `item()?['valueObject']?['UnitPrice']?['valueCurrency']?['amount']` |
   | `amount` | `item()?['valueObject']?['Amount']?['valueCurrency']?['amount']` |

7. **HTTP POST → Azure Function `extract`**
   Body assembled from dynamic content: extracted header fields +
   `Select_Lines` output + PO rows + existing invoice numbers.
   The function URL (including its function-level key) is held in a flow
   variable — never hard-coded into repo artifacts. Key was rotated during
   the event after an exposure.

8. **Condition on `status`** *(Night 2)*
   - `Ready` → create `Invoice_Drafts` record, move PDF `Inbox` → `Filed`
   - `Held` → create record with reason + advisory GL suggestion, then post a
     **Teams adaptive card** (post-and-wait) with Approve / Reject + note field.
     Approve → `Filed` + audit row. Reject → `Rejected` + audit row.

## SharePoint schema

**Lists**
- `PO_Lines`: `po_number`, `item_code`, `qty_received`, `unit_price`, `uom_factor`
  Seeded with PO-5001: A100 steel brackets ×10 @ $5.00, A200 hex bolts ×100 @ $0.25
- `Invoice_Drafts`: invoice number, vendor, status, reason, computed total, GL suggestion, decision audit fields

**Document libraries**
- `Inbox` (intake) · `Filed` (approved/clean) · `Rejected`
