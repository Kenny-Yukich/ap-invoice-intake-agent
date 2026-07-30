# Fixtures & Seed Data

Five synthetic vendor invoice PDFs (generated with Python/ReportLab) plus PO seed data. All entities are fictional: bill-to is "Workflow AI Bend LLC"; vendors are Ridgeline Metals Supply, Talon Hydraulics, Meridian Freight & Customs, and Basalt Bearing Works.

| Fixture | Exercises | Expected verdict |
|---|---|---|
| `01_clean_match.pdf` | All six rules pass | `Ready`, auto-filed, computed_total 75.00 |
| `02_price_variance.pdf` | Rule 5 (price > ±5% of PO) | `Held`, price-variance reason |
| `03_extra_charge.pdf` | Rule 3 (line not on PO) | `Held` + advisory GL suggestion (5100 Freight-In) |
| others | Duplicate / qty-over-received paths | `Held`, rules 1 / 4 |

## PO seed (SharePoint `PO_Lines`)

| po_number | item_code | description | qty_received | unit_price | uom_factor |
|---|---|---|---|---|---|
| PO-5001 | A100 | Steel brackets | 10 | 5.00 | 1 |
| PO-5001 | A200 | Hex bolts | 100 | 0.25 | 1 |

The fixture invoices, function test payloads (`/tests`), and SharePoint seed all agree on these numbers by design, so every demo path is pre-verified.

*(PDF files added from the local build machine.)*
