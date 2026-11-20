/**
 * utils/bankStatementEngine.js
 *
 * Pipeline Phase 3: Pure Computation Analytics Engine
 *
 * DESIGN PRINCIPLE:
 * Code reads rows and computes every number. All thresholds are centralized in ENGINE_CONFIG.
 * Claude is never used for arithmetic, balances, sums, counts or ratios.
 * No hardcoded customer names, accounts, banks, VPAs, amounts, or dates.
 */

const ENGINE_CONFIG = {
  // Low balance & overdraft thresholds
  lowBalanceThreshold1: 1000,
  lowBalanceThreshold2: 10000,
  negativeBalanceRedDaysThreshold: 5, // RED when negative balance days exceed configured threshold

  // Autopay / Mandate / EMI / Rent rules
  recurringKeywords: [/\bAUTOPAY\b/i, /\bMANDATE\b/i, /\bNACH\b/i, /\bECS\b/i, /\bLOAN\b/i, /\bEMI\b/i, /\bRENT\b/i],
  recurringAmountTolerance: 0.10,

  // Circular / Pass-Through / Rotation rules
  largeInflowThreshold: 50000,
  largeInflowOutRatio: 0.80,
  rotationWindowHours: 48,
  minListedCircularAmount: 5000,
};

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  return new Date(dateStr);
}

