'use strict';

const { createCanonicalTransaction, inferTransactionChannel } = require('./canonicalSchema');

/**
 * Normalizes Indian currency representations and standard amounts to a fixed 2-decimal float.
 * Handles:
 * - Indian commas: `5,04,181.01`, `1,00,000.00`
 * - Currency symbols: `₹ 1,981.00`, `Rs. 500.50`, `INR 10,000`
 * - Suffixes/Signs: `45.01Cr`, `100.00Dr`, `(500.00)`, `-250.00`
 * - Glued dashes/characters: `709.00-`
 */
function parseIndianAmount(rawVal) {
  if (typeof rawVal === 'number') {
    if (Number.isNaN(rawVal)) return { value: 0, sign: null };
    return {
      value: Math.round(Math.abs(rawVal) * 100) / 100,
      sign: rawVal < 0 ? 'DR' : 'CR',
    };
  }

  if (!rawVal) return { value: 0, sign: null };

  let s = String(rawVal).trim();

  // Detect explicit Dr/Cr suffix or parenthesis
  let explicitSign = null;
  if (/(?:cr|credit)\.?$/i.test(s) || /\b(?:cr|credit)\b/i.test(s)) {
    explicitSign = 'CR';
  } else if (/(?:dr|debit)\.?$/i.test(s) || /\b(?:dr|debit)\b/i.test(s)) {
    explicitSign = 'DR';
  } else if (s.startsWith('-') || s.endsWith('-') || (s.startsWith('(') && s.endsWith(')'))) {
    explicitSign = 'DR';
  } else if (s.startsWith('+')) {
    explicitSign = 'CR';
  }

  // Strip non-numeric formatting characters except period and minus
  s = s
    .replace(/[₹\s,]|Rs\.?|INR/gi, '')
    .replace(/(?:CR|DR)\.?$/gi, '')
    .replace(/\b(?:CR|DR)\b/gi, '')
    .replace(/[()]/g, '')
    .replace(/-$/, '')
    .trim();

  const num = parseFloat(s);
  if (Number.isNaN(num)) {
    return { value: 0, sign: null };
  }

  const rounded = Math.round(Math.abs(num) * 100) / 100;
  return {
    value: rounded,
    sign: explicitSign,
  };
}

/**
 * Standardize dates to DD-MM-YYYY format
 */
