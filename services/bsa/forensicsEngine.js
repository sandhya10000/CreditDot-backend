'use strict';

const { toPaise, fromPaise } = require('./reconciliationService');
const { enrichNarration } = require('./enrichmentService');

/**
 * Forensic Analysis Engine for Bank Statements
 *
 * Capabilities:
 * 1. Loan & EMI Auto-Detection (Interval clustering 26-35 days, CV <= 0.05, NACH/Mandates, FOIR)
 * 2. Circular Money & Self-Transfer Engine (Token similarity, RRN mirroring, Round-tripping <= 48h)
 * 3. Reversals & Bounces (RRN matching, bounce charge detection)
 */

const KNOWN_LENDERS_AND_MANDATES = [
  'BAJAJ FINANCE',
  'BAJAJ FINSERV',
  'NAVI',
  'IDFC FIRST',
  'IDFC',
  'KREDITBEE',
  'KRAZYBEE',
  'MONEYVIEW',
  'CASHE',
  'FIBE',
  'EARLYSALARY',
  'TATA CAPITAL',
  'HDFC BANK LOAN',
  'ICICI BANK LOAN',
  'SBI LOAN',
  'KOTAK MAHINDRA PRIME',
  'MUTHOOT',
  'MANAPPURAM',
  'MAHINDRA FINANCE',
  'CHOLAMANDALAM',
  'L&T FINANCE',
  'PIRAMAL',
  'ADITYA BIRLA',
  'POONAWALLA',
  'HERO FINCORP',
  'HOME CREDIT',
  'DMI FINANCE',
  'KISHTU',
  'ZOPA',
  'RING',
  'ZESTMONEY',
];

const BOUNCE_CHARGE_REGEX = /\b(?:RTN\s*CHG|RETURN\s*CHG|INSUFFICIENT\s*FUNDS|NACH\s*RETURN|ECS\s*BOUNCE|CHEQUE\s*RETURN|CHQ\s*RET|BOUNCE\s*CHG|ECS\s*RET|MANDATE\s*FAIL)\b/i;

/**
 * Standard date parser returning timestamp in ms
 */
