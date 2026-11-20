'use strict';

const { createCanonicalTransaction } = require('./canonicalSchema');
const { parseIndianAmount, normalizeDateString, joinWrappedDescriptions, normalizeTransactions } = require('./normalizerService');
const { reconcileTransactions, toPaise, fromPaise } = require('./reconciliationService');
const { extractPageWithClaudeText, extractPageWithClaudeVision } = require('./claudeExtractor');

/**
 * Clean noise lines (headers, page totals, footers) based on layout profile noise patterns
 * and standard table furniture keywords.
 */
function cleanNoiseLines(rawLines = [], noisePatterns = []) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [];

  const compiledNoise = (noisePatterns || []).map((p) => {
    try {
      return new RegExp(p, 'i');
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  const STANDARD_NOISE = [
    /^(?:Page\s+\d+\s+of\s+\d+|Statement\s+Period|Account\s+Number|Customer\s+ID|Nominee|Branch)/i,
    /^(?:Date\s+Particulars|Txn\s*Date\s*Description|Value\s*Date|Debit\s+Credit\s+Balance)/i,
    /^(?:Page\s+Total|Grand\s+Total|Brought\s+Forward|Carried\s+Forward|Closing\s+Balance)/i,
    /^(?:\*\*This\s+is\s+a\s+computer|End\s+of\s+Statement|Legends?\s*used|Registered\s+Office)/i,
    /cbdrpt\d+|https?:\/\//i,
  ];

  const cleaned = [];
  for (const line of rawLines) {
    const s = String(line || '').trim();
    if (!s) continue;

    // Check custom noise regexes
    const isCustomNoise = compiledNoise.some((rx) => rx.test(s));
    if (isCustomNoise) continue;

    // Check standard noise
    const isStandardNoise = STANDARD_NOISE.some((rx) => rx.test(s));
    if (isStandardNoise) continue;

    cleaned.push(s);
  }

  return cleaned;
}

/**
 * Tier 1/2: Fast deterministic regex and x-band table parser driven by layout profile.
 * Parses statement pages into candidate canonical transactions.
 */
function parseStatementWithLayoutProfile(pages = [], profile = {}) {
  const columnBands = profile.columnBands || [];
  const noisePatterns = profile.noisePatterns || [];
  const dateFormats = profile.dateFormats || ['DD/MM/YYYY'];
  const sortOrder = profile.sortOrder || 'ASC';

  const rawRows = [];

  for (const page of pages) {
    const pageNum = page.pageNumber || 1;
    const items = page.items || [];

    if (items.length > 0 && columnBands.length > 0) {
      // 1. Geometry X-Band Extraction
      // Group items into y-buckets
      const yBuckets = new Map();
      for (const it of items) {
        const yKey = Math.round((it.y || 0) / 3) * 3;
        if (!yBuckets.has(yKey)) yBuckets.set(yKey, []);
        yBuckets.get(yKey).push(it);
      }

      // Sort descending by y (top of page to bottom)
      const sortedYs = Array.from(yBuckets.keys()).sort((a, b) => b - a);

      for (const y of sortedYs) {
        const lineItems = yBuckets.get(y).sort((a, b) => (a.x || 0) - (b.x || 0));
        const joinedLine = lineItems.map((c) => c.str).join(' ').trim();

        // Skip noise lines
        const isNoise = cleanNoiseLines([joinedLine], noisePatterns).length === 0;
        if (isNoise) continue;

        // Assign cells to column bands
        const rowCells = {};
        for (const cell of lineItems) {
          const cx = cell.x + (cell.w || cell.str.length * 4.5) / 2;
          for (const band of columnBands) {
            if (cx >= band.minX - 10 && cx <= band.maxX + 10) {
              rowCells[band.name] = (rowCells[band.name] ? `${rowCells[band.name]} ` : '') + cell.str.trim();
            }
          }
        }

        // If line has date and balance/amount, create row
        if (rowCells.date && /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(rowCells.date)) {
          rawRows.push({
            date: rowCells.date,
            value_date: rowCells.valueDate || null,
            raw_description: rowCells.narration || '',
            debit: rowCells.debit || '0',
            credit: rowCells.credit || '0',
            amount: rowCells.amount || '0',
            balance: rowCells.balance || '0',
            ref_no: rowCells.reference || rowCells.chequeRef || null,
            source_page: pageNum,
            line_id: rawRows.length + 1,
          });
        }
      }
    } else {
      // 2. Fast Deterministic Regex Line Parser
      const rawLines = (page.text || '').split(/\r?\n/);
      const cleaned = cleanNoiseLines(rawLines, noisePatterns);

      // Regex matching standard Indian statement line:
      // Date + Narration + Debit/Credit amounts + Balance
      const ROW_REGEX = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(.+?)\s+([\d,]+\.\d\d)\s+(?:(Cr|Dr)\s+)?([\d,]+\.\d\d)(?:\s+(Cr|Dr))?$/i;
      const SPLIT_ROW_REGEX = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(.+?)\s+([\d,]+\.\d\d)\s+([\d,]+\.\d\d)\s+([\d,]+\.\d\d)(?:\s+(Cr|Dr))?$/i;

      for (let lIdx = 0; lIdx < cleaned.length; lIdx++) {
        const line = cleaned[lIdx];
        const mSplit = line.match(SPLIT_ROW_REGEX);
        if (mSplit) {
          rawRows.push({
            date: mSplit[1],
            raw_description: mSplit[2],
            debit: mSplit[3],
            credit: mSplit[4],
            balance: mSplit[5],
            source_page: pageNum,
            line_id: lIdx + 1,
          });
          continue;
        }

        const mSingle = line.match(ROW_REGEX);
        if (mSingle) {
          const amt = mSingle[3];
          const tag = mSingle[4] || mSingle[6];
          rawRows.push({
            date: mSingle[1],
            raw_description: mSingle[2],
            amount: amt,
            direction: tag === 'Cr' ? 'CREDIT' : (tag === 'Dr' ? 'DEBIT' : undefined),
            balance: mSingle[5],
            source_page: pageNum,
            line_id: lIdx + 1,
          });
        }
      }
    }
  }

  // Normalize rows into canonical schema
  return normalizeTransactions(rawRows, { sortOrder });
}

/**
 * Splice repaired page transactions into the main transaction array.
 * Replaces all transactions belonging to `failingPage` with `repairedTransactions`.
 */
function spliceRepairedPageRows(mainTransactions = [], failingPage, repairedTransactions = []) {
  const result = [];
  let spliced = false;

  for (const t of mainTransactions) {
    if (t.source_page === failingPage) {
      if (!spliced) {
        result.push(...repairedTransactions);
        spliced = true;
      }
    } else {
      result.push(t);
    }
  }

  // If no transactions previously existed for this page, append
  if (!spliced) {
    result.push(...repairedTransactions);
    result.sort((a, b) => a.source_page - b.source_page);
  }

  return result;
}

/**
 * Helper to get 8 overlap lines from a given page
 */
function getPageOverlapLines(pages = [], targetPageNumber, position = 'PRECEDING') {
  const targetIdx = pages.findIndex((p) => p.pageNumber === targetPageNumber);
  if (targetIdx === -1) return '';

  const neighborIdx = position === 'PRECEDING' ? targetIdx - 1 : targetIdx + 1;
  if (neighborIdx < 0 || neighborIdx >= pages.length) return '';

  const neighborLines = (pages[neighborIdx].text || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (position === 'PRECEDING') {
    return neighborLines.slice(-8).join('\n');
  } else {
    return neighborLines.slice(0, 8).join('\n');
  }
}

/**
 * Tiered Extraction Pipeline and Automated Page Repair Loop
 *
 * Steps:
 * 1. Tier 1/2 Code Parser:
 *    Parses statement via fast regex/x-band layout profile.
 *    Runs reconciliationService. If pass (verified == true), returns result immediately.
 * 2. Tier 3 Claude Text Extraction Repair:
 *    Isolates failing pages. Calls Claude with emit_transactions and verbatim grounding.
 *    Splices repaired rows back in and re-reconciles.
 * 3. Tier 4 Vision Fallback:
 *    If Tier 3 still has failing pages or statement is scanned, renders page image and calls Claude Vision.
 */
async function extractAndReconcileStatement({
  pages = [],
  profile = {},
  pdfBuffer = null,
  options = {},
}) {
  const tierLogs = [];

  // =========================================================================
  // STEP 1: Tier 1/2 Deterministic Code Parser
  // =========================================================================
  tierLogs.push('Starting Tier 1/2 (Deterministic Code Parser)');
  let currentTransactions = parseStatementWithLayoutProfile(pages, profile);

  let reconResult = reconcileTransactions(currentTransactions, {
    openingBalance: options.openingBalance,
    closingBalance: options.closingBalance,
    pageTotals: options.pageTotals,
    footerTotals: options.footerTotals,
    isSingleColumnLedger: profile.amountConvention === 'SINGLE_UNSIGNED_BALANCE_DELTA',
  });

  if (reconResult.verified) {
    tierLogs.push('Tier 1/2 parsed and cleanly verified. Exiting extraction immediately.');
    return {
      tierUsed: 'Tier 1/2 (Code Parser)',
      reconResult,
      tierLogs,
    };
  }

  tierLogs.push(`Tier 1/2 failed reconciliation with ${reconResult.chainBreaks} break(s) on pages: [${reconResult.failing_pages.join(', ')}]`);

  // =========================================================================
  // STEP 2: Tier 3 Claude Text Extraction Repair Loop
  // =========================================================================
  const failingPages = [...reconResult.failing_pages];
  let tier3Attempted = false;

  if (failingPages.length > 0 && options.enableClaudeRepair !== false) {
    tier3Attempted = true;
    tierLogs.push(`Entering Tier 3 (Claude Text Extraction Repair) for pages: ${failingPages.join(', ')}`);

    for (const failPageNum of failingPages) {
      const pageObj = pages.find((p) => p.pageNumber === failPageNum);
      if (!pageObj || !pageObj.text) continue;

      const precedingOverlap = getPageOverlapLines(pages, failPageNum, 'PRECEDING');
      const succeedingOverlap = getPageOverlapLines(pages, failPageNum, 'SUCCEEDING');

      // Find carry-in balance before this page from currentTransactions
      const txnsBeforePage = currentTransactions.filter((t) => (t.source_page || 1) < failPageNum);
      const carryInBalance = txnsBeforePage.length > 0 ? txnsBeforePage[txnsBeforePage.length - 1].balance_after : (options.openingBalance || null);

      const matchingGapHint = reconResult.gap_hints.find((h) => h.includes(`page ${failPageNum}`)) || '';

      try {
        const repairRes = await extractPageWithClaudeText({
          failingPageNumber: failPageNum,
          pageText: pageObj.text,
          precedingOverlapText: precedingOverlap,
          succeedingOverlapText: succeedingOverlap,
          carryInBalance,
          gapHint: matchingGapHint,
          detectedBank: profile.bankName,
        });

        tierLogs.push(`Tier 3 page ${failPageNum} extracted ${repairRes.transactions.length} rows (grounded: ${repairRes.grounding.verified})`);

        // Splice repaired rows and re-reconcile
        currentTransactions = spliceRepairedPageRows(currentTransactions, failPageNum, repairRes.transactions);
      } catch (err) {
        tierLogs.push(`Tier 3 failed for page ${failPageNum}: ${err.message}`);
      }
    }

    // Re-reconcile after Tier 3 repairs
    reconResult = reconcileTransactions(currentTransactions, {
      openingBalance: options.openingBalance,
      closingBalance: options.closingBalance,
      pageTotals: options.pageTotals,
      footerTotals: options.footerTotals,
      isSingleColumnLedger: profile.amountConvention === 'SINGLE_UNSIGNED_BALANCE_DELTA',
    });

    if (reconResult.verified) {
      tierLogs.push('Tier 3 Claude text repair successfully reconciled statement.');
      return {
        tierUsed: 'Tier 3 (Claude Text Repair)',
        reconResult,
        tierLogs,
      };
    }
  }

  // =========================================================================
  // STEP 3: Tier 4 Vision Fallback
  // =========================================================================
  const remainingFailingPages = reconResult.failing_pages;
  if (remainingFailingPages.length > 0 && options.enableVisionFallback !== false && pdfBuffer) {
    tierLogs.push(`Entering Tier 4 (Vision Fallback) for pages: ${remainingFailingPages.join(', ')}`);

    for (const failPageNum of remainingFailingPages) {
      const txnsBeforePage = currentTransactions.filter((t) => (t.source_page || 1) < failPageNum);
      const carryInBalance = txnsBeforePage.length > 0 ? txnsBeforePage[txnsBeforePage.length - 1].balance_after : (options.openingBalance || null);
      const matchingGapHint = reconResult.gap_hints.find((h) => h.includes(`page ${failPageNum}`)) || '';

      try {
        const visionRes = await extractPageWithClaudeVision({
          pdfBuffer,
          failingPageNumber: failPageNum,
          carryInBalance,
          gapHint: matchingGapHint,
          detectedBank: profile.bankName,
        });

        tierLogs.push(`Tier 4 vision extracted ${visionRes.transactions.length} rows for page ${failPageNum}`);
        currentTransactions = spliceRepairedPageRows(currentTransactions, failPageNum, visionRes.transactions);
      } catch (err) {
        tierLogs.push(`Tier 4 vision failed for page ${failPageNum}: ${err.message}`);
      }
    }

    // Final reconciliation
    reconResult = reconcileTransactions(currentTransactions, {
      openingBalance: options.openingBalance,
      closingBalance: options.closingBalance,
      pageTotals: options.pageTotals,
      footerTotals: options.footerTotals,
      isSingleColumnLedger: profile.amountConvention === 'SINGLE_UNSIGNED_BALANCE_DELTA',
    });
  }

  return {
    tierUsed: reconResult.verified ? (tier3Attempted ? 'Tier 3/4 (Claude Automated Repair)' : 'Tier 1/2 (Code Parser)') : 'FAILED_RECONCILIATION',
    reconResult,
    tierLogs,
  };
}

module.exports = {
  cleanNoiseLines,
  parseStatementWithLayoutProfile,
  spliceRepairedPageRows,
  getPageOverlapLines,
  extractAndReconcileStatement,
};

