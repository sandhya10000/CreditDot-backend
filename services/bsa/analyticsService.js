'use strict';

const { toPaise, fromPaise } = require('./reconciliationService');
const { runForensicAnalysis } = require('./forensicsEngine');

/**
 * Helper to parse DD-MM-YYYY, YYYY-MM-DD, or DD/MM/YYYY into a Date object (UTC noon to avoid DST/tz jumps)
 */
function parseDateUtc(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  const parts = s.split(/[-/.]/);
  if (parts.length === 3) {
    let yyyy, mm, dd;
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      yyyy = Number(parts[0]);
      mm = Number(parts[1]);
      dd = Number(parts[2]);
    } else {
      // DD-MM-YYYY
      dd = Number(parts[0]);
      mm = Number(parts[1]);
      yyyy = Number(parts[2]);
      if (yyyy < 100) yyyy = 2000 + yyyy;
    }
    return new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1, 12, 0, 0));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function formatDateIso(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatMonthKey(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Standard Deviation and Coefficient of Variation
 */
function computeArrayStats(arr = []) {
  if (!arr || arr.length === 0) return { mean: 0, stdDev: 0, cv: 0 };
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  if (n <= 1) return { mean, stdDev: 0, cv: 0 };
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  return {
    mean: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    cv: parseFloat(cv.toFixed(4)),
  };
}

/**
 * Deterministic Analytics Aggregator
 *
 * Requirements:
 * 1. Genuine Monthly Income:
 *    Gross Credits - (Self-Transfers + Loan Disbursements + Reversals + Internal GL Transfers + Refunds)
 * 2. Income Stability CV:
 *    StandardDeviation(Monthly Genuine Income) / Mean(Monthly Genuine Income)
 * 3. EOD Balance Series:
 *    Calendar-day carry-forward across all calendar days in statement period
 * 4. Compute:
 *    Average EOD, Minimum EOD, Maximum EOD, % Days < ₹1,000, % Days < ₹10,000
 * 5. FOIR:
 *    Total Monthly Detected EMIs / Monthly Genuine Income
 */
function computeDeterministicAnalytics(transactions = [], options = {}) {
  const accountHolderName = options.accountHolderName || '';
  const initialOpeningBalance = options.openingBalance !== undefined ? options.openingBalance : (transactions[0] ? transactions[0].balance_after : 0);

  // 1. Run Forensic Analysis for exclusions, loan debits, and self-transfers
  const forensics = runForensicAnalysis(transactions, { accountHolderName });
  const excludedTxnIds = new Set(forensics.reversalsAndBounces.excludedTxnIds);

  const selfTransferTxnIds = new Set(forensics.circularAndSelf.selfTransfers.map((t) => t.txn_id));

  // Identify GL / Internal Transfers and Refunds
  const INTERNAL_GL_REFUND_REGEX = /\b(?:INTERNAL\s*TRF|GL\s*TRF|AUTO\s*SWEEP|MOD\s*TRF|SWEEP\s*TRF|INTEREST|REFUND|REVERSAL|CASHBACK)\b/i;

  // 2. Compute Monthly Genuine Incomes
  const monthlyBuckets = new Map(); // monthKey -> { grossCredits, excludedCredits, genuineCredits, debits }

  let totalGrossCreditsPaise = 0;
  let totalExcludedCreditsPaise = 0;
  let totalGenuineCreditsPaise = 0;
  let totalDebitsPaise = 0;

  for (const txn of transactions) {
    const d = parseDateUtc(txn.date);
    const monthKey = d ? formatMonthKey(d) : 'UNKNOWN_MONTH';

    if (!monthlyBuckets.has(monthKey)) {
      monthlyBuckets.set(monthKey, {
        grossCreditsPaise: 0,
        excludedCreditsPaise: 0,
        genuineCreditsPaise: 0,
        debitsPaise: 0,
        exclusionsBreakdown: {
          selfTransfers: 0,
          loanDisbursements: 0,
          reversals: 0,
          internalGlRefunds: 0,
        },
      });
    }

    const bucket = monthlyBuckets.get(monthKey);
    const amtPaise = toPaise(txn.amount);

    if (txn.direction === 'CREDIT') {
      totalGrossCreditsPaise += amtPaise;
      bucket.grossCreditsPaise += amtPaise;

      let isExcluded = false;
      let reason = null;

      // Check Reversals
      if (excludedTxnIds.has(txn.txn_id)) {
        isExcluded = true;
        reason = 'reversals';
        bucket.exclusionsBreakdown.reversals += txn.amount;
      }
      // Check Self Transfers
      else if (selfTransferTxnIds.has(txn.txn_id)) {
        isExcluded = true;
        reason = 'selfTransfers';
        bucket.exclusionsBreakdown.selfTransfers += txn.amount;
      }
      // Check Loan Disbursements
      else if (txn.raw_description && /\b(?:DISBURSAL|LOAN\s*DISB|SANCTION|FINANCE|CAPITAL|LENDING|KREDITBEE|NAVI|MONEYVIEW)\b/i.test(txn.raw_description)) {
        isExcluded = true;
        reason = 'loanDisbursements';
        bucket.exclusionsBreakdown.loanDisbursements += txn.amount;
      }
      // Check Internal GL transfers / refunds
      else if (txn.raw_description && INTERNAL_GL_REFUND_REGEX.test(txn.raw_description)) {
        isExcluded = true;
        reason = 'internalGlRefunds';
        bucket.exclusionsBreakdown.internalGlRefunds += txn.amount;
      }

      if (isExcluded) {
        totalExcludedCreditsPaise += amtPaise;
        bucket.excludedCreditsPaise += amtPaise;
      } else {
        totalGenuineCreditsPaise += amtPaise;
        bucket.genuineCreditsPaise += amtPaise;
      }
    } else {
      totalDebitsPaise += amtPaise;
      bucket.debitsPaise += amtPaise;
    }
  }

  // Monthly income series & stability metrics
  const monthKeys = Array.from(monthlyBuckets.keys()).sort();
  const monthlyGenuineIncomes = [];

  for (const mKey of monthKeys) {
    const b = monthlyBuckets.get(mKey);
    monthlyGenuineIncomes.push(fromPaise(b.genuineCreditsPaise));
  }

  const incomeStats = computeArrayStats(monthlyGenuineIncomes);
  const monthlyGenuineIncome = incomeStats.mean;
  const incomeStabilityCv = incomeStats.cv; // StandardDeviation / Mean

  // 3. EOD Balance Series (Calendar-day carry-forward across all calendar days)
  let eodSeries = [];
  let avgEod = 0;
  let minEod = 0;
  let maxEod = 0;
  let daysBelow1k = 0;
  let daysBelow10k = 0;
  let totalCalendarDays = 0;

  if (transactions.length > 0) {
    // Map transaction dates to final running balance of that day
    const dayFinalBalanceMap = new Map();
    let minDateTs = Infinity;
    let maxDateTs = -Infinity;

    for (const t of transactions) {
      const d = parseDateUtc(t.date);
      if (!d) continue;
      const iso = formatDateIso(d);
      dayFinalBalanceMap.set(iso, t.balance_after); // Last transaction of day holds EOD balance

      const ts = d.getTime();
      if (ts < minDateTs) minDateTs = ts;
      if (ts > maxDateTs) maxDateTs = ts;
    }

    if (Number.isFinite(minDateTs) && Number.isFinite(maxDateTs)) {
      const cur = new Date(minDateTs);
      const end = new Date(maxDateTs);
      let runningCarryBalance = initialOpeningBalance;
      const allBalances = [];

      while (cur <= end) {
        const iso = formatDateIso(cur);
        if (dayFinalBalanceMap.has(iso)) {
          runningCarryBalance = dayFinalBalanceMap.get(iso);
        }

        eodSeries.push({
          date: iso,
          balance: runningCarryBalance,
        });

        allBalances.push(runningCarryBalance);
        if (runningCarryBalance < 1000) daysBelow1k++;
        if (runningCarryBalance < 10000) daysBelow10k++;

        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      totalCalendarDays = allBalances.length;
      if (totalCalendarDays > 0) {
        const sumBal = allBalances.reduce((a, b) => a + b, 0);
        avgEod = parseFloat((sumBal / totalCalendarDays).toFixed(2));
        minEod = Math.min(...allBalances);
        maxEod = Math.max(...allBalances);
      }
    }
  }

  const pctDaysBelow1k = totalCalendarDays > 0 ? parseFloat(((daysBelow1k / totalCalendarDays) * 100).toFixed(2)) : 0;
  const pctDaysBelow10k = totalCalendarDays > 0 ? parseFloat(((daysBelow10k / totalCalendarDays) * 100).toFixed(2)) : 0;

  // 4. Detected EMIs and FOIR
  const loanForensics = forensics.loansAndEmis;
  const totalMonthlyEmi = loanForensics.totalMonthlyEmi;
  let foir = null;
  if (monthlyGenuineIncome > 0) {
    foir = parseFloat(((totalMonthlyEmi / monthlyGenuineIncome) * 100).toFixed(2));
  }

  // Monthly Outflow (average monthly debit)
  const monthlyDebits = monthKeys.map((k) => fromPaise(monthlyBuckets.get(k).debitsPaise));
  const avgMonthlyOutflow = computeArrayStats(monthlyDebits).mean;

  return {
    summary: {
      totalGrossCredits: fromPaise(totalGrossCreditsPaise),
      totalExcludedCredits: fromPaise(totalExcludedCreditsPaise),
      totalGenuineCredits: fromPaise(totalGenuineCreditsPaise),
      totalDebits: fromPaise(totalDebitsPaise),
      monthlyGenuineIncome,
      incomeStabilityCv,
      totalMonthlyEmi,
      foir,
      avgMonthlyOutflow,
    },
    monthlyBreakdown: monthKeys.map((k) => {
      const b = monthlyBuckets.get(k);
      return {
        month: k,
        grossCredits: fromPaise(b.grossCreditsPaise),
        excludedCredits: fromPaise(b.excludedCreditsPaise),
        genuineIncome: fromPaise(b.genuineCreditsPaise),
        debits: fromPaise(b.debitsPaise),
        exclusions: b.exclusionsBreakdown,
      };
    }),
    eodMetrics: {
      totalCalendarDays,
      avgEod,
      minEod,
      maxEod,
      daysBelow1k,
      daysBelow10k,
      pctDaysBelow1k,
      pctDaysBelow10k,
      eodSeries,
    },
    forensics,
  };
}

module.exports = {
  parseDateUtc,
  formatDateIso,
  formatMonthKey,
  computeArrayStats,
  computeDeterministicAnalytics,
};

