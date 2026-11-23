'use strict';

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');
const puppeteer = require('puppeteer');
const { createCanonicalTransaction } = require('./canonicalSchema');
const { parseIndianAmount, normalizeDateString } = require('./normalizerService');

/**
 * Claude client initialization
 */
function getClaudeClient() {
  const apiKey = (process.env.BANK_STATEMENT_ANALYZER_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('No Anthropic API key configured (BANK_STATEMENT_ANALYZER_API_KEY / CLAUDE_API_KEY).');
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  return new Anthropic({ apiKey });
}

function getClaudeModel() {
  const rawModel = (process.env.BANK_STATEMENT_ANALYZER_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022').trim();
  if (rawModel.includes('claude-sonnet-5') || rawModel === 'claude-sonnet-5') {
    return 'claude-3-5-sonnet-20241022';
  }
  console.log(rawModel);
  return rawModel;
}

/**
 * Structured tool schema for emit_transactions
 */
const EMIT_TRANSACTIONS_TOOL = {
  name: 'emit_transactions',
  description: 'Emit the strictly verified list of transactions extracted from the statement page.',
  input_schema: {
    type: 'object',
    required: ['transactions', 'page_closing_balance'],
    properties: {
      page_opening_balance: {
        type: 'number',
        description: 'Opening balance or carry-in balance of this page',
      },
      page_closing_balance: {
        type: 'number',
        description: 'Closing balance or carry-forward balance at the end of this page',
      },
      transactions: {
        type: 'array',
        description: 'List of consecutive transaction rows found on this page',
        items: {
          type: 'object',
          required: ['date', 'description', 'amount', 'direction', 'balance'],
          properties: {
            date: { type: 'string', description: 'Transaction date (e.g. DD-MM-YYYY)' },
            value_date: { type: 'string', description: 'Value date if printed, else null' },
            description: { type: 'string', description: 'Transaction description / narration' },
            ref_no: { type: 'string', description: 'Cheque or Reference or UTR number if printed' },
            amount: { type: 'number', description: 'Positive transaction amount in rupees' },
            direction: { type: 'string', enum: ['CREDIT', 'DEBIT'], description: 'CREDIT or DEBIT' },
            balance: { type: 'number', description: 'Post-transaction running balance' },
          },
        },
      },
    },
  },
};

/**
 * Enforce strict verbatim grounding:
 * Verifies that the amounts and balances extracted by Claude exist verbatim in the source text.
 */
function verifyVerbatimGrounding(txns = [], sourceText = '') {
  if (!txns || txns.length === 0) return { verified: true, groundedCount: 0 };
  const lowerText = sourceText.replace(/\s+/g, ' ');
  // Also create a punctuation-relaxed text version for comma-formatted numbers like 4,500.00 vs 4500.00
  const uncommaText = lowerText.replace(/,/g, '');

  let groundedCount = 0;
  const ungroundedRows = [];

  for (const t of txns) {
    const amtStr = (t.amount || 0).toFixed(2);
    const balStr = (t.balance !== undefined ? t.balance : t.balance_after || 0).toFixed(2);

    // Look for amount and balance tokens in source text (with or without Indian commas or decimal cents)
    const amtClean = amtStr.replace('.00', '');
    const balClean = balStr.replace('.00', '');

    const hasAmt =
      lowerText.includes(amtStr) ||
      lowerText.includes(amtClean) ||
      uncommaText.includes(amtStr) ||
      uncommaText.includes(amtClean);

    const hasBal =
      lowerText.includes(balStr) ||
      lowerText.includes(balClean) ||
      uncommaText.includes(balStr) ||
      uncommaText.includes(balClean);

    if (hasAmt && hasBal) {
      groundedCount++;
    } else {
      ungroundedRows.push({
        txn: t,
        reason: `Tokens not found verbatim in text: amount=${amtStr} (found: ${hasAmt}), balance=${balStr} (found: ${hasBal})`,
      });
    }
  }

  return {
    verified: ungroundedRows.length === 0,
    groundedCount,
    totalChecked: txns.length,
    ungroundedRows,
  };
}

/**
 * Tier 3: Claude Text Extraction Repair
 * Isolates ONLY the failing page(s).
 * Passes failing page raw text + 8 lines preceding overlap + 8 lines succeeding overlap.
 */
async function extractPageWithClaudeText({
  failingPageNumber,
  pageText = '',
  precedingOverlapText = '',
  succeedingOverlapText = '',
  carryInBalance = null,
  gapHint = '',
  detectedBank = '',
}) {
  const claude = getClaudeClient();
  const model = getClaudeModel();

  const prompt = `You are a bank statement mathematical extraction specialist.
We are repairing transactions for FAILING PAGE ${failingPageNumber} of a bank statement (${detectedBank || 'Bank Statement'}).
A chain break or missing row was detected on this page.
Diagnostic Hint: ${gapHint || 'Verify running balance arithmetic strictly.'}

${carryInBalance !== null ? `Starting carry-in balance before Page ${failingPageNumber}: ₹${carryInBalance.toFixed(2)}` : ''}

=== 8 PRECEDING OVERLAP LINES (FROM PREVIOUS PAGE) ===
${precedingOverlapText || '[Start of statement / No preceding page]'}

=== FAILING PAGE ${failingPageNumber} RAW TEXT ===
${pageText}

=== 8 SUCCEEDING OVERLAP LINES (FROM NEXT PAGE) ===
${succeedingOverlapText || '[End of statement / No succeeding page]'}

INSTRUCTIONS:
1. Extract EVERY transaction that belongs strictly to PAGE ${failingPageNumber}.
2. Ensure you find any missing transactions that resolve the gap hint.
3. Every amount and balance MUST appear verbatim in the page text.
4. Call emit_transactions tool with the extracted transactions.`;

  const response = await claude.messages.create({
    model,
    max_tokens: 4096,
    system: 'Extract bank statement transactions for the requested page with exact arithmetic fidelity.',
    tools: [EMIT_TRANSACTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_transactions' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content?.find((c) => c.type === 'tool_use' && c.name === 'emit_transactions');
  if (!toolUse || !toolUse.input) {
    throw new Error(`Claude text extraction repair did not invoke emit_transactions for page ${failingPageNumber}`);
  }

  const extracted = toolUse.input;
  const rawTxns = extracted.transactions || [];

  // Verify verbatim grounding against failing page + overlap text
  const fullContextText = `${precedingOverlapText}\n${pageText}\n${succeedingOverlapText}`;
  const grounding = verifyVerbatimGrounding(rawTxns, fullContextText);

  // Convert to canonical schema
  const canonicalTxns = rawTxns.map((r, idx) => {
    return createCanonicalTransaction({
      txn_id: `REPAIR_P${failingPageNumber}_${idx + 1}`,
      date: normalizeDateString(r.date),
      value_date: r.value_date ? normalizeDateString(r.value_date) : null,
      raw_description: r.description || '',
      amount: Number(r.amount) || 0,
      direction: r.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      balance_after: Number(r.balance) || 0,
      ref_no: r.ref_no || null,
      source_page: failingPageNumber,
      source_line_ids: [idx + 1],
    });
  });

  return {
    page: failingPageNumber,
    transactions: canonicalTxns,
    pageClosingBalance: extracted.page_closing_balance,
    grounding,
  };
}

/**
 * Render a single page from a PDF Buffer into PNG buffer at ~200 DPI
 */
async function renderPdfPageToPng(pdfBuffer, pageNumber) {
  // Extract single page with pdf-lib
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();
  const targetIndex = Math.max(0, Math.min(pageNumber - 1, totalPages - 1));

  const outDoc = await PDFDocument.create();
  const [copiedPage] = await outDoc.copyPages(srcDoc, [targetIndex]);
  outDoc.addPage(copiedPage);
  const singlePagePdfBase64 = Buffer.from(await outDoc.save()).toString('base64');

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    // 200 DPI on A4: 8.27in * 200 = ~1654, 11.69in * 200 = ~2338
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1.5 });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        <style>body { margin: 0; background: white; } canvas { display: block; }</style>
      </head>
      <body>
        <canvas id="pdf-canvas"></canvas>
        <script>
          const pdfData = atob("${singlePagePdfBase64}");
          const uint8Array = new Uint8Array(pdfData.length);
          for (let i = 0; i < pdfData.length; i++) {
            uint8Array[i] = pdfData.charCodeAt(i);
          }
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          pdfjsLib.getDocument({ data: uint8Array }).promise.then(pdf => {
            return pdf.getPage(1).then(page => {
              const viewport = page.getViewport({ scale: 2.0 }); // ~200 DPI
              const canvas = document.getElementById('pdf-canvas');
              const ctx = canvas.getContext('2d');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              return page.render({ canvasContext: ctx, viewport: viewport }).promise;
            });
          }).then(() => {
            window.PAGE_RENDERED = true;
          }).catch(err => {
            window.PAGE_ERROR = err.message;
          });
        </script>
      </body>
      </html>
    `;

    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PAGE_RENDERED || window.PAGE_ERROR, { timeout: 15000 });

    const error = await page.evaluate(() => window.PAGE_ERROR);
    if (error) {
      throw new Error(`PDF.js render failed in Puppeteer: ${error}`);
    }

    const pngBuffer = await page.screenshot({ type: 'png', fullPage: true });
    return pngBuffer;
  } catch (err) {
    // If puppeteer canvas rendering is blocked in environment, fall back to native single-page PDF document
    console.warn(`[claudeExtractor] Puppeteer PNG render fallback to PDF: ${err.message}`);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

/**
 * Tier 4: Vision Fallback
 * Renders page to PNG (200 DPI) or uses PDF base64 document block,
 * and calls Claude Sonnet vision model citing the exact missing balance gap.
 */
async function extractPageWithClaudeVision({
  pdfBuffer,
  failingPageNumber,
  carryInBalance = null,
  gapHint = '',
  detectedBank = '',
}) {
  const claude = getClaudeClient();
  const model = getClaudeModel();

  // Try rendering page to PNG at 200 DPI
  let pngBuffer = null;
  if (pdfBuffer) {
    try {
      pngBuffer = await renderPdfPageToPng(pdfBuffer, failingPageNumber);
    } catch (e) {
      pngBuffer = null;
    }
  }

  // Build message content array (supporting image/png or document/pdf)
  const content = [];

  if (pngBuffer && pngBuffer.length > 0) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: pngBuffer.toString('base64'),
      },
    });
  } else if (pdfBuffer) {
    // Extract single-page PDF chunk
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const outDoc = await PDFDocument.create();
    const [page] = await outDoc.copyPages(srcDoc, [failingPageNumber - 1]);
    outDoc.addPage(page);
    const chunkBase64 = Buffer.from(await outDoc.save()).toString('base64');

    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: chunkBase64,
      },
    });
  }

  const promptText = `You are a high-precision bank statement vision auditor.
Inspect this statement page image for Page ${failingPageNumber} (${detectedBank || 'Bank Statement'}).
A mathematical reconciliation failure occurred here.
EXACT MISSING BALANCE GAP: ${gapHint || 'The running balance chain has a gap.'}
${carryInBalance !== null ? `Carry-in balance at top of page: ₹${carryInBalance.toFixed(2)}` : ''}

Visually examine every line in the transaction table:
1. Locate any obscured, faint, or merged rows that account for the exact missing amount.
2. Read the exact date, narration, debit/credit amount, and balance.
3. Emit all transactions on this page in chronological order using the emit_transactions tool.`;

  content.push({
    type: 'text',
    text: promptText,
  });

  const response = await claude.messages.create({
    model,
    max_tokens: 4096,
    tools: [EMIT_TRANSACTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_transactions' },
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  });

  const toolUse = response.content?.find((c) => c.type === 'tool_use' && c.name === 'emit_transactions');
  if (!toolUse || !toolUse.input) {
    throw new Error(`Claude vision extraction failed to invoke emit_transactions for page ${failingPageNumber}`);
  }

  const rawTxns = toolUse.input.transactions || [];
  const canonicalTxns = rawTxns.map((r, idx) => {
    return createCanonicalTransaction({
      txn_id: `VISION_P${failingPageNumber}_${idx + 1}`,
      date: normalizeDateString(r.date),
      value_date: r.value_date ? normalizeDateString(r.value_date) : null,
      raw_description: r.description || '',
      amount: Number(r.amount) || 0,
      direction: r.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      balance_after: Number(r.balance) || 0,
      ref_no: r.ref_no || null,
      source_page: failingPageNumber,
      source_line_ids: [idx + 1],
    });
  });

  return {
    page: failingPageNumber,
    transactions: canonicalTxns,
    pageClosingBalance: toolUse.input.page_closing_balance,
  };
}

module.exports = {
  EMIT_TRANSACTIONS_TOOL,
  verifyVerbatimGrounding,
  extractPageWithClaudeText,
  renderPdfPageToPng,
  extractPageWithClaudeVision,
};