function parseDateToTs(dStr) {
  if (!dStr) return 0;
  const parts = String(dStr).split(/[-/.]/);
  if (parts.length === 3) {
    let [dd, mm, yyyy] = parts.map(Number);
    if (yyyy < 100) yyyy = 2000 + yyyy;
    // Check if format is YYYY-MM-DD
    if (parts[0].length === 4) {
      yyyy = Number(parts[0]);
      mm = Number(parts[1]);
      dd = Number(parts[2]);
    }
    return new Date(yyyy, (mm || 1) - 1, dd || 1).getTime();
  }
  const t = Date.parse(dStr);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Tokenize string into alphanumeric words for similarity
 */
function tokenizeWords(str) {
  return String(str || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Calculate Jaccard token similarity (0.0 to 1.0)
 */
function computeTokenSimilarity(str1, str2) {
  const set1 = new Set(tokenizeWords(str1));
  const set2 = new Set(tokenizeWords(str2));
  if (set1.size === 0 || set2.size === 0) return 0;

  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract surname / family name from full name
 */
function extractSurname(name) {
  const words = tokenizeWords(name);
  return words.length > 1 ? words[words.length - 1] : '';
}

/**
 * Helper: Mean and Standard Deviation
 */
function computeStats(arr = []) {
  if (!arr || arr.length === 0) return { mean: 0, stdDev: 0, cv: 0 };
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  if (n <= 1) return { mean, stdDev: 0, cv: 0 };
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  return { mean, stdDev, cv };
}

// =========================================================================
// 1. LOAN & EMI AUTO-DETECTION ENGINE
// =========================================================================

/**
 * Detects recurring loan debits, mandates, monthly EMI obligations, and FOIR.
 *
 * Requirements:
 * - Recurring debits using interval clustering: 26 to 35 days periodicity, amount CV <= 0.05
 * - Mandate and loan app matching: NACH/ACH (`BAJAJ FINANCE`, `NAVI`, `IDFC`, etc.) or `autopay.mandate...`
 * - Computes monthly EMI obligation and FOIR
 */
function detectLoansAndEmis(transactions = [], genuineMonthlyIncome = 0) {
  const debits = transactions.filter((t) => t.direction === 'DEBIT' && t.amount > 0);

  // Group debits by counterparty / narrative key
  const groups = new Map();

  for (const d of debits) {
    const raw = (d.raw_description || '').toUpperCase();
    let lenderName = null;

    // 1. Check known lenders
    for (const lender of KNOWN_LENDERS_AND_MANDATES) {
      if (raw.includes(lender)) {
        lenderName = lender;
        break;
      }
    }

    // 2. Check mandate patterns (NACH/ACH/autopay)
    const isMandate =
      /\b(?:ACH\b|NACH\b|AUTOPAY|MANDATE|ECS)\b/i.test(raw) ||
      /autopay\.mandate|mandate\./i.test(raw);

    // Create clustering key
    const clusterKey = lenderName || (isMandate ? 'MANDATE_DEBIT' : tokenizeWords(raw).slice(0, 3).join('_'));

    if (!groups.has(clusterKey)) {
      groups.set(clusterKey, []);
    }
    groups.get(clusterKey).push({
      ...d,
      lenderName,
      isMandate,
      ts: parseDateToTs(d.date),
    });
  }

  const detectedEmis = [];
  let totalMonthlyEmiPaise = 0;

  for (const [key, items] of groups.entries()) {
    if (items.length < 2) {
      // Single loan debit with an explicit known lender or mandate keyword
      const item = items[0];
      if (item.lenderName || item.isMandate) {
        detectedEmis.push({
          lenderName: item.lenderName || 'Loan / Mandate Partner',
          mandateKey: key,
          monthlyEmi: item.amount,
          frequencyDays: 30,
          confidence: 'CONFIRMED_MANDATE',
          cv: 0,
          transactionCount: 1,
          transactions: [item.txn_id],
        });
        totalMonthlyEmiPaise += toPaise(item.amount);
      }
      continue;
    }

    // Sort by timestamp
    items.sort((a, b) => a.ts - b.ts);

    // Calculate intervals between consecutive debits
    const intervals = [];
    const amounts = items.map((it) => it.amount);

    for (let i = 1; i < items.length; i++) {
      const diffDays = Math.round((items[i].ts - items[i - 1].ts) / (1000 * 60 * 60 * 24));
      intervals.push(diffDays);
    }

    const { mean: meanInterval } = computeStats(intervals);
    const { mean: meanAmount, cv: amountCv } = computeStats(amounts);

    // Clustering Rule: 26 to 35 days periodicity, amount CV <= 0.05
    const isIntervalMonthly = intervals.some((d) => d >= 26 && d <= 35) || (meanInterval >= 26 && meanInterval <= 35);
    const isAmountFixed = amountCv <= 0.05;
    const isExplicitLender = items[0].lenderName || items[0].isMandate;

    if ((isIntervalMonthly && isAmountFixed) || isExplicitLender) {
      const emiAmount = fromPaise(toPaise(meanAmount));
      detectedEmis.push({
        lenderName: items[0].lenderName || key.replace(/_/g, ' '),
        mandateKey: key,
        monthlyEmi: emiAmount,
        frequencyDays: Math.round(meanInterval),
        confidence: isExplicitLender ? 'CONFIRMED_LENDER_MANDATE' : 'RECURRING_CLUSTER_CONFIRMED',
        cv: parseFloat(amountCv.toFixed(4)),
        transactionCount: items.length,
        transactions: items.map((it) => it.txn_id),
      });

      totalMonthlyEmiPaise += toPaise(emiAmount);
    }
  }

  const totalMonthlyEmi = fromPaise(totalMonthlyEmiPaise);

  // Compute FOIR (Fixed Obligation to Income Ratio)
  let foir = null;
  if (genuineMonthlyIncome > 0) {
    foir = parseFloat(((totalMonthlyEmi / genuineMonthlyIncome) * 100).toFixed(2));
  }

  return {
    detectedEmis,
    totalMonthlyEmi,
    foir,
    foirDisplay: foir !== null ? `${foir}%` : 'N/A (No verified income)',
  };
}

// =========================================================================
// 2. CIRCULAR MONEY & SELF-TRANSFER ENGINE
// =========================================================================

/**
 * Detects:
 * - SELF transfers (Name match > 90% or mirrored same-day debit/credit with identical RRN)
 * - RELATED_PARTY transfers (Same surname matches, without labeling confirmed self-transfer)
 * - Round-trip / Cycling (Inflow from X followed by outflow to X or third party within 48h for amount +- 2%)
 * - Confidence scoring: SUSPICIOUS_ROTATION or CIRCULAR_PATTERN_PROBABLE (never 63% as CONFIRMED)
 */
function detectCircularAndSelfTransfers(transactions = [], accountHolderName = '') {
  const credits = transactions.filter((t) => t.direction === 'CREDIT' && t.amount > 0);
  const debits = transactions.filter((t) => t.direction === 'DEBIT' && t.amount > 0);

  const holderTokens = tokenizeWords(accountHolderName);
  const holderSurname = extractSurname(accountHolderName);

  const selfTransfers = [];
  const relatedPartyTransfers = [];
  const circularEvents = [];

  // Helper to extract counterparty name and narration text from description
  function getCounterparty(narration) {
    const rawUpper = String(narration || '').toUpperCase();
    const enriched = enrichNarration(narration);
    const vpaUser = (enriched.upi && enriched.upi.vpa) ? enriched.upi.vpa.split('@')[0] : '';
    
    // Also extract clean text after UPI/IMPS/NEFT headers
    const words = tokenizeWords(narration);
    const cleanWords = words.filter(
      (w) => !['UPI', 'NEFT', 'RTGS', 'IMPS', 'TRANSFER', 'TRF', 'PAYTO', 'FROM', 'A', 'C', 'NO', 'INR', 'REF'].includes(w)
    );
    const textName = cleanWords.join(' ');

    return {
      vpaUser,
      textName,
      fullText: `${vpaUser} ${textName} ${rawUpper}`,
    };
  }

  // A. SELF & RELATED PARTY IDENTIFICATION
  for (const txn of transactions) {
    const raw = txn.raw_description || '';
    const { vpaUser, textName, fullText } = getCounterparty(raw);
    if (!textName && !vpaUser) continue;

    // Check token similarity against both the parsed name and the VPA user part
    const simName = textName ? computeTokenSimilarity(textName, accountHolderName) : 0;
    const simVpa = vpaUser ? computeTokenSimilarity(vpaUser, accountHolderName) : 0;
    const maxSim = Math.max(simName, simVpa);

    // Check if all primary holder tokens exist in the narration (e.g. "KAMLESH" and "BHOI" in "FROM KAMLESH BHOI")
    const holderWords = tokenizeWords(accountHolderName);
    const hasAllHolderTokens = holderWords.length >= 2 && holderWords.every((hw) => fullText.includes(hw));

    // Rule: Token similarity > 90% or contains all account holder name tokens -> SELF
    if (maxSim >= 0.90 || hasAllHolderTokens) {
      selfTransfers.push({
        txn_id: txn.txn_id,
        direction: txn.direction,
        amount: txn.amount,
        date: txn.date,
        type: 'SELF_TRANSFER',
        confidence: 'CONFIRMED',
        similarity: hasAllHolderTokens ? 1.0 : parseFloat(maxSim.toFixed(2)),
        evidence: `Counterparty "${textName || vpaUser}" matches account holder "${accountHolderName}"`,
      });
      continue;
    }

    // Rule: Same surname match (e.g. Kamlesh Bhoi vs Manisha Bhoi or KAMLESHBHOI143)
    if (holderSurname) {
      const surnameUpper = holderSurname.toUpperCase();
      const hasSurnameMatch =
        tokenizeWords(textName).includes(surnameUpper) ||
        tokenizeWords(vpaUser).includes(surnameUpper) ||
        fullText.includes(surnameUpper);

      if (hasSurnameMatch) {
        // Must NOT be labeled as confirmed self-transfer without account/name proof
        relatedPartyTransfers.push({
          txn_id: txn.txn_id,
          direction: txn.direction,
          amount: txn.amount,
          date: txn.date,
          type: 'RELATED_PARTY',
          confidence: 'PROBABLE_FAMILY_MATCH',
          evidence: `Surname "${holderSurname}" matches counterparty in "${textName || vpaUser}". Kept as related party, not confirmed self-transfer.`,
        });
      }
    }
  }

  // B. MIRRORED SAME-DAY RRN DEBIT/CREDIT (Self or Reversal)
  const creditRrnMap = new Map();
  for (const c of credits) {
    const enriched = enrichNarration(c.raw_description, c.ref_no);
    const rrn = enriched.ref_no || (enriched.upi && enriched.upi.rrn) || enriched.rrn;
    if (rrn && rrn.length >= 8) {
      creditRrnMap.set(rrn, c);
    }
  }

  for (const d of debits) {
    const enriched = enrichNarration(d.raw_description, d.ref_no);
    const rrn = enriched.ref_no || (enriched.upi && enriched.upi.rrn) || enriched.rrn;
    if (rrn && creditRrnMap.has(rrn)) {
      const matchCr = creditRrnMap.get(rrn);
      if (Math.abs(matchCr.amount - d.amount) <= 1 && matchCr.date === d.date) {
        selfTransfers.push({
          txn_id: d.txn_id,
          paired_txn_id: matchCr.txn_id,
          amount: d.amount,
          date: d.date,
          type: 'SELF_TRANSFER_MIRRORED_RRN',
          confidence: 'CONFIRMED',
          evidence: `Mirrored same-day debit/credit with identical RRN ${rrn}`,
        });
      }
    }
  }

  // C. ROUND-TRIP / CYCLING DETECTION (Inflow from X followed by outflow <= 48h, amount +- 2%)
  const checkedPairs = new Set();

  for (const cr of credits) {
    const crTs = parseDateToTs(cr.date);
    if (!crTs) continue;

    const crCounterparty = getCounterparty(cr.raw_description);
    const crAmtPaise = toPaise(cr.amount);

    for (const dr of debits) {
      const drTs = parseDateToTs(dr.date);
      if (!drTs || drTs < crTs) continue;

      const diffHours = (drTs - crTs) / (1000 * 60 * 60);
      if (diffHours > 48) continue; // within 48 hours

      const drAmtPaise = toPaise(dr.amount);
      const ratio = crAmtPaise > 0 ? drAmtPaise / crAmtPaise : 0;

      // Within +- 2%
      if (ratio >= 0.98 && ratio <= 1.02) {
        const pairKey = `${cr.txn_id}_${dr.txn_id}`;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        const drCounterparty = getCounterparty(dr.raw_description);
        const isSameParty = crCounterparty && drCounterparty && computeTokenSimilarity(crCounterparty, drCounterparty) >= 0.70;

        let confidenceScore = 65; // Base probability for <=48h round-trip
        if (isSameParty) confidenceScore += 25; // 90% if same counterparty
        if (diffHours <= 24) confidenceScore += 5; // Faster turnaround

        const label = confidenceScore >= 85 ? 'SUSPICIOUS_ROTATION' : 'CIRCULAR_PATTERN_PROBABLE';

        circularEvents.push({
          credit_txn_id: cr.txn_id,
          debit_txn_id: dr.txn_id,
          inflowAmount: cr.amount,
          outflowAmount: dr.amount,
          inflowDate: cr.date,
          outflowDate: dr.date,
          turnaroundHours: Math.round(diffHours),
          counterpartyInflow: crCounterparty || 'Unknown',
          counterpartyOutflow: drCounterparty || 'Unknown',
          confidenceScore, // e.g. 65, 70, 90 (Never label 63% as CONFIRMED)
          status: label,
          evidence: `Inflow of ₹${cr.amount} followed by outflow of ₹${dr.amount} within ${Math.round(diffHours)} hours (${label}, confidence: ${confidenceScore}%)`,
        });
      }
    }
  }

  return {
    selfTransfers,
    relatedPartyTransfers,
    circularEvents,
  };
}

// =========================================================================
// 3. REVERSALS & BOUNCES ENGINE
// =========================================================================

/**
 * Detects:
 * - REVERSAL / UPI/REV matching original debit by RRN (excludes both legs from genuine income/spend)
 * - Bounce charges (`RTN CHG`, `INSUFFICIENT FUNDS`, `NACH RETURN`, etc.)
 */
function detectReversalsAndBounces(transactions = []) {
  const debits = transactions.filter((t) => t.direction === 'DEBIT');
  const credits = transactions.filter((t) => t.direction === 'CREDIT');

  const matchedReversals = [];
  const excludedTxnIds = new Set();
  const bounceEvents = [];

  // 1. Identify Bounce Charges
  for (const d of debits) {
    const raw = (d.raw_description || '').toUpperCase();
    if (BOUNCE_CHARGE_REGEX.test(raw)) {
      bounceEvents.push({
        txn_id: d.txn_id,
        date: d.date,
        amount: d.amount,
        description: d.raw_description,
        type: 'BOUNCE_CHARGE',
        reason: 'Return charge / Insufficient funds / Mandate bounce detected',
      });
    }
  }

  // 2. Match Reversal Credits with Original Debits by RRN
  const debitRrnMap = new Map();
  for (const d of debits) {
    const enriched = enrichNarration(d.raw_description, d.ref_no);
    const rrn = enriched.ref_no || (enriched.upi && enriched.upi.rrn) || enriched.rrn;
    if (rrn && rrn.length >= 8) {
      debitRrnMap.set(rrn, d);
    }
  }

  for (const c of credits) {
    const raw = (c.raw_description || '').toUpperCase();
    const isReversalText = /\b(?:REVERSAL|REV[\/-]|REFUND|FAILED\s*TXN|CHARGEBACK)\b/i.test(raw);

    const enriched = enrichNarration(c.raw_description, c.ref_no);
    const rrn = enriched.ref_no || (enriched.upi && enriched.upi.rrn) || enriched.rrn;

    let matchedDebit = null;
    if (rrn && debitRrnMap.has(rrn)) {
      matchedDebit = debitRrnMap.get(rrn);
    }

    if (isReversalText || matchedDebit) {
      const origDebitId = matchedDebit ? matchedDebit.txn_id : null;
      matchedReversals.push({
        credit_txn_id: c.txn_id,
        original_debit_txn_id: origDebitId,
        amount: c.amount,
        date: c.date,
        rrn: rrn || null,
        description: c.raw_description,
        instabilityFlag: true,
      });

      // Exclude both legs from genuine income and genuine spending
      excludedTxnIds.add(c.txn_id);
      if (origDebitId) {
        excludedTxnIds.add(origDebitId);
      }
    }
  }

  return {
    matchedReversals,
    excludedTxnIds: Array.from(excludedTxnIds),
    bounceEvents,
    hasInstabilityAlert: matchedReversals.length > 0 || bounceEvents.length > 0,
  };
}

/**
 * Master Forensics Pipeline Entry Point
 */
function runForensicAnalysis(transactions = [], options = {}) {
  const accountHolderName = options.accountHolderName || '';
  const genuineMonthlyIncome = options.genuineMonthlyIncome || 0;

  const loansAndEmis = detectLoansAndEmis(transactions, genuineMonthlyIncome);
  const circularAndSelf = detectCircularAndSelfTransfers(transactions, accountHolderName);
  const reversalsAndBounces = detectReversalsAndBounces(transactions);

  return {
    loansAndEmis,
    circularAndSelf,
    reversalsAndBounces,
  };
}

module.exports = {
  KNOWN_LENDERS_AND_MANDATES,
  computeTokenSimilarity,
  detectLoansAndEmis,
  detectCircularAndSelfTransfers,
  detectReversalsAndBounces,
  runForensicAnalysis,
};