function monthKey(dateStr) {
  const d = parseDate(dateStr);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function computeMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeStdDev(arr) {
  if (!arr || arr.length <= 1) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Extract core counterparty key for entity linking, related-party, and Rule 1f round-trip checks
 */
function getCoreCpKey(narration, counterparty, mobileNumber) {
  if (mobileNumber) return mobileNumber;
  const n = String(narration || '');
  const mob = n.match(/\b([6-9]\d{9})\b/);
  if (mob) return mob[1];
  const vpa = n.match(/([A-Za-z0-9._-]+)@[A-Za-z0-9_-]+/);
  if (vpa) {
    const p = vpa[1].replace(/[-_.]\d+$/, '').toUpperCase();
    if (p.length >= 4) return p;
  }
  if (
    counterparty &&
    !/^(?:EXTERNAL PARTY|UPI COUNTERPARTY|MERCHANT|CASH \/ ATM|ATM CASH WITHDRAWAL|CASH DEPOSIT \/ WITHDRAWAL|BANK INTEREST|BANK CHARGES|OTHER|SELF|SELF \/ INTERNAL)$/i.test(
      counterparty
    )
  ) {
    return String(counterparty).toUpperCase().trim();
  }
  return null;
}

/**
 * Pure Mathematical Analytics Engine
 */
function computeBankAnalytics(extractedData, classifiedTransactions) {
  const txs = classifiedTransactions || [];
  const accountHolder =
    extractedData.accountHolderName ||
    extractedData.accountInfo?.accountHolderName ||
    extractedData.accountProfile?.holderName ||
    'Account Holder';

  // 1. Counts and Balances from parsed transactions (all arithmetic in integer paise)
  let totalCreditsPaise = 0;
  let totalDebitsPaise = 0;
  let creditCount = 0;
  let debitCount = 0;

  for (const t of txs) {
    const crPaise = t.creditPaise ?? Math.round((t.credit || 0) * 100);
    const drPaise = t.debitPaise ?? Math.round((t.debit || 0) * 100);
    const balPaise = t.balancePaise ?? Math.round((t.balance || 0) * 100);
    t.creditPaise = crPaise;
    t.debitPaise = drPaise;
    t.balancePaise = balPaise;
    if (!t._ts) {
      const parsedD = parseDate(t.date);
      t._ts = parsedD ? parsedD.getTime() : 0;
    }
    if (crPaise > 0) {
      totalCreditsPaise += crPaise;
      creditCount++;
    }
    if (drPaise > 0) {
      totalDebitsPaise += drPaise;
      debitCount++;
    }
  }

  const totalCredits = totalCreditsPaise / 100;
  const totalDebits = totalDebitsPaise / 100;
  const netCashFlowPaise = totalCreditsPaise - totalDebitsPaise;
  const netCashFlow = netCashFlowPaise / 100;

  // Opening and closing balances: preserve exact signed values in paise (can be negative!)
  let openingBalanceRaw = extractedData.exactOpeningBalance ?? extractedData.openingBalance;
  const openingBalanceDerived =
    extractedData.printedOpeningBalance === null || extractedData.printedOpeningBalance === undefined;
  let openingBalancePaise = 0;
  if ((openingBalanceRaw === null || openingBalanceRaw === undefined || Number.isNaN(Number(openingBalanceRaw))) && txs.length > 0) {
    const oldest = txs[0];
    openingBalancePaise = (oldest.balancePaise || 0) - (oldest.creditPaise || 0) + (oldest.debitPaise || 0);
  } else {
    openingBalancePaise = Math.round(Number(openingBalanceRaw || 0) * 100);
  }
  const openingBalance = openingBalancePaise / 100;

  let closingBalanceRaw = extractedData.exactClosingBalance ?? extractedData.closingBalance;
  let closingBalancePaise = 0;
  if ((closingBalanceRaw === null || closingBalanceRaw === undefined || Number.isNaN(Number(closingBalanceRaw))) && txs.length > 0) {
    const newest = txs[txs.length - 1];
    closingBalancePaise = newest.balancePaise || 0;
  } else {
    closingBalancePaise = Math.round(Number(closingBalanceRaw || 0) * 100);
  }
  const closingBalance = closingBalancePaise / 100;

  // Printed period vs Transactions from/to
  const transactionsFrom = extractedData.transactionsFrom || txs[0]?.date || null;
  const transactionsTo = extractedData.transactionsTo || txs[txs.length - 1]?.date || null;
  const printedFrom = extractedData.printedFrom || null;
  const printedTo = extractedData.printedTo || null;
  const printedPeriod =
    extractedData.printedPeriod ||
    (printedFrom && printedTo ? `${printedFrom} → ${printedTo}` : 'Not printed on statement');
  const transactionsPeriod =
    extractedData.transactionsPeriod ||
    (transactionsFrom && transactionsTo ? `${transactionsFrom} → ${transactionsTo}` : 'N/A');

  // 2. Credit-Card Rotation (Step 3)
  // Credits described as credit-card amount return/transfer followed within 48 hours by card-bill payments of at least 80% of the amount.
  const creditCardRotationEvents = [];
  const rotatedCreditTxIds = new Set();
  const CARD_CREDIT_SIGNAL_RE = /\b(?:CREDIT\s*CARD|CC\s*(?:AMT|AMOUNT|RETURN|REFUND|TRF|TRANSFER)|CARD\s*(?:AMT|AMOUNT|RETURN|TRF|TRANSFER)|CRED\b|CRED\s*CLUB|DREAMPLUG|SBICARD|SBI\s*CARD|ONECARD)\b/i;
  const CARD_BILL_DEBIT_RE = /\b(?:CRED\b|CRED\s*CLUB|DREAMPLUG|CREDIT\s*CARD\s*(?:BILL|PAYMENT|PMT|DUES)|CC\s*(?:BILL|PAYMENT|PMT)|CARD\s*BILL\s*(?:PAYMENT|PMT)?|BILLDESK\s*(?:CC|CARD)|SBICARD|SBI\s*CARD|HDFC\s*CARD|ICICI\s*CARD|AXIS\s*CARD|KOTAK\s*CARD|AMEX\s*(?:BILL|CARD)|RBL\s*CARD|INDUSIND\s*CARD|ONE\s*CARD|ONECARD|AU\s*CC)\b/i;

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    if (t.creditPaise < 1000) continue;
    const isCardCredit =
      Boolean(t.isCreditCardRelated) ||
      CARD_CREDIT_SIGNAL_RE.test(t.narration || '') ||
      CARD_CREDIT_SIGNAL_RE.test(t.rawNarration || '') ||
      CARD_CREDIT_SIGNAL_RE.test(t.counterparty || '');
    if (!isCardCredit) continue;

    const cDate = parseDate(t.date);
    let cardBillPaid48hPaise = 0;
    let maxHoursElapsed = 0;
    const billDates = [];
    const billPayees = new Set();
    const debitIds = [];

    for (let j = i + 1; j < txs.length; j++) {
      const next = txs[j];
      const nDate = parseDate(next.date);
      const hours = (nDate - cDate) / (1000 * 60 * 60);
      if (hours < 0) continue;
      if (hours > 48) break;

      const isCardBillDebit =
        next.debitPaise >= 1000 &&
        (next.category === 'Credit card payment' ||
          CARD_BILL_DEBIT_RE.test(next.narration || '') ||
          CARD_BILL_DEBIT_RE.test(next.rawNarration || '') ||
          CARD_BILL_DEBIT_RE.test(next.counterparty || ''));
      if (isCardBillDebit) {
        cardBillPaid48hPaise += next.debitPaise;
        if (hours > maxHoursElapsed) maxHoursElapsed = Math.round(hours);
        billDates.push(next.date);
        if (next.counterparty) billPayees.add(next.counterparty);
        debitIds.push(next.id || j + 1);
      }
    }

    if (cardBillPaid48hPaise * 100 >= t.creditPaise * 80) {
      rotatedCreditTxIds.add(t.id || i + 1);
      t.isCreditCardRotation = true;
      t.isExcludedCredit = true;
      t.exclusionBucket = 'refundCredits';
      t.exclusionReason = 'Credit card rotation / refund (card return followed by card bill payment within 48h)';
      const pctPaid = Math.round((cardBillPaid48hPaise / t.creditPaise) * 100);
      const lastBillDate = billDates[billDates.length - 1] || t.date;
      const payeeLabel = Array.from(billPayees).join(', ') || t.counterparty || 'CREDIT CARD BILL';
      const cardBillPaid48h = cardBillPaid48hPaise / 100;

      creditCardRotationEvents.push({
        creditDate: t.date,
        debitDate: lastBillDate,
        dateRange: t.date === lastBillDate ? t.date : `${t.date} → ${lastBillDate}`,
        hoursElapsed: maxHoursElapsed,
        creditAmount: t.credit,
        debitAmount: cardBillPaid48h,
        pctRepaid: pctPaid,
        creditCounterparty: t.counterparty || 'CREDIT CARD',
        debitCounterparty: payeeLabel,
        counterparty: payeeLabel,
        narration: t.narration,
        transactionIds: [t.id || i + 1, ...debitIds],
        description: `Card-related credit of ₹${Math.round(t.credit).toLocaleString('en-IN')} on ${t.date} followed within 48h by card bill payment of ₹${Math.round(cardBillPaid48h).toLocaleString('en-IN')} (${pctPaid}%) on ${lastBillDate} (${payeeLabel})`,
      });
    }
  }

  // 3. Internal & Own-Money Movements (Sweep to/from FD, FD premature proceeds, FD booking, reversal pairs, holder-to-holder transfers)
  const internalMovementsList = [];
  let totalInternalCreditsPaise = 0;
  let totalInternalDebitsPaise = 0;

  for (const t of txs) {
    const isInternal =
      Boolean(t.isInternalMovement) ||
      Boolean(t.isReversalPair) ||
      t.category === 'Own-account transfer' ||
      t.category === 'Sweep/FD (internal)' ||
      t.category === 'Own-Account Transfer';
    if (isInternal) {
      t.isInternalMovement = true;
      if (t.creditPaise > 0) {
        t.isExcludedCredit = true;
        if (!t.exclusionReason) {
          t.exclusionReason = t.internalMovementKind || 'Own-account / internal movement';
        }
        totalInternalCreditsPaise += t.creditPaise;
      }
      if (t.debitPaise > 0) {
        totalInternalDebitsPaise += t.debitPaise;
      }
      internalMovementsList.push({
        date: t.date,
        type: t.creditPaise > 0 ? 'CREDIT' : 'DEBIT',
        debit: t.debit || 0,
        credit: t.credit || 0,
        balance: t.balance || 0,
        amount: t.creditPaise > 0 ? t.credit : t.debit,
        kind: t.internalMovementKind || 'Own-account / internal transfer',
        counterparty: t.counterparty || 'SELF / INTERNAL',
        narration: t.narration,
      });
    }
  }
  const totalInternalCredits = totalInternalCreditsPaise / 100;
  const totalInternalDebits = totalInternalDebitsPaise / 100;

  // 4. Genuine-Inflow Calculation (Bug Class 6):
  // Genuine inflow = total credits minus:
  //   (1) interest credits,
  //   (2) refunds (including merchant refunds via IMPS/UPI),
  //   (3) reversal credits,
  //   (4) own-account transfers,
  //   (5) loan disbursements.
  // Everything else counts as genuine inflow, including external NEFT/RTGS/IMPS credits.
  const excludedCreditsList = [];
  let interestCreditsPaise = 0;
  let interestCreditsCount = 0;
  let refundCreditsPaise = 0;
  let refundCreditsCount = 0;
  let reversalCreditsPaise = 0;
  let reversalCreditsCount = 0;
  let ownAccountCreditsPaise = 0;
  let ownAccountCreditsCount = 0;
  let loanDisbursementCreditsPaise = 0;
  let loanDisbursementCreditsCount = 0;
  let totalCardRotationCreditsPaise = 0;

  for (const t of txs) {
    if (t.creditPaise > 0) {
      let bucket = t.exclusionBucket || null;
      let reason = t.exclusionReason || null;
      const nUpper = (t.narration || '').toUpperCase();

      if (!bucket) {
        if (t.isReversalPair || t.isSharedReferenceReversal) {
          bucket = 'reversalCredits';
          reason = reason || 'Reversal credit (matched debit reference & amount)';
        } else if (t.isInternalMovement || t.category === 'Own-account transfer' || t.category === 'Sweep/FD (internal)') {
          bucket = 'ownAccountCredits';
          reason = reason || t.internalMovementKind || 'Own-account / internal transfer';
        } else if (t.category === 'Interest' || t.mode === 'INTEREST') {
          bucket = 'interestCredits';
          reason = reason || 'Bank interest credit';
        } else if (t.category === 'Loan/EMI') {
          bucket = 'loanDisbursementCredits';
          reason = reason || 'Loan disbursement';
        } else if (t.category === 'Refund/reversal' || rotatedCreditTxIds.has(t.id)) {
          const isExplicitReversal = /\b(?:REVERSAL|REV[\-\s]*UPI|REV[\-\s]*IMPS|REV[\-\s]*NEFT|FAILED\s*TXN|CHARGEBACK|CRV)\b/i.test(nUpper);
          bucket = isExplicitReversal ? 'reversalCredits' : 'refundCredits';
          reason = reason || (isExplicitReversal ? 'Transaction reversal credit' : 'Merchant / transaction refund');
        } else if (t.category === 'Bank charges') {
          bucket = 'reversalCredits';
          reason = reason || 'Bank fee reversal';
        }
      }

      if (bucket) {
        const finalReason = reason || bucket;
        t.isExcludedCredit = true;
        t.exclusionBucket = bucket;
        t.exclusionReason = finalReason;

        if (rotatedCreditTxIds.has(t.id)) {
          totalCardRotationCreditsPaise += t.creditPaise;
        }

        if (bucket === 'interestCredits') {
          interestCreditsPaise += t.creditPaise;
          interestCreditsCount++;
        } else if (bucket === 'refundCredits') {
          refundCreditsPaise += t.creditPaise;
          refundCreditsCount++;
        } else if (bucket === 'reversalCredits') {
          reversalCreditsPaise += t.creditPaise;
          reversalCreditsCount++;
        } else if (bucket === 'ownAccountCredits') {
          ownAccountCreditsPaise += t.creditPaise;
          ownAccountCreditsCount++;
        } else if (bucket === 'loanDisbursementCredits') {
          loanDisbursementCreditsPaise += t.creditPaise;
          loanDisbursementCreditsCount++;
        }

        excludedCreditsList.push({
          date: t.date,
          amount: t.credit,
          bucket,
          counterparty: t.counterparty || 'EXTERNAL PARTY',
          reason: finalReason,
          narration: t.narration,
        });
      } else {
        t.isExcludedCredit = false;
        t.exclusionBucket = null;
        t.exclusionReason = null;
      }
    }
  }

  const totalExcludedCreditsPaise =
    interestCreditsPaise +
    refundCreditsPaise +
    reversalCreditsPaise +
    ownAccountCreditsPaise +
    loanDisbursementCreditsPaise;
  const genuineCreditTotalPaise = Math.max(0, totalCreditsPaise - totalExcludedCreditsPaise);
  const genuineCreditTotal = genuineCreditTotalPaise / 100;

  const totalInterestCredits = interestCreditsPaise / 100;
  const totalRefundCredits = refundCreditsPaise / 100;
  const totalReversalCredits = reversalCreditsPaise / 100;
  const totalReversalsCredits = (refundCreditsPaise + reversalCreditsPaise) / 100;
  const totalOwnAccountCredits = ownAccountCreditsPaise / 100;
  const totalLoanCredits = loanDisbursementCreditsPaise / 100;
  const totalCardRotationCredits = totalCardRotationCreditsPaise / 100;
  const totalMicroCredits = 0;

  const excludedCreditBuckets = [
    {
      key: 'interestCredits',
      label: 'Interest credits',
      count: interestCreditsCount,
      amountPaise: interestCreditsPaise,
      amount: totalInterestCredits,
    },
    {
      key: 'refundCredits',
      label: 'Refunds (including merchant refunds via IMPS/UPI)',
      count: refundCreditsCount,
      amountPaise: refundCreditsPaise,
      amount: totalRefundCredits,
    },
    {
      key: 'reversalCredits',
      label: 'Reversal credits',
      count: reversalCreditsCount,
      amountPaise: reversalCreditsPaise,
      amount: totalReversalCredits,
    },
    {
      key: 'ownAccountCredits',
      label: 'Own-account transfers',
      count: ownAccountCreditsCount,
      amountPaise: ownAccountCreditsPaise,
      amount: totalOwnAccountCredits,
    },
    {
      key: 'loanDisbursementCredits',
      label: 'Loan disbursements',
      count: loanDisbursementCreditsCount,
      amountPaise: loanDisbursementCreditsPaise,
      amount: totalLoanCredits,
    },
  ];

  // 5. Related-Party & Possible Own-Account Subset Detection (Trait 14)
  // Account holder name may be a short or truncated form in the header while counterparties show a longer form:
  // treat holder tokens as a subset of counterparty tokens as "possible own account/related" (not excluded blindly from income).
  const cleanedHolder = String(accountHolder)
    .toUpperCase()
    .replace(/\b(?:MR|MRS|MS|DR|SHRI|SMT|M\/S|ACCOUNT|HOLDER|CUSTOMER|NOT|MENTIONED|SPECIFIED)\b\.?/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .trim();
  const holderTokens = cleanedHolder.split(/\s+/).filter((tok) => tok.length >= 3);
  const holderSurname = holderTokens.length >= 2 ? holderTokens[holderTokens.length - 1] : null;

  const cpHandlesMap = new Map();
  const cpStatsMap = new Map();

  for (const t of txs) {
    if (t.isInternalMovement) continue;
    const kCp = getCoreCpKey(t.rawNarration || t.narration, t.counterparty, t.mobileNumber);
    if (!kCp) continue;
    if (!cpHandlesMap.has(kCp)) cpHandlesMap.set(kCp, new Set());
    const vpaMatch = String(t.rawNarration || t.narration || '').match(/([A-Za-z0-9._-]+@[A-Za-z0-9_-]+)/);
    if (vpaMatch) cpHandlesMap.get(kCp).add(vpaMatch[1].toLowerCase());
    if (t.counterparty) cpHandlesMap.get(kCp).add(t.counterparty);

    if (!cpStatsMap.has(kCp)) {
      cpStatsMap.set(kCp, {
        key: kCp,
        name: t.counterparty || kCp,
        creditCount: 0,
        debitCount: 0,
        inflow: 0,
        outflow: 0,
      });
    }
    const st = cpStatsMap.get(kCp);
    if (t.credit > 0 && !t.isExcludedCredit) {
      st.creditCount++;
      st.inflow = Math.round((st.inflow + t.credit) * 100) / 100;
    }
    if (t.debit > 0) {
      st.debitCount++;
      st.outflow = Math.round((st.outflow + t.debit) * 100) / 100;
    }
  }

  const relatedPartyMap = new Map();
  let relatedPartyInflowTotal = 0;
  let relatedPartyOutflowTotal = 0;
  let relatedPartyTxnCount = 0;

  for (const t of txs) {
    if (t.isInternalMovement || t.category === 'Own-account transfer' || t.category === 'Sweep/FD (internal)') continue;
    const cpUpper = (t.counterparty || '').toUpperCase();
    const nUpper = (t.narration || '').toUpperCase();
    const kCp = getCoreCpKey(t.rawNarration || t.narration, t.counterparty, t.mobileNumber);
    const handlesSet = kCp ? cpHandlesMap.get(kCp) : null;
    const st = kCp ? cpStatsMap.get(kCp) : null;

    const cpWords = `${cpUpper} ${nUpper}`.replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
    const isPossibleOwnSubset = Boolean(t.isPossibleOwnAccountRelated);
    const isSameSurname = Boolean(holderSurname && holderSurname.length >= 3 && cpWords.includes(holderSurname));
    const isLinkedMultiHandle = Boolean(
      kCp && handlesSet && handlesSet.size >= 2 && st && st.creditCount >= 1 && st.debitCount >= 1
    );
    const isRepeatedbidirectionalP2P = Boolean(
      kCp && t.category === 'UPI P2P' && st && st.creditCount >= 2 && st.debitCount >= 2
    );

    if (isPossibleOwnSubset || isSameSurname || isLinkedMultiHandle || isRepeatedbidirectionalP2P) {
      t.isRelatedParty = true;
      const reason = isPossibleOwnSubset
        ? (t.possibleOwnAccountReason || 'Possible own account / related (holder name subset)')
        : isSameSurname
        ? `Same surname (${holderSurname})`
        : isLinkedMultiHandle
        ? `Repeated linked handles (${handlesSet.size} handles)`
        : 'Repeated two-way P2P counterparty';
      t.relatedPartyReason = reason;

      relatedPartyTxnCount++;
      if (t.credit > 0 && !t.isExcludedCredit) {
        relatedPartyInflowTotal = Math.round((relatedPartyInflowTotal + t.credit) * 100) / 100;
      }
      if (t.debit > 0) {
        relatedPartyOutflowTotal = Math.round((relatedPartyOutflowTotal + t.debit) * 100) / 100;
      }

      const rpKey = kCp || cpUpper || 'RELATED_PARTY';
      if (!relatedPartyMap.has(rpKey)) {
        relatedPartyMap.set(rpKey, {
          counterparty: t.counterparty || rpKey,
          reason,
          isPossibleOwnAccount: isPossibleOwnSubset,
          handles: handlesSet ? Array.from(handlesSet) : [],
          txnCount: 0,
          inflow: 0,
          outflow: 0,
        });
      }
      const rp = relatedPartyMap.get(rpKey);
      rp.txnCount++;
      if (t.credit > 0 && !t.isExcludedCredit) rp.inflow = Math.round((rp.inflow + t.credit) * 100) / 100;
      if (t.debit > 0) rp.outflow = Math.round((rp.outflow + t.debit) * 100) / 100;
    } else {
      t.isRelatedParty = false;
    }
  }

  const relatedPartiesList = Array.from(relatedPartyMap.values()).sort(
    (a, b) => b.inflow + b.outflow - (a.inflow + a.outflow)
  );

  const mergedEntities = [];
  for (const [kCp, handles] of cpHandlesMap.entries()) {
    if (handles.size > 1) {
      const st = cpStatsMap.get(kCp);
      mergedEntities.push({
        key: kCp,
        name: st?.name || kCp,
        handles: Array.from(handles),
        txnCount: (st?.creditCount || 0) + (st?.debitCount || 0),
        inflow: st?.inflow || 0,
        outflow: st?.outflow || 0,
      });
    }
  }

  // 6. Calendar Month Series, Full-Month Detection, Median Income & CV
  const monthInflowSums = new Map();
  const monthTotalCreditSums = new Map();
  const monthNonRelatedInflowSums = new Map();
  const monthDebitSums = new Map();
  const monthTxCounts = new Map();
  const monthDatesMap = new Map();
  const monthClosingBalMap = new Map();

  for (const t of txs) {
    const m = monthKey(t.date);
    monthTxCounts.set(m, (monthTxCounts.get(m) || 0) + 1);
    if (!monthDatesMap.has(m)) monthDatesMap.set(m, new Set());
    monthDatesMap.get(m).add(t.date);
    monthClosingBalMap.set(m, t.balance);

    if (t.debit > 0) {
      monthDebitSums.set(m, Math.round(((monthDebitSums.get(m) || 0) + t.debit) * 100) / 100);
    }
    if (t.credit > 0) {
      monthTotalCreditSums.set(m, Math.round(((monthTotalCreditSums.get(m) || 0) + t.credit) * 100) / 100);
      if (!t.isExcludedCredit) {
        monthInflowSums.set(m, Math.round(((monthInflowSums.get(m) || 0) + t.credit) * 100) / 100);
        if (!t.isRelatedParty) {
          monthNonRelatedInflowSums.set(m, Math.round(((monthNonRelatedInflowSums.get(m) || 0) + t.credit) * 100) / 100);
        }
      }
    }
  }

  const rawStartStr = printedFrom || transactionsFrom;
  const rawEndStr = printedTo || transactionsTo;
  const startDate = parseDate(rawStartStr);
  const endDate = parseDate(rawEndStr);

  const allMonths = [];
  const curM = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const lastM = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (curM <= lastM) {
    const yr = curM.getFullYear();
    const mo = curM.getMonth();
    const k = `${yr}-${String(mo + 1).padStart(2, '0')}`;
    const firstDayOfMonth = new Date(yr, mo, 1);
    const lastDayOfMonth = new Date(yr, mo + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();

    const isFirstMonth = yr === startDate.getFullYear() && mo === startDate.getMonth();
    const isLastMonth = yr === endDate.getFullYear() && mo === endDate.getMonth();
    let isFullMonth = true;
    if (isFirstMonth && startDate.getDate() > 5) isFullMonth = false;
    if (isLastMonth && endDate.getDate() < daysInMonth - 4) isFullMonth = false;

    const effStartDay = isFirstMonth ? startDate.getDate() : 1;
    const effEndDay = isLastMonth ? endDate.getDate() : daysInMonth;
    const daysCovered = Math.max(1, effEndDay - effStartDay + 1);

    allMonths.push({
      month: k,
      isFullMonth,
      daysInMonth,
      daysCovered,
      firstDay: firstDayOfMonth,
      lastDay: lastDayOfMonth,
    });
    curM.setMonth(curM.getMonth() + 1);
  }

  // 7. EOD Balances, Dual Liquidity & Negative Balance / Overdraft Metrics (Trait 8 & Bug Class 3)
  // When a printed period exists, use it for statement coverage and as the EOD window (carry the last balance forward to the printed end date).
  // When none exists, use first and last transaction dates.
  const eodMap = new Map();
  const activeTxnDays = new Set();
  let minBalance = openingBalance;
  let maxBalance = openingBalance;

  for (const t of txs) {
    activeTxnDays.add(t.date);
    eodMap.set(t.date, t.balance);
    if (typeof t.balance === 'number' && Number.isFinite(t.balance)) {
      if (t.balance < minBalance) minBalance = t.balance;
      if (t.balance > maxBalance) maxBalance = t.balance;
    }
  }

  let activeDaysBelow1k = 0;
  let activeNegativeBalanceDays = 0;
  activeTxnDays.forEach((d) => {
    const dayBal = eodMap.get(d);
    const val = dayBal !== undefined ? dayBal : 0;
    if (val < ENGINE_CONFIG.lowBalanceThreshold1) activeDaysBelow1k++;
    if (val < 0) activeNegativeBalanceDays++;
  });
  const activeDaysBelow1kPct =
    activeTxnDays.size > 0 ? Math.round((activeDaysBelow1k / activeTxnDays.size) * 1000) / 10 : 0;

  let calendarDaysTracked = 0;
  let calendarDaysBelow1k = 0;
  let calendarDaysBelow10k = 0;
  let negativeBalanceDays = 0;
  let curBal = openingBalance;
  let eodSum = 0;
  const dailyEodSeries = [];
  const monthEodTracker = new Map();

  const calStart = parseDate(printedFrom || transactionsFrom);
  const calEnd = parseDate(printedTo || transactionsTo);
  const dCursor = new Date(calStart);
  while (dCursor <= calEnd) {
    const dStr = `${String(dCursor.getDate()).padStart(2, '0')}-${String(dCursor.getMonth() + 1).padStart(2, '0')}-${dCursor.getFullYear()}`;
    const mKeyStr = `${dCursor.getFullYear()}-${String(dCursor.getMonth() + 1).padStart(2, '0')}`;
    if (eodMap.has(dStr)) {
      curBal = eodMap.get(dStr);
    }
    if (curBal < minBalance) minBalance = curBal;
    if (curBal > maxBalance) maxBalance = curBal;
    eodSum += curBal;
    dailyEodSeries.push(curBal);

    if (!monthEodTracker.has(mKeyStr)) {
      monthEodTracker.set(mKeyStr, { sum: 0, count: 0, min: curBal, closing: curBal });
    }
    const mTrk = monthEodTracker.get(mKeyStr);
    mTrk.sum += curBal;
    mTrk.count++;
    if (curBal < mTrk.min) mTrk.min = curBal;
    mTrk.closing = curBal;

    if (curBal < ENGINE_CONFIG.lowBalanceThreshold1) calendarDaysBelow1k++;
    if (curBal < ENGINE_CONFIG.lowBalanceThreshold2) calendarDaysBelow10k++;
    if (curBal < 0) negativeBalanceDays++;
    calendarDaysTracked++;
    dCursor.setDate(dCursor.getDate() + 1);
  }

  minBalance = Math.round(minBalance * 100) / 100;
  maxBalance = Math.round(maxBalance * 100) / 100;
  const totalDaysOverdrawn = negativeBalanceDays;
  const negativeBalanceDaysPct =
    calendarDaysTracked > 0 ? Math.round((negativeBalanceDays / calendarDaysTracked) * 1000) / 10 : 0;
  const calendarDaysBelow1kPct =
    calendarDaysTracked > 0 ? Math.round((calendarDaysBelow1k / calendarDaysTracked) * 1000) / 10 : 0;
  const calendarDaysBelow10kPct =
    calendarDaysTracked > 0 ? Math.round((calendarDaysBelow10k / calendarDaysTracked) * 1000) / 10 : 0;
  const avgEod = calendarDaysTracked > 0 ? Math.round((eodSum / calendarDaysTracked) * 100) / 100 : 0;
  const medianEodBalance = Math.round(computeMedian(dailyEodSeries) * 100) / 100;

  const monthlyIncomeSeries = allMonths.map((mObj) => {
    const m = mObj.month;
    const totalCr = Math.round((monthTotalCreditSums.get(m) || 0) * 100) / 100;
    const inflow = Math.round((monthInflowSums.get(m) || 0) * 100) / 100;
    const inflowExclRelated = Math.round((monthNonRelatedInflowSums.get(m) || 0) * 100) / 100;
    const outflow = Math.round((monthDebitSums.get(m) || 0) * 100) / 100;
    const netFlow = Math.round((totalCr - outflow) * 100) / 100;
    const mEod = monthEodTracker.get(m);
    const mAvgEod = mEod && mEod.count > 0 ? Math.round((mEod.sum / mEod.count) * 100) / 100 : avgEod;
    const mMinEod = mEod ? Math.round(mEod.min * 100) / 100 : minBalance;
    const mClosing = monthClosingBalMap.has(m)
      ? Math.round(monthClosingBalMap.get(m) * 100) / 100
      : (mEod ? Math.round(mEod.closing * 100) / 100 : closingBalance);

    return {
      month: m,
      isFullMonth: mObj.isFullMonth,
      daysInMonth: mObj.daysInMonth,
      daysCovered: mObj.daysCovered,
      txCount: monthTxCounts.get(m) || 0,
      credits: totalCr,
      genuineCredits: inflow,
      debits: outflow,
      netFlow,
      avgEod: mAvgEod,
      minEod: mMinEod,
      closingBalance: mClosing,
      amount: inflow,
      amountExclRelated: inflowExclRelated,
      debitAmount: outflow,
    };
  });

  const fullMonthsInflows = {};
  for (const s of monthlyIncomeSeries) {
    fullMonthsInflows[s.month] = s.amount;
  }

  const fullCalendarMonths = monthlyIncomeSeries.filter((s) => s.isFullMonth);
  const fullMonthCount = fullCalendarMonths.length;
  const partialMonthsCount = monthlyIncomeSeries.length - fullMonthCount;
  const hasSufficientHistory = fullMonthCount >= 3;

  const fullMonthValues = fullCalendarMonths.map((s) => s.amount);
  const fullMonthNonRelatedValues = fullCalendarMonths.map((s) => s.amountExclRelated);

  const observedMonthlyTotal = Math.round(monthlyIncomeSeries.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const observedMonthlyNonRelatedTotal =
    Math.round(monthlyIncomeSeries.reduce((s, x) => s + x.amountExclRelated, 0) * 100) / 100;
  const observedMonthCount = Math.max(monthlyIncomeSeries.length, 1);
  const grossMonthlyCredit = Math.round((totalCredits / observedMonthCount) * 100) / 100;
  const observedInflowPerMonth = Math.round((observedMonthlyTotal / observedMonthCount) * 100) / 100;
  const observedInflowPerMonthExclRelated =
    Math.round((observedMonthlyNonRelatedTotal / observedMonthCount) * 100) / 100;

  let medianMonthlyIncome = 0;
  let medianMonthlyIncomeWithoutRelatedParty = 0;
  let incomeCv = null;
  let incomeCvWithoutRelatedParty = null;
  let medianMonthlyIncomeDisplay = 'Insufficient history';
  let incomeCvDisplay = 'Insufficient history';

  if (hasSufficientHistory) {
    medianMonthlyIncome = Math.round(computeMedian(fullMonthValues) * 100) / 100;
    medianMonthlyIncomeWithoutRelatedParty = Math.round(computeMedian(fullMonthNonRelatedValues) * 100) / 100;

    if (relatedPartyInflowTotal > 0 && medianMonthlyIncomeWithoutRelatedParty === medianMonthlyIncome) {
      const avgMonthlyRelated = Math.round((relatedPartyInflowTotal / fullMonthCount) * 100) / 100;
      medianMonthlyIncomeWithoutRelatedParty = Math.max(
        0,
        Math.round((medianMonthlyIncome - avgMonthlyRelated) * 100) / 100
      );
    }

    const incomeMean = fullMonthValues.reduce((s, x) => s + x, 0) / fullMonthValues.length;
    const incomeStdDev = computeStdDev(fullMonthValues);
    incomeCv = incomeMean > 0 ? Math.round((incomeStdDev / incomeMean) * 1000) / 10 : 0;

    const nrMean = fullMonthNonRelatedValues.reduce((s, x) => s + x, 0) / fullMonthNonRelatedValues.length;
    const nrStdDev = computeStdDev(fullMonthNonRelatedValues);
    incomeCvWithoutRelatedParty = nrMean > 0 ? Math.round((nrStdDev / nrMean) * 1000) / 10 : 0;

    medianMonthlyIncomeDisplay = `₹${medianMonthlyIncome.toLocaleString('en-IN')}`;
    incomeCvDisplay = `${incomeCv}%`;
  } else {
    medianMonthlyIncome = observedInflowPerMonth;
    medianMonthlyIncomeWithoutRelatedParty = observedInflowPerMonthExclRelated;
    if (relatedPartyInflowTotal > 0 && medianMonthlyIncomeWithoutRelatedParty === medianMonthlyIncome) {
      const avgMonthlyRelated = Math.round((relatedPartyInflowTotal / observedMonthCount) * 100) / 100;
      medianMonthlyIncomeWithoutRelatedParty = Math.max(
        0,
        Math.round((medianMonthlyIncome - avgMonthlyRelated) * 100) / 100
      );
    }
    medianMonthlyIncomeDisplay = 'Insufficient history';
    incomeCvDisplay = 'Insufficient history';
  }

  // 8. Step 3: Salary Detection
  // Salary wording OR the same corporate-looking payer (NEFT/IMPS/RTGS/ACH, company suffixes such as
  // LTD/PVT/SOF/TECH/SERVICES, or repeating similar amount) credited in 2+ distinct months;
  // individuals sending irregular P2P amounts do not count.
  // When found, show the payer and months as evidence. With fewer than 3 full months, report as "possible salary (limited history)".
  const SALARY_WORDING_RE = /\b(?:SAL|SALARY|PAYROLL|WAGES|STIPEND)\b/i;
  const CORPORATE_SUFFIX_RE = /\b(?:PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP|CORPORATION|TECHNOLOGIES|TECH|SOFTWARE|SOF|SOLUTIONS|SERVICES|SYSTEMS|ENTERPRISES|CONSULTING|GLOBAL|INDIA|INDUSTRIES|INFOTECH|VENTURES|LABS|DIGITAL|MEDIA|LOGISTICS|PHARMA|HEALTHCARE|INFRA|EXPORTS|associates)\b/i;
  const CORPORATE_CHANNEL_RE = /^(?:NEFT|RTGS|IMPS|MANDATE|TRANSFER)$/i;

  const payerCandidateMap = new Map();
  for (const t of txs) {
    if (t.credit < 3000 || t.isExcludedCredit || t.isInternalMovement || t.isRelatedParty) continue;
    const nUpper = (t.narration || '').toUpperCase();
    const cpUpper = (t.counterparty || 'EXTERNAL PARTY').toUpperCase();
    const hasSalaryWording = SALARY_WORDING_RE.test(nUpper);
    const hasCorporateName = CORPORATE_SUFFIX_RE.test(cpUpper) || CORPORATE_SUFFIX_RE.test(nUpper);
    const isNonP2PTransfer = CORPORATE_CHANNEL_RE.test(t.mode || '') && t.category !== 'UPI P2P';

    if (!hasSalaryWording && !hasCorporateName && !isNonP2PTransfer) {
      continue; // Exclude irregular individual UPI P2P transfers
    }

    const pKey = cpUpper !== 'EXTERNAL PARTY' && cpUpper !== 'UPI COUNTERPARTY' ? cpUpper : (hasSalaryWording ? 'EMPLOYER PAYROLL' : null);
    if (!pKey) continue;

    if (!payerCandidateMap.has(pKey)) {
      payerCandidateMap.set(pKey, {
        payer: pKey,
        hasSalaryWording,
        hasCorporateName,
        isNonP2PTransfer,
        months: new Set(),
        amounts: [],
        total: 0,
      });
    }
    const entry = payerCandidateMap.get(pKey);
    if (hasSalaryWording) entry.hasSalaryWording = true;
    if (hasCorporateName) entry.hasCorporateName = true;
    entry.months.add(monthKey(t.date));
    entry.amounts.push(t.credit);
    entry.total = Math.round((entry.total + t.credit) * 100) / 100;
  }

  let bestSalaryMatch = null;
  for (const cand of payerCandidateMap.values()) {
    if (cand.months.size < 2) continue;
    const med = computeMedian(cand.amounts);
    const minA = Math.min(...cand.amounts);
    const maxA = Math.max(...cand.amounts);
    const isSimilarAmount = med > 0 && (maxA - minA) / med <= 0.20;

    // Qualifies if explicit salary wording, corporate suffix, or non-P2P transfer with repeating similar amount
    if (cand.hasSalaryWording || cand.hasCorporateName || (cand.isNonP2PTransfer && isSimilarAmount)) {
      if (!bestSalaryMatch || cand.total > bestSalaryMatch.total) {
        bestSalaryMatch = {
          ...cand,
          monthsList: Array.from(cand.months).sort(),
          medianAmount: Math.round(med * 100) / 100,
          isSimilarAmount,
        };
      }
    }
  }

  const salaryDetected = Boolean(bestSalaryMatch);
  const salaryStatusLabel = salaryDetected
    ? (hasSufficientHistory ? 'Confirmed recurring salary / corporate payroll' : 'possible salary (limited history)')
    : 'No recurring salary detected';

  const salaryCheckEvidence = {
    detected: salaryDetected,
    status: salaryStatusLabel,
    payer: bestSalaryMatch ? bestSalaryMatch.payer : null,
    months: bestSalaryMatch ? bestSalaryMatch.monthsList : [],
    medianAmount: bestSalaryMatch ? bestSalaryMatch.medianAmount : 0,
    evidence: bestSalaryMatch
      ? `${hasSufficientHistory ? 'Recurring salary/payroll' : 'Possible salary (limited history)'} from ${bestSalaryMatch.payer} across ${bestSalaryMatch.monthsList.length} months (${bestSalaryMatch.monthsList.join(', ')}; median ₹${bestSalaryMatch.medianAmount.toLocaleString('en-IN')}).`
      : 'No recurring corporate payroll detected; inflows consist of self-employed or individual transfers.',
  };

  // 9. Bounces / Mandate Returns / Cheque Returns (Step 3)
  const bounceEvents = [];
  let returnChargesCount = 0;
  let returnChargesTotal = 0;
  for (const t of txs) {
    if (t.bounceInfo && t.bounceInfo.isBounce) {
      const chrgAmt = t.bounceInfo.chargeAmount || (t.category === 'Bank charges' ? t.debit : 0);
      if (chrgAmt > 0) {
        returnChargesCount++;
        returnChargesTotal = Math.round((returnChargesTotal + chrgAmt) * 100) / 100;
      }
      bounceEvents.push({
        date: t.date,
        bounceType: t.bounceInfo.bounceType || 'Mandate / Payment Return',
        mandate: t.bounceInfo.mandate || t.counterparty || t.narration,
        chargeAmount: chrgAmt,
        amount: t.debit > 0 ? t.debit : t.credit,
        narration: t.narration,
      });
    }
  }
  const emiBounces = bounceEvents.length;

  // 10. ATM Cash Withdrawals & Cash Deposits Totals (Step 3)
  let atmWithdrawalTotal = 0;
  let atmWithdrawalCount = 0;
  let cashDepositTotal = 0;
  let cashDepositCount = 0;
  let cashWithdrawalTotal = 0;
  let cashWithdrawalCount = 0;

  for (const t of txs) {
    if (t.category === 'ATM cash' || t.mode === 'ATM') {
      if (t.debit > 0) {
        atmWithdrawalTotal = Math.round((atmWithdrawalTotal + t.debit) * 100) / 100;
        atmWithdrawalCount++;
      }
    } else if (t.category === 'Cash' || t.mode === 'CASH') {
      if (t.credit > 0) {
        cashDepositTotal = Math.round((cashDepositTotal + t.credit) * 100) / 100;
        cashDepositCount++;
      }
      if (t.debit > 0) {
        cashWithdrawalTotal = Math.round((cashWithdrawalTotal + t.debit) * 100) / 100;
        cashWithdrawalCount++;
      }
    }
  }

  // 11. Recurring Obligations, Rent, One-time Loan Payments & Annual Premiums (Step 3)
  // Micro amounts (< ₹10) are ignored for obligations.
  // One-time loan payments and annual premiums are listed separately and excluded from FOIR.
  const NAMED_LENDER_RE = /\b(?:HOME\s*LOAN|GOLD\s*LOAN|PERSONAL\s*LOAN|CAR\s*LOAN|AUTO\s*LOAN|HOUSING\s*LOAN|TVS\s*CREDIT|BAJAJ|HDBFS|HDB\s*FINANCIAL|MUTHOOT|MANAPPURAM|CHOLAMANDALAM|CHOLA\b|HOME\s*CREDIT|TATA\s*CAPITAL|IDFC\s*FIRST|L&T\s*FINANCE|MAHINDRA\s*FINANCE|SHRIRAM|ADITYA\s*BIRLA\s*FINANCE|POONAWALLA|FULLERTON|SMFG|HERO\s*FINCORP|IIFL|PIRAMAL|INDIABULLS|LIC\s*HOUSING|PNB\s*HOUSING|HDFC\s*LTD|KREDITBEE|NAVI\b|KISSHT|RING\b|MONEYVIEW|PAYSENSE|CASHE|EARLYSALARY|FIBE\b|LAZYPAY|SIMPL\b|SLICE\b|MPOCKKET|STASHFIN|TRUE\s*BALANCE|DHANI|ZESTMONEY|LENDINGKART|INDIFI|KINARA|MUDRA|FINANCE|CAPITAL)\b/i;
  const EXPLICIT_MANDATE_RE = /\b(?:AUTOPAY|MANDATE|NACH|ECS|SI\s*DR|ACH\s*DR|ACH\b|ECS\b)\b/i;
  const EXPLICIT_LOAN_EMI_RE = /\b(?:EMI|LOAN|REPAYMENT)\b/i;
  const INSURANCE_SCHEME_RE = /\b(?:APY[\-\s]*SI|PMSBY|PMJJBY|APY|ATAL\s*PENSION|LIC\b|INSURANCE|POLICY|STAR\s*HEALTH|HDFC\s*LIFE|SBI\s*LIFE|ICICI\s*PRU|MAX\s*LIFE)\b/i;

  const debitGroups = new Map();

  for (const t of txs) {
    if (t.debit < 10) continue; // Ignore micro debits (< ₹10)
    if (
      t.isInternalMovement ||
      t.category === 'Own-account transfer' ||
      t.category === 'Sweep/FD (internal)' ||
      t.category === 'Bank charges' ||
      t.category === 'Cash' ||
      t.category === 'ATM cash' ||
      t.category === 'Investment' ||
      t.category === 'Credit card payment' ||
      (t.bounceInfo && t.bounceInfo.isBounce)
    ) {
      continue;
    }

    const n = (t.narration || '').toUpperCase();
    const cp = (t.counterparty || 'EXTERNAL PARTY').toUpperCase();

    const isNamedLender = NAMED_LENDER_RE.test(n) || NAMED_LENDER_RE.test(cp);
    const isExplicitMandate = EXPLICIT_MANDATE_RE.test(n);
    const isLoanWording =
      t.category === 'Loan/EMI' || EXPLICIT_LOAN_EMI_RE.test(n) || /loan\.\d+@/i.test(t.rawNarration || t.narration || '');
    const isInsurance =
      t.category === 'Insurance/pension' || INSURANCE_SCHEME_RE.test(n) || INSURANCE_SCHEME_RE.test(cp);
    const isRent = t.category === 'Rent' || /\bRENT\b/i.test(n);

    let groupKey = null;
    let label = null;
    let rule = null;
    let kind = null;
    let isLoanEvidence = false;

    if (isInsurance) {
      const schemeMatch = n.match(/\b(PMSBY|PMJJBY|APY|LIC|STAR\s*HEALTH|HDFC\s*LIFE|SBI\s*LIFE|ICICI\s*PRU|MAX\s*LIFE)\b/i);
      const schemeName = schemeMatch ? schemeMatch[1].toUpperCase() : cp;
      groupKey = `ins_${schemeName}`;
      label =
        schemeName === 'PMSBY'
          ? 'Pradhan Mantri Suraksha Bima Yojana (PMSBY)'
          : schemeName === 'PMJJBY'
          ? 'Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)'
          : schemeName === 'APY'
          ? 'Atal Pension Yojana (APY)'
          : `${schemeName} (${t.narration.slice(0, 60)})`;
      rule = `Standing Instruction / Insurance (${t.narration.slice(0, 80)})`;
      kind = 'insurance';
      isLoanEvidence = false;
    } else if (isNamedLender) {
      const lenderMatch = `${cp} ${n}`.match(NAMED_LENDER_RE);
      const lenderName = lenderMatch ? lenderMatch[0].toUpperCase() : cp;
      groupKey = `lender_${lenderName}`;
      label = `${lenderName} (${t.narration.slice(0, 60)})`;
      rule = `Named lender / loan debit (${t.narration.slice(0, 80)})`;
      kind = 'lender';
      isLoanEvidence = true;
    } else if (isExplicitMandate) {
      const hasSpecificPayee = cp && !/^(?:LENDER \/ MANDATE|EXTERNAL PARTY|UPI COUNTERPARTY|OTHER)$/.test(cp);
      const bucketAmt = Math.round(t.debit / 10) * 10;
      groupKey = hasSpecificPayee ? `mandate_${cp}_${bucketAmt}` : `mandate_amt_${bucketAmt}`;
      label = hasSpecificPayee
        ? `${cp} — ${t.narration.slice(0, 60)}`
        : `${t.narration.slice(0, 60)}`;
      rule = `Standing Instruction / Mandate (${t.narration.slice(0, 80)})`;
      kind = 'mandate';
      isLoanEvidence = true;
    } else if (isLoanWording) {
      groupKey = `loan_${cp}`;
      label = `Loan / EMI Repayment (${cp})`;
      rule = 'Explicit loan/EMI wording in narration';
      kind = 'loan_wording';
      isLoanEvidence = true;
    } else if (isRent) {
      groupKey = `rent_${cp}`;
      label = `Rent Payment (${cp})`;
      rule = 'Rent wording in narration';
      kind = 'rent';
      isLoanEvidence = false;
    } else if (
      cp &&
      !/^(?:EXTERNAL PARTY|UPI COUNTERPARTY|MERCHANT|UTILITY \/ RECHARGE|OTHER|CASH \/ ATM|ATM CASH WITHDRAWAL|CASH DEPOSIT \/ WITHDRAWAL|BANK CHARGES|MUTUAL FUND \/ AMC|CREDIT CARD|FOOD DELIVERY|TRAVEL \/ TRANSPORT)$/.test(
        cp
      ) &&
      t.category !== 'UPI P2M' &&
      t.category !== 'Food delivery' &&
      t.category !== 'Travel/transport' &&
      t.category !== 'Utilities & bills' &&
      t.debit >= 500
    ) {
      const bucketAmt = Math.round(t.debit / 50) * 50;
      groupKey = `payee_${cp}_${bucketAmt}`;
      label = `${cp} (Recurring Debit)`;
      rule = 'Same payee in 2+ months with similar amounts';
      kind = 'recurring_payee';
      isLoanEvidence = false;
    }

    if (groupKey) {
      const mKey = monthKey(t.date);
      if (!debitGroups.has(groupKey)) {
        debitGroups.set(groupKey, {
          payee: label,
          amounts: [],
          totalPaid: 0,
          months: new Set(),
          txnCount: 0,
          rule,
          kind,
          isLoanEvidence,
          sampleNarration: t.narration || '',
        });
      }
      const g = debitGroups.get(groupKey);
      g.amounts.push(t.debit);
      g.totalPaid = Math.round((g.totalPaid + t.debit) * 100) / 100;
      g.months.add(mKey);
      g.txnCount++;
    }
  }

  const recurringObligations = [];
  const otherLoanInsurancePayments = [];
  let totalMonthlyEmi = 0;

  for (const item of debitGroups.values()) {
    const monthsCount = item.months.size;
    const medianAmt = Math.round(computeMedian(item.amounts) * 100) / 100;
    const minAmt = Math.min(...item.amounts);
    const maxAmt = Math.max(...item.amounts);
    const isSimilarAmount =
      medianAmt > 0 && (maxAmt - minAmt) / medianAmt <= ENGINE_CONFIG.recurringAmountTolerance;

    const isDebtObligation =
      item.kind === 'lender' ||
      item.kind === 'mandate' ||
      item.kind === 'loan_wording';

    const isMonthlyObligation =
      (isDebtObligation && monthsCount >= 2) ||
      (item.kind === 'rent' && monthsCount >= 2 && isSimilarAmount) ||
      (item.kind === 'insurance' && isSimilarAmount && monthsCount >= 2);

    if (isMonthlyObligation) {
      recurringObligations.push({
        payee: item.payee,
        counterparty: item.payee,
        frequency: `Monthly (${monthsCount} mo)`,
        amount: medianAmt,
        monthlyAmount: medianAmt,
        monthsCount,
        count: item.txnCount,
        txnCount: item.txnCount,
        totalPaid: item.totalPaid,
        totalAmount: item.totalPaid,
        rule: `${item.rule} (${monthsCount} months)`,
        isLoanEvidence: item.isLoanEvidence,
      });
      totalMonthlyEmi = Math.round((totalMonthlyEmi + medianAmt) * 100) / 100;
    } else if (
      item.kind === 'lender' ||
      item.kind === 'mandate' ||
      item.kind === 'loan_wording' ||
      item.kind === 'insurance' ||
      item.kind === 'rent'
    ) {
      const hasExplicitAnnualOrOneTime = /\b(?:ANNUAL|YEARLY|ONE[\-\s]*TIME)\b/i.test(item.sampleNarration || '');
      const freqLabel = hasExplicitAnnualOrOneTime
        ? 'Annual / One-time (per narration)'
        : `${item.txnCount} debit(s) in ${monthsCount} mo`;
      const ruleLabel = hasExplicitAnnualOrOneTime
        ? `${item.rule} (annual / one-time per narration; excluded from FOIR)`
        : `${item.rule} (${item.txnCount} debit(s) observed in ${monthsCount} month(s); excluded from monthly FOIR)`;
      otherLoanInsurancePayments.push({
        payee: item.payee,
        counterparty: item.payee,
        frequency: freqLabel,
        amount: medianAmt,
        monthlyAmount: medianAmt,
        monthsCount,
        count: item.txnCount,
        txnCount: item.txnCount,
        totalPaid: item.totalPaid,
        totalAmount: item.totalPaid,
        rule: ruleLabel,
        isLoanEvidence: item.isLoanEvidence,
      });
    }
  }

  let foir = null;
  const foirCap = 0.50;
  if (hasSufficientHistory && recurringObligations.length > 0 && medianMonthlyIncome > 0) {
    foir = Math.round((totalMonthlyEmi / medianMonthlyIncome) * 1000) / 10;
  }
  const maxEmiCapacity =
    hasSufficientHistory && medianMonthlyIncome > 0
      ? Math.round(medianMonthlyIncome * foirCap * 100) / 100
      : 0;
  const availableEmiCapacity =
    hasSufficientHistory && medianMonthlyIncome > 0
      ? Math.max(0, Math.round((maxEmiCapacity - totalMonthlyEmi) * 100) / 100)
      : 0;
  const abbToEmiRatio =
    totalMonthlyEmi > 0 ? Math.round((avgEod / totalMonthlyEmi) * 100) / 100 : null;

  // 12. Circular / Pass-Through / High-Turnover Cash Pass-Through (Step 3)
  // Exclude internal movements and micro amounts (< ₹10).
  // Large cash deposits followed by quick outflows (pass-through) are flagged with real dates.
  const allCircularEvents = [];
  const cashPassThroughEvents = [];
  let smallPassThroughCount = 0;
  let smallPassThroughTotal = 0;
  let smallCyclicCount = 0;
  let smallCyclicTotal = 0;
  let circularCreditTotal = 0;

  const creditsByDate = new Map();
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    if (
      t.credit >= 10 &&
      !t.isInternalMovement &&
      t.category !== 'Own-account transfer' &&
      t.category !== 'Sweep/FD (internal)' &&
      t.category !== 'Interest' &&
      t.category !== 'Refund/reversal' &&
      !rotatedCreditTxIds.has(t.id || i + 1)
    ) {
      if (!creditsByDate.has(t.date)) {
        creditsByDate.set(t.date, {
          date: t.date,
          firstIdx: i,
          lastIdx: i,
          totalCredit: 0,
          cashDepositCredit: 0,
          counterparties: new Set(),
          txIds: [],
        });
      }
      const grp = creditsByDate.get(t.date);
      grp.lastIdx = i;
      grp.totalCredit = Math.round((grp.totalCredit + t.credit) * 100) / 100;
      if (t.category === 'Cash' || t.mode === 'CASH') {
        grp.cashDepositCredit = Math.round((grp.cashDepositCredit + t.credit) * 100) / 100;
      }
      if (t.counterparty) grp.counterparties.add(t.counterparty);
      grp.txIds.push(t.id || i + 1);
    }
  }

  for (const grp of creditsByDate.values()) {
    const cTs = grp.date ? (parseDate(grp.date)?.getTime() || 0) : 0;
    let out24 = 0;
    let out48 = 0;
    let out72 = 0;
    let out7d = 0;
    let lastOutDate48 = grp.date;
    const debitTxIds = [];

    for (let j = grp.firstIdx + 1; j < txs.length; j++) {
      const next = txs[j];
      const diffMs = (next._ts || (parseDate(next.date)?.getTime() || 0)) - cTs;
      if (diffMs < 0) continue;
      const hours = diffMs / (1000 * 60 * 60);
      if (hours <= 168) {
        if (
          next.debit >= 10 &&
          !next.isInternalMovement &&
          next.category !== 'Own-account transfer' &&
          next.category !== 'Sweep/FD (internal)' &&
          next.category !== 'Bank charges'
        ) {
          if (hours <= 24) out24 += next.debit;
          if (hours <= 48) {
            out48 += next.debit;
            lastOutDate48 = next.date;
            debitTxIds.push(next.id || j + 1);
          }
          if (hours <= 72) out72 += next.debit;
          out7d += next.debit;
        }
      } else {
        break;
      }
    }

    const is48hPassThrough = out48 >= grp.totalCredit * ENGINE_CONFIG.largeInflowOutRatio;
    const isMultiDayDrain =
      grp.totalCredit >= ENGINE_CONFIG.largeInflowThreshold &&
      out7d >= grp.totalCredit * ENGINE_CONFIG.largeInflowOutRatio;

    if (is48hPassThrough || isMultiDayDrain) {
      if (grp.totalCredit < ENGINE_CONFIG.minListedCircularAmount) {
        smallPassThroughCount++;
        smallPassThroughTotal = Math.round((smallPassThroughTotal + grp.totalCredit) * 100) / 100;
        continue;
      }
      circularCreditTotal = Math.round((circularCreditTotal + grp.totalCredit) * 100) / 100;
      const pct24 = grp.totalCredit > 0 ? Math.min(100, Math.round((out24 / grp.totalCredit) * 100)) : 0;
      const pct48 = grp.totalCredit > 0 ? Math.min(100, Math.round((out48 / grp.totalCredit) * 100)) : 0;
      const pct72 = grp.totalCredit > 0 ? Math.min(100, Math.round((out72 / grp.totalCredit) * 100)) : 0;
      const pct7d = grp.totalCredit > 0 ? Math.min(100, Math.round((out7d / grp.totalCredit) * 100)) : 0;
      const cpLabel = Array.from(grp.counterparties).slice(0, 2).join(', ') || 'EXTERNAL INFLOW';
      const isCashPassThrough = grp.cashDepositCredit >= 5000 && grp.cashDepositCredit >= grp.totalCredit * 0.5;

      const evObj = {
        type: isCashPassThrough ? 'CASH_PASS_THROUGH' : 'PASS_THROUGH',
        ruleId: 'Rule 1g',
        rule: isCashPassThrough ? 'Cash Deposit Pass-Through (48h)' : 'Rule 1g (Pass-Through)',
        counterparty: cpLabel,
        creditDate: grp.date,
        debitDate: lastOutDate48,
        creditAmount: grp.totalCredit,
        debitAmount: Math.round(out48 * 100) / 100,
        outWithin1Day: Math.round(out24 * 100) / 100,
        outWithin48h: Math.round(out48 * 100) / 100,
        percentMoved: pct48,
        pctOut: pct48,
        pctOut24h: `${pct24}%`,
        pctOut72h: `${pct72}%`,
        pctOut7d: `${pct7d}%`,
        transactionIds: [...new Set([...grp.txIds, ...debitTxIds])],
        description: `${isCashPassThrough ? 'Cash deposit' : 'Inflow'} of ₹${Math.round(grp.totalCredit).toLocaleString('en-IN')} on ${grp.date} followed by outflow of ₹${Math.round(out48).toLocaleString('en-IN')} by ${lastOutDate48} (${pct24}% within 24h, ${pct72}% within 72h, ${pct7d}% within 7d; ${cpLabel})`,
      };
      allCircularEvents.push(evObj);
      if (isCashPassThrough) {
        cashPassThroughEvents.push(evObj);
      }
    }
  }

  // Rule 1f: Same-counterparty round trips within 48 hours using actual transaction dates (excluding internal movements and micro amounts)
  const usedRule1fIndices = new Set();
  for (let i = 0; i < txs.length; i++) {
    if (usedRule1fIndices.has(i)) continue;
    const t = txs[i];
    if (t.isInternalMovement || t.category === 'Own-account transfer' || t.category === 'Sweep/FD (internal)') continue;
    const amt1 = Math.max(t.credit, t.debit);
    if (amt1 < 10) continue;
    const core1 = getCoreCpKey(t.rawNarration || t.narration, t.counterparty, t.mobileNumber);
    if (!core1) continue;

    const d1Ms = t._ts || (parseDate(t.date)?.getTime() || 0);
    for (let j = i + 1; j < txs.length; j++) {
      if (usedRule1fIndices.has(j)) continue;
      const next = txs[j];
      if (next.isInternalMovement || next.category === 'Own-account transfer' || next.category === 'Sweep/FD (internal)') continue;
      const amt2 = Math.max(next.credit, next.debit);
      if (amt2 < 10) continue;

      const d2Ms = next._ts || (parseDate(next.date)?.getTime() || 0);
      const diffHours = (d2Ms - d1Ms) / (1000 * 60 * 60);
      if (diffHours < 0) continue;
      if (diffHours > 48) break;

      const core2 = getCoreCpKey(next.rawNarration || next.narration, next.counterparty, next.mobileNumber);
      const isOppositeDirection = (t.credit > 0 && next.debit > 0) || (t.debit > 0 && next.credit > 0);
      if (core1 === core2 && isOppositeDirection) {
        const cAmt = t.credit > 0 ? t.credit : next.credit;
        const dAmt = t.debit > 0 ? t.debit : next.debit;
        const maxAmt = Math.max(cAmt, dAmt);
        const minAmt = Math.min(cAmt, dAmt);

        if (minAmt < maxAmt * 0.20) continue;

        usedRule1fIndices.add(i);
        usedRule1fIndices.add(j);

        if (maxAmt < ENGINE_CONFIG.minListedCircularAmount) {
          smallCyclicCount++;
          smallCyclicTotal = Math.round((smallCyclicTotal + maxAmt) * 100) / 100;
          break;
        }

        circularCreditTotal = Math.round((circularCreditTotal + cAmt) * 100) / 100;
        const cDateStr = t.credit > 0 ? t.date : next.date;
        const dDateStr = t.debit > 0 ? t.date : next.date;
        const dateRangeStr = t.date === next.date ? t.date : `${t.date} → ${next.date}`;
        const pctOut = cAmt > 0 ? Math.min(100, Math.round((dAmt / cAmt) * 100)) : 100;

        allCircularEvents.push({
          type: 'CYCLIC_ROTATION',
          ruleId: 'Rule 1f',
          rule: 'Rule 1f (Round-Trip 48h)',
          counterparty: t.counterparty || core1,
          creditDate: cDateStr,
          actualCreditDate: cDateStr,
          debitDate: dDateStr,
          dateRange: dateRangeStr,
          creditAmount: cAmt,
          debitAmount: dAmt,
          pctOut,
          rankAmount: maxAmt,
          transactionIds: [t.id || i + 1, next.id || j + 1],
          description: `Same-counterparty round-trip within 48h (${t.date} → ${next.date}): credit ₹${Math.round(cAmt).toLocaleString('en-IN')}, debit ₹${Math.round(dAmt).toLocaleString('en-IN')} (${t.counterparty || core1})`,
        });
        break;
      }
    }
  }

  allCircularEvents.sort((a, b) => (b.rankAmount || b.creditAmount || 0) - (a.rankAmount || a.creditAmount || 0));

  const circularEvents = allCircularEvents;
  const circularTxIdSet = new Set(circularEvents.flatMap((e) => e.transactionIds || []));
  for (const t of txs) {
    if (circularTxIdSet.has(t.id)) {
      t.isCircular = true;
    }
  }

  const rule1fEvents = circularEvents.filter((e) => e.ruleId === 'Rule 1f');
  const rule1gEvents = circularEvents.filter((e) => e.ruleId === 'Rule 1g');
  const circularPctOfCredits =
    totalCredits > 0 ? Math.min(100, Math.round((circularCreditTotal / totalCredits) * 1000) / 10) : 0;

  // AML Velocity Indicators (rapid movement, structuring cash 40k-49.9k, round-figure spikes >= 50k)
  let structuringCashCount = 0;
  let structuringCashTotal = 0;
  let roundFigureSpikeCount = 0;
  let roundFigureSpikeTotal = 0;

  for (const t of txs) {
    const amt = Math.max(t.credit || 0, t.debit || 0);
    if ((t.category === 'Cash' || t.mode === 'CASH') && t.credit >= 40000 && t.credit < 50000) {
      structuringCashCount++;
      structuringCashTotal = Math.round((structuringCashTotal + t.credit) * 100) / 100;
    }
    if (amt >= 50000 && amt % 10000 === 0 && !t.isInternalMovement) {
      roundFigureSpikeCount++;
      roundFigureSpikeTotal = Math.round((roundFigureSpikeTotal + amt) * 100) / 100;
    }
  }

  const amlIndicators = [];
  if (rule1fEvents.length > 0) {
    amlIndicators.push({
      rule: 'Rule 1f (Same-counterparty round trips within 48h)',
      eventCount: rule1fEvents.length,
      severity: 'AMBER',
      finding: `${rule1fEvents.length} listed round-trip event(s) >= ₹5,000 within 48 hours${smallCyclicCount > 0 ? ` (+${smallCyclicCount} smaller round-trip(s) totaling ₹${Math.round(smallCyclicTotal).toLocaleString('en-IN')})` : ''}`,
    });
  }
  if (rule1gEvents.length > 0) {
    amlIndicators.push({
      rule: 'Rule 1g (Pass-through >=80% out within 48h / multi-day drain)',
      eventCount: rule1gEvents.length,
      severity: 'AMBER',
      finding: `${rule1gEvents.length} listed pass-through event(s) >= ₹5,000 where >=80% moved out within 48h/7d${smallPassThroughCount > 0 ? ` (+${smallPassThroughCount} smaller pass-through(s) totaling ₹${Math.round(smallPassThroughTotal).toLocaleString('en-IN')})` : ''}`,
    });
  }
  if (cashPassThroughEvents.length > 0) {
    amlIndicators.push({
      rule: 'Cash Deposit Pass-Through (Large cash deposit followed by quick outflow)',
      eventCount: cashPassThroughEvents.length,
      severity: 'RED',
      finding: `${cashPassThroughEvents.length} cash deposit pass-through event(s): ${cashPassThroughEvents.map((e) => `${e.creditDate} → ${e.debitDate} (₹${Math.round(e.creditAmount).toLocaleString('en-IN')})`).join('; ')}`,
    });
  }
  amlIndicators.rapidMovementCount = rule1gEvents.length;
  amlIndicators.structuringCashCount = structuringCashCount;
  amlIndicators.structuringCashTotal = structuringCashTotal;
  amlIndicators.roundFigureSpikeCount = roundFigureSpikeCount;
  amlIndicators.roundFigureSpikeTotal = roundFigureSpikeTotal;

  // 13. Category Breakdown & Top Transactions for Report
  const debitCatMap = new Map();
  const creditCatMap = new Map();
  for (const t of txs) {
    const cat = t.category || 'Other';
    if (t.debit > 0) {
      if (!debitCatMap.has(cat)) debitCatMap.set(cat, { category: cat, count: 0, total: 0 });
      const entry = debitCatMap.get(cat);
      entry.count++;
      entry.total = Math.round((entry.total + t.debit) * 100) / 100;
    }
    if (t.credit > 0) {
      if (!creditCatMap.has(cat)) creditCatMap.set(cat, { category: cat, count: 0, total: 0 });
      const entry = creditCatMap.get(cat);
      entry.count++;
      entry.total = Math.round((entry.total + t.credit) * 100) / 100;
    }
  }
  const debitCategories = Array.from(debitCatMap.values())
    .map((c) => ({
      ...c,
      pct: totalDebits > 0 ? Math.round((c.total / totalDebits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const creditCategories = Array.from(creditCatMap.values())
    .map((c) => ({
      ...c,
      pct: totalCredits > 0 ? Math.round((c.total / totalCredits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const topCreditTxns = [...txs]
    .filter((t) => t.credit > 0)
    .sort((a, b) => b.credit - a.credit)
    .slice(0, 10)
    .map((t) => ({
      date: t.date,
      counterparty: t.counterparty,
      narration: t.narration,
      category: t.category,
      amount: t.credit,
    }));

  const topDebitTxns = [...txs]
    .filter((t) => t.debit > 0)
    .sort((a, b) => b.debit - a.debit)
    .slice(0, 10)
    .map((t) => ({
      date: t.date,
      counterparty: t.counterparty,
      narration: t.narration,
      category: t.category,
      amount: t.debit,
    }));

  // Top Inflow and Outflow Payment Modes
  const inflowModesMap = new Map();
  const outflowModesMap = new Map();
  for (const t of txs) {
    const mode = t.channel || t.mode || 'OTHER';
    if (t.credit > 0) {
      if (!inflowModesMap.has(mode)) inflowModesMap.set(mode, { mode, txns: 0, amount: 0 });
      const entry = inflowModesMap.get(mode);
      entry.txns++;
      entry.amount = Math.round((entry.amount + t.credit) * 100) / 100;
    }
    if (t.debit > 0) {
      if (!outflowModesMap.has(mode)) outflowModesMap.set(mode, { mode, txns: 0, amount: 0 });
      const entry = outflowModesMap.get(mode);
      entry.txns++;
      entry.amount = Math.round((entry.amount + t.debit) * 100) / 100;
    }
  }

  const topInflowModes = Array.from(inflowModesMap.values())
    .map((m) => ({
      ...m,
      pct: totalCredits > 0 ? Math.round((m.amount / totalCredits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topOutflowModes = Array.from(outflowModesMap.values())
    .map((m) => ({
      ...m,
      pct: totalDebits > 0 ? Math.round((m.amount / totalDebits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Top Outflow Destinations (#, destination, txns, amount, %, SELF/THIRD PARTY)
  const outflowDestMap = new Map();
  for (const t of txs) {
    if (t.debit > 0) {
      const dest = t.counterparty || 'EXTERNAL PARTY';
      const isSelf = Boolean(
        t.isInternalMovement ||
        t.category === 'Own-account transfer' ||
        t.category === 'Sweep/FD (internal)' ||
        /^(?:SELF|SELF \/ INTERNAL)$/i.test(dest)
      );
      if (!outflowDestMap.has(dest)) {
        outflowDestMap.set(dest, {
          destination: dest,
          txns: 0,
          amount: 0,
          type: isSelf ? 'SELF' : 'THIRD PARTY',
        });
      }
      const entry = outflowDestMap.get(dest);
      entry.txns++;
      entry.amount = Math.round((entry.amount + t.debit) * 100) / 100;
    }
  }

  const topOutflowDestinations = Array.from(outflowDestMap.values())
    .map((d) => ({
      ...d,
      pct: totalDebits > 0 ? Math.round((d.amount / totalDebits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Top Income Sources (#, counterparty, amount, % share, SELF or EXTERNAL)
  const incomeSourcesMap = new Map();
  for (const t of txs) {
    if (t.credit > 0) {
      const cp = t.counterparty || 'EXTERNAL PARTY';
      const isSelf = Boolean(
        t.isInternalMovement ||
        t.category === 'Own-account transfer' ||
        t.category === 'Sweep/FD (internal)' ||
        t.isPossibleOwnAccountRelated ||
        /^(?:SELF|SELF \/ INTERNAL)$/i.test(cp)
      );
      if (!incomeSourcesMap.has(cp)) {
        incomeSourcesMap.set(cp, {
          counterparty: cp,
          txns: 0,
          amount: 0,
          type: isSelf ? 'SELF' : 'EXTERNAL',
        });
      }
      const entry = incomeSourcesMap.get(cp);
      entry.txns++;
      entry.amount = Math.round((entry.amount + t.credit) * 100) / 100;
    }
  }

  const topIncomeSources = Array.from(incomeSourcesMap.values())
    .map((s) => ({
      ...s,
      pct: totalCredits > 0 ? Math.round((s.amount / totalCredits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // 14. Scorecard, Verdict & Counters (Bug Class 5: Scorecard and insight honesty)
  const scorecardRows = [];
  let redCount = 0;
  let amberCount = 0;
  let greenCount = 0;
  let neutralCount = 0;

  function addRow(factor, value, benchmark, level) {
    scorecardRows.push({
      factor,
      parameter: factor,
      value,
      benchmark,
      note: benchmark,
      level,
      status: level,
    });
    if (level === 'RED') redCount++;
    else if (level === 'AMBER') amberCount++;
    else if (level === 'NEUTRAL') neutralCount++;
    else greenCount++;
  }

  const loanRecurringList = recurringObligations.filter((o) => o.isLoanEvidence);
  const loanOneTimeList = otherLoanInsurancePayments.filter((o) => o.isLoanEvidence);
  const possibleLoanCreditsList = excludedCreditsList.filter((e) => e.bucket === 'loanDisbursementCredits' || /loan|disbursal/i.test(e.reason || ''));
  const hasObservedObligationsOrLoans =
    recurringObligations.length > 0 || loanOneTimeList.length > 0 || possibleLoanCreditsList.length > 0;

  // Factor 1: Repayment Discipline
  // Bug Class 5: If no obligations or loans exist, "Repayment Discipline" must read "No obligations observed"
  // with a neutral status (not GREEN "clean repayment record").
  if (emiBounces > 0) {
    const firstBounce = bounceEvents[0];
    const bAmt = Number(firstBounce?.amount ?? firstBounce?.chargeAmount ?? 0);
    const bAmtStr = Number.isFinite(bAmt) ? bAmt.toLocaleString('en-IN') : '0';
    addRow(
      'Repayment Discipline',
      `${emiBounces} bounce / return event(s) detected (e.g. ${firstBounce?.date || 'N/A'}: ${firstBounce?.bounceType || 'Return'} — ₹${bAmtStr})`,
      'Confirmed ECS/NACH/mandate or cheque return recorded on statement',
      emiBounces >= 2 ? 'RED' : 'AMBER'
    );
  } else if (!hasObservedObligationsOrLoans) {
    addRow(
      'Repayment Discipline',
      'No obligations observed',
      'No loan, EMI, or mandate obligations observed in the statement',
      'NEUTRAL'
    );
  } else {
    addRow(
      'Repayment Discipline',
      `0 bounce events across ${recurringObligations.length + loanOneTimeList.length} observed obligation(s)`,
      'No return or dishonour events on observed obligations',
      'GREEN'
    );
  }

  // Factor 2: Debt Serviceability (FOIR)
  if (!hasSufficientHistory && recurringObligations.length > 0) {
    addRow(
      'Debt Serviceability (FOIR)',
      `FOIR: Not available (Monthly obligations ₹${totalMonthlyEmi.toLocaleString('en-IN')}/m; insufficient full-month income history)`,
      'Requires at least 3 full calendar months of income history to compute FOIR',
      'AMBER'
    );
  } else if (foir !== null) {
    if (foir > 50) {
      addRow('Debt Serviceability (FOIR)', `FOIR: ${foir}% (Elevated obligation burden)`, 'Exceeds recommended benchmark of 50%', 'RED');
    } else if (foir >= 35) {
      addRow('Debt Serviceability (FOIR)', `FOIR: ${foir}% (High obligation burden)`, 'Approaching 50% threshold; requires income stability verification', 'AMBER');
    } else {
      addRow('Debt Serviceability (FOIR)', `FOIR: ${foir}% (Moderate obligation burden)`, 'Within serviceable threshold; verify ongoing income stability', 'GREEN');
    }
  } else {
    addRow('Debt Serviceability (FOIR)', 'Not available (No recurring monthly loan/mandate obligations detected)', 'FOIR not applicable', 'NEUTRAL');
  }

  // Factor 3: Cash Flow Quality
  const turnover = totalCredits + totalDebits;
  const netFlowRatio = turnover > 0 ? netCashFlow / turnover : 0;

  if (netCashFlow < 0) {
    addRow('Cash Flow Quality', `Net Cash Flow: -₹${Math.abs(netCashFlow).toLocaleString('en-IN')}`, 'Negative net retention over statement period', 'AMBER');
  } else if (netFlowRatio < 0.01) {
    addRow('Cash Flow Quality', `Net Cash Flow: +₹${netCashFlow.toLocaleString('en-IN')} (Negligible retention, <1% of turnover)`, 'Marginal net retention over period; not a positive cash-flow cushion', 'AMBER');
  } else {
    addRow('Cash Flow Quality', `Net Cash Flow: +₹${netCashFlow.toLocaleString('en-IN')} (${(netFlowRatio * 100).toFixed(1)}% of turnover)`, 'Positive cash retention over period', 'GREEN');
  }

  // Factor 4: Revenue Legitimacy (Step 3 salary evidence)
  if (salaryDetected) {
    addRow(
      'Revenue Legitimacy',
      hasSufficientHistory
        ? `Regular salary inflows (${bestSalaryMatch.payer}, ${bestSalaryMatch.monthsList.length} mo)`
        : `possible salary (limited history) — ${bestSalaryMatch.payer} (${bestSalaryMatch.monthsList.join(', ')})`,
      salaryCheckEvidence.evidence,
      hasSufficientHistory ? 'GREEN' : 'AMBER'
    );
  } else {
    addRow('Revenue Legitimacy', 'Self-employed / non-salary inflows', 'No standard corporate payroll credit detected', 'AMBER');
  }

  // Factor 5: Income Stability (CV)
  if (!hasSufficientHistory) {
    addRow(
      'Income Stability',
      `Insufficient history (${fullMonthCount} full calendar month(s); observed ₹${observedInflowPerMonth.toLocaleString('en-IN')}/month)`,
      'Minimum 3 full calendar months required to evaluate income stability and CV',
      'AMBER'
    );
  } else if (incomeCv > 100) {
    addRow('Income Stability', `CV: ${incomeCv}% (High volatility)`, 'Highly volatile or intermittent monthly inflows', 'AMBER');
  } else if (incomeCv >= 35) {
    addRow('Income Stability', `CV: ${incomeCv}% (Moderate variation)`, 'Noticeable fluctuations in monthly deposits', 'AMBER');
  } else {
    addRow('Income Stability', `CV: ${incomeCv}% (Stable)`, 'Consistent monthly inflows across full calendar months', 'GREEN');
  }

  // Factor 6: Circular Money
  const circularTxnCount = circularTxIdSet.size;
  if (circularEvents.length > 0 || creditCardRotationEvents.length > 0) {
    const parts = [];
    if (circularEvents.length > 0) {
      parts.push(`${circularEvents.length} circular/pass-through event(s) >= ₹5,000 (${circularTxnCount} txns)`);
    }
    if (creditCardRotationEvents.length > 0) {
      parts.push(`${creditCardRotationEvents.length} credit-card rotation event(s)`);
    }
    addRow(
      'Circular Money',
      parts.join('; '),
      'Inflows rapidly routed out, rotated between linked counterparties, or cycled via credit card bill payments',
      'AMBER'
    );
  } else if (smallPassThroughCount + smallCyclicCount > 0) {
    addRow(
      'Circular Money',
      `0 events >= ₹5,000 (${smallPassThroughCount + smallCyclicCount} minor sub-₹5,000 pass-through/round-trip occurrences)`,
      'No major circular bursts >= ₹5,000 detected',
      'GREEN'
    );
  } else {
    addRow('Circular Money', 'No circular patterns flagged', 'Clean transaction velocity', 'GREEN');
  }

  // Factor 7: Account Liquidity
  const minBalFormatted =
    minBalance < 0
      ? `-₹${Math.abs(minBalance).toLocaleString('en-IN')}`
      : `₹${minBalance.toLocaleString('en-IN')}`;
  if (calendarDaysBelow1kPct > 50) {
    addRow(
      'Account Liquidity',
      `EOD balance below ₹1,000 on ${calendarDaysBelow1kPct}% of calendar days (${calendarDaysBelow1k}/${calendarDaysTracked} days); Min balance: ${minBalFormatted}`,
      'Severe liquidity strain; borrower maintains negligible cash reserves',
      'RED'
    );
  } else if (calendarDaysBelow1kPct > 20) {
    addRow(
      'Account Liquidity',
      `EOD balance below ₹1,000 on ${calendarDaysBelow1kPct}% of calendar days (${calendarDaysBelow1k}/${calendarDaysTracked} days); Min balance: ${minBalFormatted}`,
      'Moderate liquidity strain; low EOD buffer on >20% of days',
      'AMBER'
    );
  } else {
    addRow(
      'Account Liquidity',
      `Below ₹1,000 on ${calendarDaysBelow1kPct}% of calendar days (${calendarDaysBelow1k}/${calendarDaysTracked} days); Min balance: ${minBalFormatted}`,
      'Adequate daily liquidity cushion',
      'GREEN'
    );
  }

  // Factor 8: Overdraft / negative balance (Trait 8)
  if (negativeBalanceDays > ENGINE_CONFIG.negativeBalanceRedDaysThreshold) {
    addRow(
      'Overdraft / negative balance',
      `Overdrawn on ${negativeBalanceDays} calendar day(s) (${negativeBalanceDaysPct}% of period; ${activeNegativeBalanceDays} active txn day(s)); Minimum balance: ${minBalFormatted}`,
      `Exceeds threshold of ${ENGINE_CONFIG.negativeBalanceRedDaysThreshold} overdrawn days; verify OD / FD-linked limit sanction terms`,
      'RED'
    );
  } else if (negativeBalanceDays > 0 || minBalance < 0) {
    addRow(
      'Overdraft / negative balance',
      `Overdrawn on ${negativeBalanceDays} calendar day(s) (${activeNegativeBalanceDays} active txn day(s)); Minimum balance: ${minBalFormatted}`,
      'Temporary negative / overdrawn balance observed within statement period',
      'AMBER'
    );
  } else {
    addRow(
      'Overdraft / negative balance',
      `0 overdrawn days; Minimum balance: ${minBalFormatted}`,
      'Account remained in positive credit balance throughout the period',
      'GREEN'
    );
  }

  // Factor 9: Loan-Like Evidence
  const loanEvidenceCount = loanRecurringList.length + loanOneTimeList.length + possibleLoanCreditsList.length;

  if (loanEvidenceCount > 0) {
    addRow(
      'Loan-Like Evidence',
      `${loanRecurringList.length} recurring loan/mandate obligation(s), ${loanOneTimeList.length} one-time loan payment(s), ${possibleLoanCreditsList.length} possible loan disbursal credit(s)`,
      'Verify active credit facilities against bureau report',
      'AMBER'
    );
  } else {
    addRow(
      'Loan-Like Evidence',
      'No loan-like debits or possible loan disbursals detected',
      'No undeclared loan/lender activity identified',
      'GREEN'
    );
  }

  // Factor 10: AML Signals
  if (amlIndicators.length > 0) {
    const rulesList = amlIndicators.map((a) => `${a.rule}: ${a.eventCount} event(s)`).join('; ');
    addRow(
      'AML Signals',
      `${circularEvents.length} listed event(s) triggered (${rulesList})`,
      'Enhanced source-of-funds verification required',
      cashPassThroughEvents.length > 0 ? 'RED' : 'AMBER'
    );
  } else {
    addRow('AML Signals', '0 AML signals triggered', 'No unusual money laundering velocity indicators', 'GREEN');
  }

  // Deterministic Verdict Decision
  let verdictLabel = 'LOW RISK / APPROVED';
  let verdictStatus = 'GREEN';
  let verdictReason = 'Satisfactory cash flow, liquidity cushion, and repayment history.';
  const verdictReasonsList = [];

  if (!hasSufficientHistory) {
    verdictLabel = 'INSUFFICIENT DATA - MANUAL REVIEW';
    verdictStatus = 'AMBER';
    verdictReason = `Statement contains only ${fullMonthCount} full calendar month(s) of transaction history (minimum 3 full calendar months required for reliable median income, CV, and FOIR underwriting).`;
    verdictReasonsList.push(verdictReason);
  } else if (
    redCount >= 1 ||
    circularEvents.length >= 3 ||
    calendarDaysBelow1kPct > 50 ||
    negativeBalanceDays > ENGINE_CONFIG.negativeBalanceRedDaysThreshold ||
    (incomeCv !== null && incomeCv > 100)
  ) {
    verdictLabel = 'CAUTION — ENHANCED DUE DILIGENCE';
    verdictStatus = redCount >= 1 ? 'RED' : 'AMBER';
    if (redCount >= 1) verdictReasonsList.push(`${redCount} high-risk factor(s)`);
    if (negativeBalanceDays > 0 || minBalance < 0) {
      verdictReasonsList.push(`overdrawn/negative balance on ${negativeBalanceDays} day(s) (min ${minBalFormatted})`);
    }
    if (emiBounces > 0) verdictReasonsList.push(`${emiBounces} bounce/return event(s)`);
    if (calendarDaysBelow1kPct > 50) {
      verdictReasonsList.push(`low liquidity (${calendarDaysBelow1kPct}% calendar days below ₹1,000)`);
    }
    if (incomeCv !== null && incomeCv > 100) verdictReasonsList.push(`high income volatility (CV ${incomeCv}%)`);
    else if (incomeCv !== null && incomeCv >= 35) verdictReasonsList.push(`moderate income variation (CV ${incomeCv}%)`);
    if (circularEvents.length >= 3) {
      verdictReasonsList.push(`${circularEvents.length} circular/pass-through events >= ₹5,000`);
    }
    verdictReason = `Triggered by ${verdictReasonsList.join(', ')}.`;
  } else if (amberCount >= 2) {
    verdictLabel = 'CONDITIONAL APPROVAL';
    verdictStatus = 'AMBER';
    verdictReason = `Triggered by ${amberCount} moderate-risk (AMBER) factor(s) with 0 high-risk (RED) factors; requires standard verification.`;
    verdictReasonsList.push(verdictReason);
  } else {
    verdictReasonsList.push(verdictReason);
  }

  const accountSummaryObj = {
    ...(extractedData.accountInfo || {}),
    accountHolderName: accountHolder,
    bankName: extractedData.bankName || 'Bank Statement',
    accountNumber: extractedData.accountNumberMasked || extractedData.accountNumber || 'Not printed on statement',
    accountNumberMasked: extractedData.accountNumberMasked || extractedData.accountNumber || 'Not printed on statement',
    accountType: extractedData.accountProfile?.accountType || 'Savings / Current Account',
    ifsc: extractedData.ifsc || 'Not printed on statement',
    printedPeriodFrom: printedFrom,
    printedPeriodTo: printedTo,
    printedPeriod,
    transactionsFrom,
    transactionsTo,
    transactionsPeriod,
    periodFrom: printedFrom || transactionsFrom,
    periodTo: printedTo || transactionsTo,
  };

  return {
    account: accountSummaryObj,
    accountInfo: accountSummaryObj,
    kpis: {
      accountHolder,
      printedPeriod,
      transactionsPeriod,
      statementPeriod: printedPeriod !== 'Not printed on statement' ? printedPeriod : transactionsPeriod,
      openingBalance,
      openingBalanceDerived,
      closingBalance,
      minBalance,
      maxBalance,
      abb: avgEod,
      avgEod,
      medianEodBalance,
      abbToEmiRatio,
      negativeBalanceDays,
      totalDaysOverdrawn,
      negativeBalanceDaysPct: `${negativeBalanceDaysPct}%`,
      negativeBalanceDaysPctNumeric: negativeBalanceDaysPct,
      activeNegativeBalanceDays,
      zeroBalanceDays: calendarDaysBelow1k,
      zeroBalanceDaysPct: calendarDaysBelow1kPct,
      totalTransactions: txs.length,
      totalCredits,
      genuineCreditTotal,
      totalDebits,
      creditCount,
      debitCount,
      creditTransactions: creditCount,
      debitTransactions: debitCount,
      netCashFlow,
      netFlowRatioPct: Math.round(netFlowRatio * 1000) / 10,
      hasSufficientHistory,
      insufficientHistory: !hasSufficientHistory,
      distinctCalendarDays: calendarDaysTracked,
      monthsCovered: monthlyIncomeSeries.length,
      fullMonthsCount: fullMonthCount,
      fullMonthCount,
      partialMonthsCount,
      observedMonthCount: monthlyIncomeSeries.length,
      grossMonthlyCredit,
      observedInflowPerMonth,
      observedInflowPerMonthExclRelated,
      estimatedMonthlyIncome: medianMonthlyIncome,
      medianMonthlyIncome,
      medianMonthlyIncomeDisplay,
      medianMonthlyIncomeWithoutRelatedParty,
      incomeCv: incomeCv !== null ? incomeCv : 'Insufficient history',
      incomeCvNumeric: incomeCv,
      incomeCvDisplay,
      incomeCvWithoutRelatedParty:
        incomeCvWithoutRelatedParty !== null ? incomeCvWithoutRelatedParty : 'Insufficient history',
      salaryDetected,
      salaryStatus: salaryStatusLabel,
      foir: foir !== null ? `${foir}%` : null,
      foirDisplay: foir !== null ? `${foir}%` : 'Not available',
      foirNumeric: foir,
      foirCap: hasSufficientHistory ? foirCap : null,
      maxEmiCapacity,
      availableEmiCapacity,
      monthlyObligation: totalMonthlyEmi,
      totalMonthlyEmi,
      emiBounces,
      returnChargesCount,
      returnChargesTotal,
      calendarDaysTracked,
      calendarDaysBelow1k,
      calendarDaysBelow1kPct: `${calendarDaysBelow1kPct}%`,
      calendarDaysBelow1kPctNumeric: calendarDaysBelow1kPct,
      calendarDaysBelow10k,
      calendarDaysBelow10kPct: `${calendarDaysBelow10kPct}%`,
      calendarDaysBelow10kPctNumeric: calendarDaysBelow10kPct,
      activeTxnDays: activeTxnDays.size,
      activeDaysBelow1k,
      activeDaysBelow1kPct: `${activeDaysBelow1kPct}%`,
      atmWithdrawalTotal,
      atmWithdrawalCount,
      cashDepositTotal,
      cashDepositCount,
      cashWithdrawalTotal,
      cashWithdrawalCount,
      circularCreditTotal,
      circularPctOfCredits,
      creditCardRotationTotal: totalCardRotationCredits,
      totalOwnAccountCredits,
      selfTransferInPct: totalCredits > 0 ? Math.round((totalOwnAccountCredits / totalCredits) * 1000) / 10 : 0,
      selfTransferOutPct: totalDebits > 0 ? Math.round((totalInternalDebits / totalDebits) * 1000) / 10 : 0,
      totalInternalCredits,
      totalInternalDebits,
      totalRefundCredits,
      totalReversalCredits,
      totalReversalsCredits,
      totalLoanCredits,
      totalInterestCredits,
      totalMicroCredits,
      totalCardRotationCredits,
      excludedCreditBuckets,
      relatedPartyInflowTotal,
      relatedPartyOutflowTotal,
      relatedPartyTxnCount,
      smallPassThroughCount,
      smallPassThroughTotal,
      smallCyclicCount,
      smallCyclicTotal,
      verdict: verdictLabel,
      verdictReason,
    },
    verdict: {
      status: verdictStatus,
      label: verdictLabel,
      reason: verdictReason,
      reasons: verdictReasonsList,
    },
    salaryCheckEvidence,
    fullMonthsInflows,
    monthlySummary: monthlyIncomeSeries,
    monthlyCashFlow: monthlyIncomeSeries,
    categories: {
      debits: debitCategories,
      credits: creditCategories,
    },
    topTransactions: {
      credits: topCreditTxns,
      debits: topDebitTxns,
    },
    topInflowModes,
    topOutflowModes,
    topIncomeSources,
    topOutflowDestinations,
    excludedCredits: excludedCreditsList,
    excludedCreditBuckets,
    internalMovements: {
      count: internalMovementsList.length,
      totalCredits: totalInternalCredits,
      totalDebits: totalInternalDebits,
      items: internalMovementsList,
    },
    internalMovementsList,
    bounceEvents,
    creditCardRotations: creditCardRotationEvents,
    cashPassThroughEvents,
    relatedParties: relatedPartiesList,
    mergedEntities,
    obligations: recurringObligations,
    recurringObligations,
    otherLoanInsurancePayments,
    circularEvents,
    flaggedCircularEvents: circularEvents,
    amlIndicators,
    transactions: txs,
    redCount,
    amberCount,
    greenCount,
    neutralCount,
    scorecard: Object.assign(scorecardRows, {
      rows: scorecardRows,
      redCount,
      amberCount,
      greenCount,
      neutralCount,
      verdict: verdictLabel,
      verdictReason,
    }),
  };
}

module.exports = {
  ENGINE_CONFIG,
  parseDate,
  monthKey,
  computeMedian,
  computeStdDev,
  computeBankAnalytics,
};
