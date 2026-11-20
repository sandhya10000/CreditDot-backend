'use strict';

/**
 * Single Canonical Transaction Schema specification and validator
 *
 * Each canonical transaction must adhere to:
 * {
 *   txn_id: string,               // Unique transaction identifier (e.g., TXN_1, or hash)
 *   date: string,                 // Standardized ISO date (YYYY-MM-DD) or DD-MM-YYYY
 *   value_date: string|null,      // Value/posting date if distinct, else null
 *   raw_description: string,      // Cleaned narration / transaction description text
 *   amount: number,               // Positive amount in rupees (2-decimal float or integer paise equivalent)
 *   direction: 'CREDIT'|'DEBIT',  // Direction of fund flow
 *   balance_after: number,        // Post-transaction running balance
 *   channel: string,              // Payment channel (UPI, NEFT, RTGS, IMPS, ATM, POS, CHEQUE, CHARGE, INTEREST, OTHER)
 *   ref_no: string|null,          // UTR, Cheque No, or Reference number if present
 *   source_page: number,          // Page number where transaction appears
 *   source_line_ids: number[],    // Line or row indices on page
 * }
 */

const VALID_DIRECTIONS = new Set(['CREDIT', 'DEBIT']);
const VALID_CHANNELS = new Set([
  'UPI',
  'NEFT',
  'RTGS',
  'IMPS',
  'ACH',
  'NACH',
  'ATM',
  'POS',
  'CARD',
  'CHEQUE',
  'CHARGE',
  'INTEREST',
  'TRANSFER',
  'CASH',
  'OTHER',
]);

/**
 * Infer primary channel from description and reference text
 */
function inferTransactionChannel(description = '', refNo = '') {
  const text = `${description} ${refNo}`.toUpperCase();

  if (/\bUPI\b|UPI\/|@(?:OK|AXIS|ICICI|HDFC|PAYTM|SBI|YBL|IBL|POSTBANK)\b/i.test(text)) {
    return 'UPI';
  }
  if (/\bNEFT\b/i.test(text)) return 'NEFT';
  if (/\bRTGS\b/i.test(text)) return 'RTGS';
  if (/\bIMPS\b/i.test(text)) return 'IMPS';
  if (/\b(?:NACH|ACH|ECS|AUTO\s*DEBIT|MANDATE)\b/i.test(text)) return 'NACH';
  if (/\b(?:ATM\s*WDL|ATM\s*CASH|ATM\b|NFS\b|MATM\b)/i.test(text)) return 'ATM';
  if (/\b(?:POS\b|ECOM\b|EDC\b|SWIPE|MERCHANT)/i.test(text)) return 'POS';
  if (/\b(?:DEBIT\s*CARD|CREDIT\s*CARD|CARD\s*PURCHASE)\b/i.test(text)) return 'CARD';
  if (/\b(?:CHQ|CHEQUE|INWARD\s*CLR|CLEARING)\b/i.test(text)) return 'CHEQUE';
  if (/\b(?:CHG|CHARGE|FEE|GST|PENALTY|COMMISSION|SERVICE\s*TAX)\b/i.test(text)) return 'CHARGE';
  if (/\b(?:INT\.PD|INT\s*PD|INTEREST|INT\b)/i.test(text)) return 'INTEREST';
  if (/\b(?:CASH\s*DEP|CASH\s*WDL|CWDR|CDTR|BY\s*CASH)\b/i.test(text)) return 'CASH';
  if (/\b(?:TRF|TRANSFER|INTERNAL\s*TRF|IB\b|MB\b)\b/i.test(text)) return 'TRANSFER';

  return 'OTHER';
}

/**
 * Validate that an object strictly complies with the canonical transaction schema
 */
function validateCanonicalTransaction(txn) {
  if (!txn || typeof txn !== 'object') {
    return { valid: false, reason: 'Transaction must be an object' };
  }

  if (typeof txn.txn_id !== 'string' || !txn.txn_id.trim()) {
    return { valid: false, reason: 'txn_id must be a non-empty string' };
  }

  if (typeof txn.date !== 'string' || !txn.date.trim()) {
    return { valid: false, reason: 'date must be a non-empty string' };
  }

  if (typeof txn.raw_description !== 'string') {
    return { valid: false, reason: 'raw_description must be a string' };
  }

  if (typeof txn.amount !== 'number' || Number.isNaN(txn.amount) || txn.amount < 0) {
    return { valid: false, reason: `amount must be a non-negative number, got ${txn.amount}` };
  }

  if (!VALID_DIRECTIONS.has(txn.direction)) {
    return { valid: false, reason: `direction must be 'CREDIT' or 'DEBIT', got ${txn.direction}` };
  }

  if (typeof txn.balance_after !== 'number' || Number.isNaN(txn.balance_after)) {
    return { valid: false, reason: `balance_after must be a valid number, got ${txn.balance_after}` };
  }

  return { valid: true };
}

/**
 * Factory to create a properly typed canonical transaction object
 */
function createCanonicalTransaction({
  txn_id,
  date,
  value_date = null,
  raw_description = '',
  amount = 0,
  direction = 'DEBIT',
  balance_after = 0,
  channel = null,
  ref_no = null,
  source_page = 1,
  source_line_ids = [],
}) {
  const normAmount = Math.round((Number(amount) || 0) * 100) / 100;
  const normBalance = Math.round((Number(balance_after) || 0) * 100) / 100;
  const normDirection = direction === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  const inferredChannel = channel && VALID_CHANNELS.has(channel)
    ? channel
    : inferTransactionChannel(raw_description, ref_no);

  const txn = {
    txn_id: String(txn_id),
    date: String(date || '').trim(),
    value_date: value_date ? String(value_date).trim() : null,
    raw_description: String(raw_description || '').trim(),
    amount: normAmount,
    direction: normDirection,
    balance_after: normBalance,
    channel: inferredChannel,
    ref_no: ref_no ? String(ref_no).trim() : null,
    source_page: Number(source_page) || 1,
    source_line_ids: Array.isArray(source_line_ids) ? source_line_ids : [Number(source_line_ids) || 0],
  };

  const validation = validateCanonicalTransaction(txn);
  if (!validation.valid) {
    throw new Error(`Invalid Canonical Transaction: ${validation.reason}`);
  }

  return txn;
}

module.exports = {
  VALID_DIRECTIONS,
  VALID_CHANNELS,
  inferTransactionChannel,
  validateCanonicalTransaction,
  createCanonicalTransaction,
};

