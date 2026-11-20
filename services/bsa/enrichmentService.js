'use strict';

/**
 * Forensic Narration Parsing and Channel Extraction Service
 *
 * Capabilities:
 * 1. UPI:
 *    - Extract VPA (Virtual Payment Address), RRN (12-digit Retrieval Reference Number)
 *    - Transaction timestamp / time token
 *    - Mode classification: P2P (Person to Person) vs P2M (Person to Merchant)
 * 2. NEFT / RTGS:
 *    - Extract UTR (16 to 22 alphanumeric chars, e.g., N123456789012345, PUNBR52025...)
 *    - Identify sender and beneficiary banks by IFSC prefix or names
 * 3. IMPS:
 *    - Mode classification: P2A (Person to Account) vs P2P (Person to Person via MMID/Mobile)
 *    - RRN extraction
 * 4. Loan Disbursements & Counterparty Extraction:
 *    - Identify known loan disbursal keywords and NBFC / fintech tags
 */

// Popular merchants / aggregators for P2M detection
const P2M_VPA_HANDLES = new Set([
  'RAZORPAY',
  'PAYTM',
  'PHONEPE',
  'BHARATPE',
  'BILLDESK',
  'CCAVENUE',
  'CASHFREE',
  'PAYU',
  'ZOMATO',
  'SWIGGY',
  'AMAZON',
  'FLIPKART',
  'AIRTEL',
  'JIO',
  'TATAPOWER',
  'BESCOM',
  'MSEDCL',
  'IRCTC',
  'MAKEMYTRIP',
  'UBER',
  'OLA',
  'APOLLO',
  'NETMEDS',
  'BIGBASKET',
  'BLINKIT',
  'ZEPTO',
  'CRED',
  'GROWW',
  'ZERODHA',
  'KREDITBEE',
  'NAVI',
  'BAJAJ',
]);

const P2M_KEYWORDS_REGEX = /\b(?:PVT\s*LTD|LTD\b|STORE|MART|RETAIL|SHOP|ENTERPRISES|TRADERS|COMMUNICATION|PHARMACY|HOSPITAL|RESTAURANT|HOTEL|SUPERMARKET|PETROL|FUEL|STATION|SWEETS|BAKERY|CAFE|SERVICES|SOLUTIONS)\b/i;

const LOAN_DISBURSAL_REGEX = /\b(?:DISB|DISBURSAL|DISBURSEMENT|LOAN\s*DISB|PERSONAL\s*LOAN|PL\s*DISB|BL\s*DISB|TERM\s*LOAN|SANCTION|FINANCE|CAPITAL|LENDING|KREDITBEE|NAVI|MONEYVIEW|CASHE|FIBE|EARLYSALARY|BAJAJ\s*FIN|TATA\s*CAP|IDFC\s*FIRST|FULLERTON|PIRAMAL|MUTHOOT|MANAPPURAM)\b/i;

/**
 * Parse UPI Narration tokens
 * Examples:
 * - UPI/423412345678/PAY TO MERCHANT/shop@paytm/HDFC0001234/14:30:15
 * - UPI-423412345678-RAJESH KUMAR-rajesh@okaxis-Payment
 */
function parseUpiNarration(narration = '') {
  const text = String(narration || '').trim();
  if (!/UPI/i.test(text)) return null;

  // 1. Extract 12-digit RRN
  const rrnMatch = text.match(/\b(\d{12})\b/) || text.match(/UPI[\/-](\d{12})/i);
  const rrn = rrnMatch ? rrnMatch[1] : null;

  // 2. Extract VPA (e.g., user@okhdfcbank, merchant.paytm@paytm)
  const vpaMatch = text.match(/([a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32})/);
  const vpa = vpaMatch ? vpaMatch[1].toLowerCase() : null;

  // 3. Extract Time (HH:MM or HH:MM:SS)
  const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  const time = timeMatch ? timeMatch[0] : null;

  // 4. Classify P2P vs P2M
  let mode = 'P2P';
  if (vpa) {
    const handle = vpa.split('@')[1] || '';
    const userPart = vpa.split('@')[0] || '';
    const upperHandle = handle.toUpperCase();
    const upperUser = userPart.toUpperCase();

    if (
      P2M_VPA_HANDLES.has(upperHandle) ||
      [...P2M_VPA_HANDLES].some((m) => upperUser.includes(m)) ||
      P2M_KEYWORDS_REGEX.test(text)
    ) {
      mode = 'P2M';
    }
  } else if (P2M_KEYWORDS_REGEX.test(text) || /\b(?:MERCHANT|BILL|PAYMENT\s*TO\s*STORE)\b/i.test(text)) {
    mode = 'P2M';
  }

  return {
    channel: 'UPI',
    rrn,
    vpa,
    time,
    mode, // 'P2P' | 'P2M'
  };
}