function normalizeDateString(rawDate) {
  if (!rawDate) return '';
  const s = String(rawDate).trim();

  // Match ISO YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${dd.padStart(2, '0')}-${mm.padStart(2, '0')}-${yyyy}`;
  }

  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    let [, dd, mm, yyyy] = dmyMatch;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${dd.padStart(2, '0')}-${mm.padStart(2, '0')}-${yyyy}`;
  }

  // Match DD-Mon-YYYY (e.g. 05-Aug-2025 or 05 Aug 2025)
  const monMatch = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})/);
  if (monMatch) {
    let [, dd, mon, yyyy] = monMatch;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[mon.toLowerCase()] || '01';
    return `${dd.padStart(2, '0')}-${mm}-${yyyy}`;
  }

  return s;
}

/**
 * Convert DD-MM-YYYY to timestamp for chronological comparison
 */
function dateToTimestamp(dStr) {
  if (!dStr) return 0;
  const parts = dStr.split('-');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts.map(Number);
    return new Date(yyyy || 2000, (mm || 1) - 1, dd || 1).getTime();
  }
  const t = Date.parse(dStr);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Join multi-line description tokens:
 * - When split mid-word (hyphenated word break, or alphanumeric concatenation boundary): join without space.
 * - Otherwise: join with single space.
 */
function joinWrappedDescriptions(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  if (lines.length === 1) return String(lines[0] || '').trim();

  let merged = '';
  for (let i = 0; i < lines.length; i++) {
    const rawLine = String(lines[i] || '').trim();
    if (!rawLine) continue;

    if (!merged) {
      merged = rawLine;
      continue;
    }

    // Check if previous ended with hyphen mid-word (e.g. "TRANS-" + "ACTION")
    if (merged.endsWith('-') && /^[a-zA-Z0-9]/.test(rawLine)) {
      merged = merged.slice(0, -1) + rawLine;
    }
    // Check if line ended mid-token where word was sliced without whitespace
    // (e.g. ending in lowercase letter and starting in lowercase letter of continuation word)
    else if (/[a-z]$/.test(merged) && /^[a-z]/.test(rawLine) && !/\s/.test(rawLine.slice(0, 4))) {
      merged = merged + rawLine;
    } else {
      merged = `${merged} ${rawLine}`;
    }
  }

  return merged.replace(/\s+/g, ' ').trim();
}

/**
 * Detect chronological sort order:
 * Examines both date progression and consecutive balance changes.
 * Returns 'ASC' (oldest first) or 'DESC' (newest first).
 */
function detectChronologicalSortOrder(rawRows = []) {
  if (!Array.isArray(rawRows) || rawRows.length < 2) return 'ASC';

  let dateAscVotes = 0;
  let dateDescVotes = 0;

  let balanceFwdMatches = 0;
  let balanceRevMatches = 0;

  for (let i = 1; i < rawRows.length; i++) {
    const prev = rawRows[i - 1];
    const curr = rawRows[i];

    // Date comparison
    const prevTs = dateToTimestamp(normalizeDateString(prev.date));
    const currTs = dateToTimestamp(normalizeDateString(curr.date));

    if (prevTs > 0 && currTs > 0 && prevTs !== currTs) {
      if (currTs > prevTs) dateAscVotes++;
      else if (currTs < prevTs) dateDescVotes++;
    }

    // Balance chain comparison
    const pBal = parseIndianAmount(prev.balance || prev.balance_after).value;
    const cBal = parseIndianAmount(curr.balance || curr.balance_after).value;
    const cDr = parseIndianAmount(curr.debit).value;
    const cCr = parseIndianAmount(curr.credit).value;
    const pDr = parseIndianAmount(prev.debit).value;
    const pCr = parseIndianAmount(prev.credit).value;

    const pBalPaise = Math.round(pBal * 100);
    const cBalPaise = Math.round(cBal * 100);

    // Forward chain: pBal + cCr - cDr === cBal
    if (cCr > 0 || cDr > 0) {
      const expFwd = pBalPaise + Math.round(cCr * 100) - Math.round(cDr * 100);
      if (Math.abs(expFwd - cBalPaise) <= 1) {
        balanceFwdMatches++;
      }
    }

    // Reverse chain: cBal + pCr - pDr === pBal (curr occurred before prev)
    if (pCr > 0 || pDr > 0) {
      const expRev = cBalPaise + Math.round(pCr * 100) - Math.round(pDr * 100);
      if (Math.abs(expRev - pBalPaise) <= 1) {
        balanceRevMatches++;
      }
    }
  }

  // Strong balance chain evidence takes precedence over ambiguous dates
  if (balanceRevMatches > balanceFwdMatches && balanceRevMatches >= 2) {
    return 'DESC';
  }
  if (balanceFwdMatches > balanceRevMatches && balanceFwdMatches >= 2) {
    return 'ASC';
  }

  // Otherwise rely on dates
  return dateDescVotes > dateAscVotes ? 'DESC' : 'ASC';
}

/**
 * Reverse list if descending (newest first) without altering intra-day sequence.
 * In bank statements sorted newest-first, intra-day transactions on the same day
 * should preserve reverse chronological sequence relative to each other.
 * Standard stable reverse on groups achieves this cleanly.
 */
function normalizeSortOrderToAsc(rows = [], detectedOrder = 'ASC') {
  if (!Array.isArray(rows) || rows.length <= 1) return [...rows];
  if (detectedOrder !== 'DESC') return [...rows];

  // Group by date to maintain intra-day consistency
  const dateGroups = [];
  let currentGroup = null;

  for (const r of rows) {
    const dStr = normalizeDateString(r.date);
    if (!currentGroup || currentGroup.date !== dStr) {
      currentGroup = { date: dStr, items: [r] };
      dateGroups.push(currentGroup);
    } else {
      currentGroup.items.push(r);
    }
  }

  // Reverse days so oldest day comes first, and reverse intra-day transactions
  // so the oldest transaction of that day comes first.
  const result = [];
  for (let i = dateGroups.length - 1; i >= 0; i--) {
    const groupItems = dateGroups[i].items;
    for (let j = groupItems.length - 1; j >= 0; j--) {
      result.push(groupItems[j]);
    }
  }

  return result;
}

/**
 * Normalizes raw parsed transaction items into canonical transactions.
 * Input rows can be raw parsed rows from regex, pdf table, or json.
 */
function normalizeTransactions(rawRows = [], options = {}) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];

  // 1. Detect chronological order
  const sortOrder = options.sortOrder || detectChronologicalSortOrder(rawRows);

  // 2. Normalize ordering to ASC (oldest first)
  const orderedRows = normalizeSortOrderToAsc(rawRows, sortOrder);

  // 3. Transform each row to Canonical Schema
  const canonicalList = [];

  for (let idx = 0; idx < orderedRows.length; idx++) {
    const raw = orderedRows[idx];

    // Normalized dates
    const date = normalizeDateString(raw.date || raw.txn_date || raw.transactionDate);
    const valueDate = raw.value_date || raw.val_date || raw.valueDate
      ? normalizeDateString(raw.value_date || raw.val_date || raw.valueDate)
      : null;

    // Joined raw description
    const descLines = Array.isArray(raw.description_lines)
      ? raw.description_lines
      : (Array.isArray(raw.narrationLines) ? raw.narrationLines : [raw.raw_description || raw.narration || raw.description || '']);
    const rawDescription = joinWrappedDescriptions(descLines);

    // Amounts and direction
    const parsedDebit = parseIndianAmount(raw.debit || raw.withdrawal || raw.dr);
    const parsedCredit = parseIndianAmount(raw.credit || raw.deposit || raw.cr);
    const parsedAmount = parseIndianAmount(raw.amount || raw.txn_amount);
    const parsedBalance = parseIndianAmount(raw.balance_after || raw.balance || raw.running_balance);

    let amount = 0;
    let direction = 'DEBIT';

    if (parsedCredit.value > 0 && parsedDebit.value === 0) {
      amount = parsedCredit.value;
      direction = 'CREDIT';
    } else if (parsedDebit.value > 0 && parsedCredit.value === 0) {
      amount = parsedDebit.value;
      direction = 'DEBIT';
    } else if (raw.direction) {
      amount = parsedAmount.value > 0 ? parsedAmount.value : (parsedCredit.value || parsedDebit.value);
      direction = String(raw.direction).toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT';
    } else if (parsedAmount.value > 0) {
      amount = parsedAmount.value;
      if (parsedAmount.sign === 'CR') direction = 'CREDIT';
      else if (parsedAmount.sign === 'DR') direction = 'DEBIT';
      else direction = 'DEBIT'; // Default prior to reconciliation balance delta
    }

    const refNo = raw.ref_no || raw.reference || raw.cheque_no || raw.chq_no || null;
    const sourcePage = Number(raw.source_page || raw.page || raw.pageNumber) || 1;
    const sourceLineIds = Array.isArray(raw.source_line_ids)
      ? raw.source_line_ids
      : (raw.line_id !== undefined ? [raw.line_id] : [idx + 1]);

    const canonicalTxn = createCanonicalTransaction({
      txn_id: raw.txn_id || `TXN_${idx + 1}`,
      date,
      value_date: valueDate,
      raw_description: rawDescription,
      amount,
      direction,
      balance_after: parsedBalance.value,
      ref_no: refNo ? String(refNo).trim() : null,
      source_page: sourcePage,
      source_line_ids: sourceLineIds,
    });

    canonicalList.push(canonicalTxn);
  }

  return canonicalList;
}

module.exports = {
  parseIndianAmount,
  normalizeDateString,
  joinWrappedDescriptions,
  detectChronologicalSortOrder,
  normalizeSortOrderToAsc,
  normalizeTransactions,
};
