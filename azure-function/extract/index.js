// AP Invoice Match Engine — deterministic rules, LLM advisory-only
// Deployed: func-stickyfile-vslhq26 (Azure Functions, Node.js, Consumption)
// Design principle: the LLM advises, it never decides about money.
// All pass/fail logic is deterministic. Azure OpenAI is called only to
// SUGGEST a GL code on unmatched charges (rule 3), and that suggestion
// requires human approval via a Teams adaptive card before it affects
// any record.

const PRICE_TOLERANCE = 0.05;      // rule 5: ±5%
const CONFIDENCE_FLOOR = 0.80;     // rule 6: money-relevant fields

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const inv = body.invoice;
    const poLines = Array.isArray(body.poLines) ? body.poLines : [];
    const existing = Array.isArray(body.existingInvoiceNos) ? body.existingInvoiceNos : [];

    // ---- Input validation ----
    if (!inv || !inv.invoice_no || !Array.isArray(inv.lines)) {
      context.res = j(400, { error: 'Body must include invoice { invoice_no, lines[] }' });
      return;
    }

    // ---- computed_total: sum of line amounts, NEVER the extracted InvoiceTotal ----
    // Document Intelligence's InvoiceTotal confidence drops to ~41% on zero-tax
    // documents where subtotal equals total. Line items extract at 92-98%.
    // So the system derives the total itself instead of trusting the model's.
    const computedTotal = round2(inv.lines.reduce(function (sum, L) {
      const amt = num(L.amount) !== null ? num(L.amount) : (num(L.qty) || 0) * (num(L.unit_price) || 0);
      return sum + amt;
    }, 0));

    // ---- Deterministic rules, in order, first failure wins ----
    let status = 'Ready';
    let reason = '';
    let failedRule = 0;
    let unmatchedLine = null;

    // Rule 1: duplicate invoice number
    if (existing.indexOf(inv.invoice_no) !== -1) {
      status = 'Held'; failedRule = 1;
      reason = 'Duplicate invoice number: ' + inv.invoice_no;
    }

    // Rule 2: PO exists
    const poRows = poLines.filter(function (r) { return r.po_number === inv.po_number; });
    if (status === 'Ready' && poRows.length === 0) {
      status = 'Held'; failedRule = 2;
      reason = 'PO not found: ' + (inv.po_number || '(none extracted)');
    }

    // Rule 3: every invoice line matches a PO line by item_code
    if (status === 'Ready') {
      for (let i = 0; i < inv.lines.length; i++) {
        const L = inv.lines[i];
        const code = (typeof L.item_code === 'string' ? L.item_code.trim() : L.item_code);
        const match = poRows.find(function (r) { return r.item_code === code; });
        if (!match) {
          status = 'Held'; failedRule = 3;
          reason = 'Line not on PO: ' + (L.item_code || L.description || 'line ' + (i + 1));
          unmatchedLine = L;
          break;
        }
      }
    }

    // Rule 4: qty invoiced <= qty received (uom_factor applied if present)
    if (status === 'Ready') {
      for (let i = 0; i < inv.lines.length; i++) {
        const L = inv.lines[i];
        const code = (typeof L.item_code === 'string' ? L.item_code.trim() : L.item_code);
        const match = poRows.find(function (r) { return r.item_code === code; });
        const factor = num(match.uom_factor) || 1;
        const qtyInv = (num(L.qty) || 0) * factor;
        const qtyRec = num(match.qty_received) || 0;
        if (qtyInv > qtyRec) {
          status = 'Held'; failedRule = 4;
          reason = 'Qty billed ' + qtyInv + ' exceeds received ' + qtyRec + ' (' + code + ')';
          break;
        }
      }
    }

    // Rule 5: unit price within tolerance
    if (status === 'Ready') {
      for (let i = 0; i < inv.lines.length; i++) {
        const L = inv.lines[i];
        const code = (typeof L.item_code === 'string' ? L.item_code.trim() : L.item_code);
        const match = poRows.find(function (r) { return r.item_code === code; });
        const pInv = num(L.unit_price), pPo = num(match.unit_price);
        if (pInv === null || pPo === null || pPo === 0) continue;
        const pct = Math.abs(pInv - pPo) / pPo;
        if (pct > PRICE_TOLERANCE) {
          status = 'Held'; failedRule = 5;
          reason = 'Unit price ' + pInv + ' vs PO ' + pPo + ' = ' + Math.round(pct * 100) + '% (' + code + ')';
          break;
        }
      }
    }

    // Rule 6: extraction confidence floor
    if (status === 'Ready' && inv.fieldConfidence) {
      const fc = inv.fieldConfidence;
      for (const k in fc) {
        if (num(fc[k]) !== null && num(fc[k]) < CONFIDENCE_FLOOR) {
          status = 'Held'; failedRule = 6;
          reason = 'Low extraction confidence on ' + k + ' (' + fc[k] + '), manual review';
          break;
        }
      }
    }

    // Advisory GL suggestion — rule-3 failures only
    let glSuggestion = null;
    if (failedRule === 3 && unmatchedLine) {
      glSuggestion = await suggestGL(context, unmatchedLine);
    }

    context.log('Verdict: ' + status + (failedRule ? ' rule=' + failedRule : '') + ' total=' + computedTotal);
    context.res = j(200, {
      status: status, reason: reason, failedRule: failedRule,
      computed_total: computedTotal, glSuggestion: glSuggestion,
      engine: 'deterministic-rules-v1; LLM advisory-only'
    });

  } catch (err) {
    context.log('Unexpected error: ' + err.message);
    context.res = j(500, { error: 'Unexpected server error' });
  }
};

// Advisory-only: proposes a GL code + confidence for an unmatched charge.
// Failure here is non-fatal by design — the invoice still Holds and routes
// to a human either way. Credentials come from Azure App Settings
// (environment variables), never from code.
async function suggestGL(context, line) {
  try {
    const endpoint = process.env.AOAI_ENDPOINT, key = process.env.AOAI_KEY, dep = process.env.AOAI_DEPLOYMENT;
    if (!endpoint || !key || !dep) return null;
    const url = endpoint + '/openai/deployments/' + dep + '/chat/completions?api-version=2024-06-01';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You classify invoice charges to general-ledger codes. Common codes: 5100 Freight-In, 5200 Import Duties, 5300 Taxes Payable, 5400 Packaging, 6100 Misc Purchases. Respond ONLY with raw JSON: {"gl_code":"<4-digit>","confidence":<0-1>,"rationale":"<one sentence>"} No markdown.' },
          { role: 'user', content: 'Charge description: "' + (line.description || line.item_code || 'unknown') + '", amount: ' + (line.amount || '') }
        ],
        max_completion_tokens: 150
      })
    });
    if (!resp.ok) { context.log('GL advisory failed: ' + resp.status); return null; }
    const data = await resp.json();
    const raw = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    context.log('GL advisory error (non-fatal): ' + e.message);
    return null;
  }
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function round2(n) { return Math.round(n * 100) / 100; }
function j(status, obj) { return { status: status, headers: { 'Content-Type': 'application/json' }, body: obj }; }