/**
 * Parse NEFT / RTGS narration tokens
 * Examples:
 * - NEFT-N123456789012345-HDFC0000001-JOHN DOE-ACME SUPPLIERS
 * - RTGS/PUNBR52025111112345678/STATE BANK OF INDIA/REFUND
 */
function parseNeftRtgsNarration(narration = '') {
  const text = String(narration || '').trim();
  const isNeft = /\bNEFT\b/i.test(text);
  const isRtgs = /\bRTGS\b/i.test(text);

  if (!isNeft && !isRtgs) return null;

  const channel = isRtgs ? 'RTGS' : 'NEFT';

  // Extract UTR: typically 16 or 22 characters alphanumeric
  // NEFT standard: N + 15 alphanumeric (or 16-22 chars)
  // RTGS standard: 4 char bank code + R + 17 alphanumeric
  const utrMatch =
    text.match(/\b([A-Z]{4}[RC][\d]{16,18})\b/i) ||
    text.match(/\b(N[A-Z0-9]{15,21})\b/i) ||
    text.match(/(?:NEFT|RTGS)[\/-]([A-Z0-9]{12,24})/i);
  const utr = utrMatch ? utrMatch[1].toUpperCase() : null;

  // Extract IFSC code if present
  const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i);
  const counterpartyBankIfsc = ifscMatch ? ifscMatch[1].toUpperCase() : null;

  return {
    channel,
    utr,
    counterpartyBankIfsc,
    isLoanDisbursal: LOAN_DISBURSAL_REGEX.test(text),
  };
}

/**
 * Parse IMPS narration tokens
 * Examples:
 * - IMPS/P2A/423412345678/STATE BANK/JOHN DOE
 * - IMPS-P2P-423412345678-9876543210-9001001
 */
function parseImpsNarration(narration = '') {
  const text = String(narration || '').trim();
  if (!/\bIMPS\b/i.test(text)) return null;

  const rrnMatch = text.match(/\b(\d{12})\b/) || text.match(/IMPS[\/-](\d{12})/i);
  const rrn = rrnMatch ? rrnMatch[1] : null;

  const isP2A = /\bP2A\b/i.test(text) || /\bA\/C\b/i.test(text);
  const isP2P = /\bP2P\b/i.test(text) || /\bMMID\b/i.test(text);
  const mode = isP2A ? 'P2A' : (isP2P ? 'P2P' : 'P2A');

  return {
    channel: 'IMPS',
    rrn,
    mode, // 'P2A' (Person to Account) | 'P2P' (Person to Person via MMID/Mobile)
    isLoanDisbursal: LOAN_DISBURSAL_REGEX.test(text),
  };
}

/**
 * Comprehensive narration enrichment
 */
function enrichNarration(rawDescription = '', refNo = null) {
  const text = `${rawDescription} ${refNo || ''}`.trim();

  const upi = parseUpiNarration(text);
  if (upi) {
    return {
      channel: 'UPI',
      ref_no: refNo || upi.rrn,
      upi,
      counterpartyVpa: upi.vpa,
      channelMode: upi.mode,
      isLoanDisbursal: LOAN_DISBURSAL_REGEX.test(text),
    };
  }

  const neftRtgs = parseNeftRtgsNarration(text);
  if (neftRtgs) {
    return {
      channel: neftRtgs.channel,
      ref_no: refNo || neftRtgs.utr,
      utr: neftRtgs.utr,
      counterpartyBankIfsc: neftRtgs.counterpartyBankIfsc,
      channelMode: 'BANK_TRANSFER',
      isLoanDisbursal: neftRtgs.isLoanDisbursal,
    };
  }

  const imps = parseImpsNarration(text);
  if (imps) {
    return {
      channel: 'IMPS',
      ref_no: refNo || imps.rrn,
      rrn: imps.rrn,
      channelMode: imps.mode,
      isLoanDisbursal: imps.isLoanDisbursal,
    };
  }

  // Check generic loan disbursal keywords
  const isLoan = LOAN_DISBURSAL_REGEX.test(text);

  return {
    channel: 'OTHER',
    ref_no: refNo,
    channelMode: null,
    isLoanDisbursal: isLoan,
  };
}

module.exports = {
  P2M_VPA_HANDLES,
  parseUpiNarration,
  parseNeftRtgsNarration,
  parseImpsNarration,
  enrichNarration,
};

