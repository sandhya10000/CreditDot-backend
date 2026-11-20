'use strict';

/**
 * Mathematical Reconciliation Engine for Bank Statements
 *
 * Implements:
 * 1. Running balance formula:
 *    expected_balance = prev_balance + (direction === 'CREDIT' ? amount : -amount)
 * 2. Single-column ledger support (e.g. BoB REP31):
 *    Infers transaction direction dynamically via delta = current_balance - prev_balance
 * 3. Split-column auto-correction:
 *    If mismatch == -2 * amount (swapped debit/credit column), auto-corrects direction and
 *    sets flag DIRECTION_CORRECTED.
 * 4. Re-anchoring balance on mismatch:
 *    Prevents cascading failures when a single row is missing or corrupted.
 * 5. Page Totals & Statement Footer Totals verification.
 * 6. Explicit break diagnostic:
 *    Returns `failing_pages` array and specific gap hints (e.g. "missing ₹3,765.00 on page 7").
 */

// Helper to convert float rupees to exact integer paise to eliminate JS floating point errors
function toPaise(val) {
  return Math.round((Number(val) || 0) * 100);
}

function fromPaise(paise) {
  return Math.round(paise) / 100;
}

/**
 * Reconcile canonical transactions against the running balance chain.
 *
 * @param {Array} transactions - Array of canonical transactions
 * @param {Object} options - Configuration and expected totals
 *   - openingBalance: number (initial account balance before first transaction)
 *   - closingBalance: number (expected closing balance)
 *   - pageTotals: Array of { page: number, totalDebit: number, totalCredit: number }
 *   - footerTotals: { totalDebit: number, totalCredit: number }
 *   - isSingleColumnLedger: boolean (true if statement amount is unsigned single column)
 */
function reconcileTransactions(transactions = [], options = {}) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return {
      status: 'EMPTY',
      verified: true,
      chainBreaks: 0,
      transactions: [],
      breaks: [],
      failing_pages: [],
      gap_hints: [],
      reconciledClosingBalance: 0,
    };
  }

  const txns = transactions.map((t) => ({ ...t }));
  const breaks = [];
  const repairs = [];
  const failingPagesSet = new Set();
  const gapHints = [];

  // Determine starting balance:
  // Use options.openingBalance if provided; else back-compute from first transaction
  let prevBalancePaise = null;
  if (options.openingBalance !== undefined && options.openingBalance !== null && !Number.isNaN(options.openingBalance)) {
    prevBalancePaise = toPaise(options.openingBalance);
  } else {
    // Back-compute opening balance from transaction 0
    const t0 = txns[0];
    const t0Amt = toPaise(t0.amount);
    const t0Bal = toPaise(t0.balance_after);
    prevBalancePaise = t0.direction === 'CREDIT' ? t0Bal - t0Amt : t0Bal + t0Amt;
  }

  let totalCreditPaise = 0;
  let totalDebitPaise = 0;

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    let amountPaise = toPaise(txn.amount);
    const currentBalPaise = toPaise(txn.balance_after);
    const pageNum = txn.source_page || 1;

    // 1. Single-column ledger dynamic direction inference
    if (options.isSingleColumnLedger || txn.direction === undefined || txn.direction === null) {
      const delta = currentBalPaise - prevBalancePaise;
      if (delta > 0) {
        txn.direction = 'CREDIT';
        if (amountPaise === 0) amountPaise = delta;
      } else if (delta < 0) {
        txn.direction = 'DEBIT';
        if (amountPaise === 0) amountPaise = Math.abs(delta);
      }
      txn.amount = fromPaise(amountPaise);
    }

    // 2. Expected balance formula
    let expectedBalPaise =
      txn.direction === 'CREDIT'
        ? prevBalancePaise + amountPaise
        : prevBalancePaise - amountPaise;

    // Check discrepancy
    const diffPaise = currentBalPaise - expectedBalPaise;

    if (Math.abs(diffPaise) > 1) {
      // 3. Split-column swap check:
      // If column assignment was inverted (Dr placed in Cr or vice-versa),
      // the error in expected balance is exactly -2 * (signed amount).
      // For instance: prev = 1000, cr = 200 -> expected = 1200.
      // If it was actually a debit of 200, balance is 800.
      // diff = 800 - 1200 = -400 = -2 * 200.
      const swappedExpectedPaise =
        txn.direction === 'CREDIT'
          ? prevBalancePaise - amountPaise // what if it was debit?
          : prevBalancePaise + amountPaise; // what if it was credit?

      if (Math.abs(currentBalPaise - swappedExpectedPaise) <= 1) {
        // Auto-correct column assignment
        const oldDirection = txn.direction;
        txn.direction = oldDirection === 'CREDIT' ? 'DEBIT' : 'CREDIT';
        txn.flags = txn.flags || [];
        txn.flags.push('DIRECTION_CORRECTED');

        repairs.push({
          type: 'DIRECTION_CORRECTED',
          txn_id: txn.txn_id,
          page: pageNum,
          from: oldDirection,
          to: txn.direction,
          amount: txn.amount,
          reconciledBalance: fromPaise(currentBalPaise),
        });

        // Balance now matches after correction
        expectedBalPaise = currentBalPaise;
      } else {
        // Real chain break detected
        const gapRupees = fromPaise(Math.abs(diffPaise));
        const hint = `Missing ₹${gapRupees.toFixed(2)} on page ${pageNum} around ${txn.date} (${txn.txn_id})`;

        breaks.push({
          txn_id: txn.txn_id,
          page: pageNum,
          expected_balance: fromPaise(expectedBalPaise),
          actual_balance: fromPaise(currentBalPaise),
          discrepancy: fromPaise(diffPaise),
          gap_hint: hint,
        });

        failingPagesSet.add(pageNum);
        gapHints.push(hint);

        // 4. Re-anchor balance on mismatch to prevent cascading failure
        // The chain resumes from the printed running balance of this row
        prevBalancePaise = currentBalPaise;
      }
    }

    // Accumulate verified debit/credit
    if (txn.direction === 'CREDIT') {
      totalCreditPaise += toPaise(txn.amount);
    } else {
      totalDebitPaise += toPaise(txn.amount);
    }

    // Advance running balance
    prevBalancePaise = currentBalPaise;
  }

  // 5. Verify Page Totals if provided
  const pageTotalMismatches = [];
  if (Array.isArray(options.pageTotals) && options.pageTotals.length > 0) {
    for (const pt of options.pageTotals) {
      const pageTxns = txns.filter((t) => (t.source_page || 1) === pt.page);
      const computedCr = pageTxns.reduce((sum, t) => sum + (t.direction === 'CREDIT' ? toPaise(t.amount) : 0), 0);
      const computedDr = pageTxns.reduce((sum, t) => sum + (t.direction === 'DEBIT' ? toPaise(t.amount) : 0), 0);

      const expectedCr = toPaise(pt.totalCredit);
      const expectedDr = toPaise(pt.totalDebit);

      if (Math.abs(computedCr - expectedCr) > 5 || Math.abs(computedDr - expectedDr) > 5) {
        pageTotalMismatches.push({
          page: pt.page,
          expectedCredit: fromPaise(expectedCr),
          computedCredit: fromPaise(computedCr),
          expectedDebit: fromPaise(expectedDr),
          computedDebit: fromPaise(computedDr),
        });
        failingPagesSet.add(pt.page);
        gapHints.push(`Page total mismatch on page ${pt.page}`);
      }
    }
  }

  // 6. Verify Statement Footer Totals if provided
  let footerTotalVerified = true;
  let footerMismatch = null;
  if (options.footerTotals) {
    const expCr = toPaise(options.footerTotals.totalCredit);
    const expDr = toPaise(options.footerTotals.totalDebit);

    if (Math.abs(totalCreditPaise - expCr) > 5 || Math.abs(totalDebitPaise - expDr) > 5) {
      footerTotalVerified = false;
      footerMismatch = {
        expectedCredit: fromPaise(expCr),
        computedCredit: fromPaise(totalCreditPaise),
        expectedDebit: fromPaise(expDr),
        computedDebit: fromPaise(totalDebitPaise),
      };
      gapHints.push(
        `Footer totals mismatch: expected Cr ₹${fromPaise(expCr)}, Dr ₹${fromPaise(expDr)} vs computed Cr ₹${fromPaise(totalCreditPaise)}, Dr ₹${fromPaise(totalDebitPaise)}`
      );
    }
  }

  const isVerified = breaks.length === 0 && pageTotalMismatches.length === 0 && footerTotalVerified;

  return {
    status: isVerified ? 'VERIFIED' : 'FAILED',
    verified: isVerified,
    chainBreaks: breaks.length,
    breaks,
    repairs,
    failing_pages: Array.from(failingPagesSet).sort((a, b) => a - b),
    gap_hints: gapHints,
    pageTotalMismatches,
    footerMismatch,
    totalCredits: fromPaise(totalCreditPaise),
    totalDebits: fromPaise(totalDebitPaise),
    reconciledOpeningBalance: options.openingBalance !== undefined ? options.openingBalance : fromPaise(toPaise(txns[0].balance_after) - (txns[0].direction === 'CREDIT' ? toPaise(txns[0].amount) : -toPaise(txns[0].amount))),
    reconciledClosingBalance: fromPaise(prevBalancePaise),
    transactions: txns,
  };
}

module.exports = {
  toPaise,
  fromPaise,
  reconcileTransactions,
};

