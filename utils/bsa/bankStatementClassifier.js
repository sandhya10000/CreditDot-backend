/**
 * utils/bankStatementClassifier.js
 *
 * Pipeline Phase 3: Transaction Categorisation, Narration Cleaning, Counterparty Extraction,
 * Internal/Sweep/FD Movement Detection, Subset Holder Name Matching (Trait 14), and Bounce/Return Detection
 *
 * DESIGN PRINCIPLE:
 * Deterministic categorization based on payment mode, transaction type,
 * entity patterns, and counterparty identification, with batched Claude fallback for "Other".
 * No hardcoded customer names, banks, VPAs, amounts, or dates.
 */

const { getClaudeClient, getClaudeModel } = require('./bankStatementExtractor');

// Expanded Category Taxonomy (Step 2)
const CATEGORIES = [
  'UPI P2P',
  'UPI P2M',
  'Utilities & bills',
  'Insurance/pension',
  'Investment',
  'Credit card payment',
  'Loan/EMI',
  'Government benefit/subsidy',
  'ATM cash',
  'Cheque clearing',
  'Sweep/FD (internal)',
  'Rent',
  'Education',
  'Healthcare',
  'Food delivery',
  'Travel/transport',
  'Subscriptions',
  'Bank charges',
  'Interest',
  'Refund/reversal',
  'Own-account transfer',
  'Cash',
  'Other',
];

// Common 4-letter Indian bank codes and UPI handle tokens to strip from counterparty names
const BANK_CODE_RE = /^(?:SBIN|HDFC|ICIC|UTIB|BARB|PUNB|IOBA|UBIN|CNRB|BKID|IDFB|KKBK|FDRL|YESB|INDB|AUBL|PSIB|MAHB|CBIN|UCBA|KARB|KVBL|SIBL|TMBL|RATN|DCBL|COSB|AIRP|PYTM|JIOP|FINO|NSDL|ESFB|USFB|JSFB|SURY|NESF|BDBL|IDIB)\d*$/i;

// Month tokens and bank/branch boilerplate that must never be used as a counterparty name
const MONTH_TOKEN_RE = /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)$/i;

const BANK_BRANCH_BOILERPLATE_RE = /^(?:BRANCH|BRN|IFSC|MICR|HEAD\s*OFFICE|MAIN\s*BRANCH|BANK|INDIA|SAVINGS|CURRENT|ACCOUNT|ACCT|CLEARING|CLG|INWARD|OUTWARD|TRANSFER|PAYMENT|TRANSACTION|PARTICULARS|NARRATION|DESCRIPTION|REMARKS|DETAILS|CHQ|CHEQUE|REF|UTR|NO|NUMBER|VALUE|DATE|BALANCE|DEBIT|CREDIT|WITHDRAWAL|DEPOSIT|SERVICE|CENTRAL|REGIONAL|ZONAL|CORPORATE|RETAIL|OPERATIONS|PROCESSING|CENTRE|CENTER|DEPT|DEPARTMENT)$/i;

const ADDRESS_STOP_WORDS_RE = /^(?:S\/O|D\/O|W\/O|C\/O|H\s*NO|HNO|FLAT|FLOOR|PLOT|SECTOR|COLONY|NAGAR|VIHAR|ENCLAVE|ROAD|RD|STREET|ST|LANE|MARG|NEAR|OPP|OPPOSITE|BEHIND|BESIDE|TEHSIL|TALUKA|DIST|DISTRICT|STATE|PIN|PINCODE|INDIA|BHARAT|VILLAGE|VPO|POST|PO|PS|WARD|BLOCK|PHASE|APARTMENT|APT|SOCIETY|COMPLEX|TOWER|BUILDING|BLDG|HOUSE|CHOWK|BAZAR|BAZAAR|MARKET|GUNJ|GANJ|PUR|PURA|BAD|ABAD|GARH|KHAND|PRADESH)$/i;

const NOISE_SEGMENTS_RE = /^(?:UPI|NEFT|RTGS|IMPS|MMT|MOB|MBK|MB|INB|IB|ACH|NACH|ECS|MANDATE|AUTOPAY|POS|ATM|ECOM|TRANSFER|TO\s*TRANSFER|BY\s*TRANSFER|TRTR|TFR|CR|DR|NA|N\/A|NIL|NULL|PAYMENT|PAY|FROM|TO|PAID\s*VIA|COLLECT|SENT|RECEIVED|TXN|REF|UTR|NO|CHQ|PAID|SELF|BY|FOR|REMARKS|PARTICULARS|BIL|BILLS|IFT|INT|CMS|CLG|BY\s*CLG|TO\s*CLG|CTS|BRN|COLL|UPIAR|UPICR|UPIDR|UPIAB|PA|UP|PAYM|PAYME|PAGE|USER\s*ID|ENTRY\s*USER|VERIFIED\s*USER)\b/i;

/**
 * Clean and normalize narration text:
 * - Strip standalone "Transfer" / "TO TRANSFER" / "BY TRANSFER" column labels
 * - Strip table column headers that leak into multi-line narrations
 * - Strip trailing standalone reference numbers or truncated column text
 * - Collapse whitespace
 */
function cleanNarration(narration) {
  if (!narration) return '';
  let s = String(narration)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip table column headers and PDF artifacts that leak into multi-line narrations
  s = s.replace(/\b(?:GL\.?\s*Value\s*Date|Transaction\s*Debit\s*Amount|Credit\s*Amount|Balance\s*Entry|User\s*Id|Verified\s*User\s*Id|Customer\s*Account\s*Ledger|Page\s*\d+\s*of\s*\d+|Page\s*Total|Page\s*\d+|Date\s+Date\s+Number\s+Debit\s+Amount|Debit\s*Amount|Credit\s*Amount|Amount\s*Amount|User\s*Id)\b/gi, ' ');

  s = s.replace(/^(?:TO\s+TRANSFER|BY\s+TRANSFER|TRANSFER)\s*[-:/]?\s*/i, '');
  s = s.replace(/\s+(?:Transfer|TRANSFER|Chq\s*Paid|Chq\/Ref\.?\s*No\.?)\s*$/i, '');
  s = s.replace(/\s+\d{9,18}\s*$/, '');

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Extract transaction reference numbers (UTR / RRN / IMPS / NEFT / UPI ref) from narration
 * Used to detect opposite-direction shared-reference pairs (Trait 13: reversals, cancellations, refunds, returns, or internal self-transfers).
 */
function extractReferenceIds(narration) {
  if (!narration) return [];
  const s = String(narration).toUpperCase();
  const refs = new Set();

  // 10 to 14 digit UPI / IMPS / NEFT reference numbers
  const rrnMatches = s.match(/\b\d{10,14}\b/g) || [];
  for (const r of rrnMatches) {
    // Avoid 10-digit Indian mobile numbers starting with 6-9 when followed by @
    const idx = s.indexOf(r);
    if (r.length === 10 && /^[6-9]/.test(r) && s[idx + 10] === '@') continue;
    refs.add(r);
  }

  // NEFT / RTGS / IMPS alphanumeric UTRs (e.g., SBIN12345678901, HDFC0001234567)
  const utrMatches = s.match(/\b[A-Z]{4}[A-Z0-9]\d{8,16}\b/g) || [];
  for (const u of utrMatches) refs.add(u);

  return Array.from(refs);
}

/**
 * Detect Payment Mode strictly from the narration prefix and tokens
 * (UPI, IMPS, NEFT, RTGS, ACH/NACH, CHQ, CARD, INT, charges) — never from header text.
 */
function detectMode(narration) {
  const n = (narration || '').toUpperCase().trim();
  // 1. Check narration prefix first
  if (/^(?:REV[\-\s]*)?UPI(?:CR|DR|AR|AB)?\b/i.test(n)) return 'UPI';
  if (/^(?:REV[\-\s]*)?NEFT\b/i.test(n)) return 'NEFT';
  if (/^(?:REV[\-\s]*)?RTGS\b/i.test(n)) return 'RTGS';
  if (/^(?:REV[\-\s]*)?(?:IMPS|MMT)\b/i.test(n)) return 'IMPS';
  if (/^(?:ACH|NACH|ECS|MANDATE|SI\b|APY[\-\s]*SI|MF[\-\s]*OTM)\b/i.test(n)) return 'MANDATE';
  if (/^(?:CHQ|CHEQUE|BY\s*CLG|TO\s*CLG|INW\s*CLG|OUT\s*CLG|CLG|CTS)\b/i.test(n)) return 'CHEQUE';
  if (/^(?:POS|ECOM|CARD|VDC)\b/i.test(n)) return 'CARD';
  if (/^(?:INT\.?\s*PD|INT\b|INTEREST)\b/i.test(n)) return 'INTEREST';
  if (/^(?:CHRG|CHRGS|CHARGES?|AMB\s*CHRG|SMS\s*CHRG)\b/i.test(n)) return 'CHARGES';

  // 2. Check narration tokens
  if (/\bUPI\b|REV[\-\s]*UPI/i.test(n)) return 'UPI';
  if (/\bNEFT\b/.test(n)) return 'NEFT';
  if (/\bRTGS\b/.test(n)) return 'RTGS';
  if (/\bIMPS\b|\bMMT\b/.test(n)) return 'IMPS';
  if (/\bACH\b|\bNACH\b|\bECS\b|\bMANDATE\b|\bAUTOPAY\b|\bMF[\-\s]*OTM\b|\bAPY[\-\s]*SI\b|\bSI[\-\s/]/i.test(n)) return 'MANDATE';
  if (/\bBY\s*CLG\b|\bTO\s*CLG\b|\bINW\s*CLG\b|\bOUT\s*CLG\b|\bCHQ\b|\bCHEQUE\b|\bCTS\b|\bCLG\b/.test(n)) return 'CHEQUE';
  if (/\bPOS\b|\bECOM\b|\bCARD\b|\bVDC\b/.test(n)) return 'CARD';
  if (/\bINT\b|\bINTEREST\b|INT\.PD/i.test(n)) return 'INTEREST';
  if ((/\b(?:CHRGS?|AMB\s*CHRG|PENAL\s*CHRG|RETURN\s*CHRG|BOUNCE\s*CHRG|SMS\s*CHRG|CONSOLIDATED\s*CHARGES)\b|CHRG\s*[:\-]/i.test(n)) && !/\bRECHARGE\b/i.test(n)) {
    return 'CHARGES';
  }
  if (/\bATM\b|\bATW\b|\bATD\b|\bCWDR\b|\bNFS\b/.test(n)) return 'ATM';
  if (/\bCASH\b|\bCSH\b|\bCDM\b/.test(n)) return 'CASH';
  if (/\bMB\s*[:\/\-]|\bIB\s*[:\/\-]|\bINB\b|\bMBK\b|\bNETBANKING\b/i.test(n)) return 'NETBANKING';
  return 'TRANSFER';
}

function cleanCounterpartyName(name) {
  if (!name || typeof name !== 'string') return 'Unknown';

  let cleaned = name.trim();

  // Strip generic payment rails and channel markers
  cleaned = cleaned.replace(/^(UPI|IMPS|NEFT|RTGS|ACH|POS|ATM|INB|MB|NACH|BILLDESK|CC)\s*[-/:]?\s*/i, '');

  // Strip trailing noise words like AMOUNT RETUR, RETURN, RECD, etc.
  cleaned = cleaned.replace(/\s+(?:AMOUNT\s*RETUR(?:N)?|RETUR(?:N)?|RECD|PAYMENT\s*FROM|CREDIT\s*CARD\s*AMOUNT)\b.*$/i, '');

  // Strip trailing/leading noise words / header fragments (case-insensitive)
  const noiseTokens = [
    '\\bPA\\b', '\\bUP\\b', '\\bCR\\b', '\\bDR\\b', '\\bPAYM\\b', '\\bPAGE\\b',
    '\\bDATE\\b', '\\bCHQ\\b', '\\bREF\\b', '\\bBAL\\b', '\\bBALANCE\\b',
    '\\bPARTICULARS\\b', '\\bWITHDRAWAL\\b', '\\bDEPOSIT\\b', '\\bTRANS\\b',
    '\\bRECD\\b', '\\bRETUR\\b'
  ];

  for (const token of noiseTokens) {
    cleaned = cleaned.replace(new RegExp(`(\\s*[-/]?\\s*${token}\\s*)+$`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`^(${token}\\s*[-/]?\\s*)+`, 'gi'), '');
  }

  // Strip trailing numbers, hashes, or transaction IDs
  cleaned = cleaned.replace(/[\s\-_/]+(XX\w+|\d{6,}|\d+\/\d+|\d+)$/i, '');

  cleaned = cleaned.trim();
  return cleaned.length > 2 ? cleaned : (name.trim() || 'General Counterparty');
}

function normalizeCounterpartyName(raw) {
  if (!raw) return null;
  let s = String(raw).toUpperCase().trim();

  if (s.includes('@')) {
    s = s.split('@')[0];
  }

  s = s.replace(/[_/\\|]+/g, ' ');

  s = s
    .replace(/\b(?:TRANSFER|TO\s+TRANSFER|BY\s+TRANSFER|PAYMENT\s+FROM|PAYMENT\s+TO|PAID\s+VIA|COLLECT|UPI|NEFT|IMPS|RTGS|ACH|NACH|ECS|POS|ATM|BY\s+CLG|TO\s+CLG|CLG|MB|IB|CR|DR|REF|NO|UTR|TXN|CHQ|HEAD\s+OFFICE|MAIN\s+BRANCH)\b/gi, ' ')
    .replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, ' ')
    .replace(/\b[A-Z]{2,6}\d{6,18}\b/g, ' ')
    .replace(/\b\d{6,20}\b/g, ' ')
    .replace(/[-.:,;*#()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = s.split(' ').filter((tok) => {
    if (!tok) return false;
    if (NOISE_SEGMENTS_RE.test(tok)) return false;
    if (BANK_CODE_RE.test(tok)) return false;
    if (MONTH_TOKEN_RE.test(tok)) return false;
    if (BANK_BRANCH_BOILERPLATE_RE.test(tok)) return false;
    if (/^\d+$/.test(tok)) return false;
    if (/^[A-Z]+\d+[A-Z0-9]*$/.test(tok) && /\d{4,}/.test(tok)) return false;
    return true;
  });

  while (tokens.length > 1 && tokens[tokens.length - 1].length === 1) {
    tokens.pop();
  }

  let cleaned = tokens.join(' ').trim();
  if (cleaned.length >= 2) {
    cleaned = cleanCounterpartyName(cleaned);
  }
  if (cleaned.length >= 2 && /[A-Z]{2,}/.test(cleaned)) return cleaned;
  return null;
}

function formatFallbackCounterparty(narration, mode) {
  const refs = extractReferenceIds(narration);
  const ch = mode && mode !== 'TRANSFER' ? mode : 'TRANSFER';
  if (refs.length > 0) {
    return `${ch} (Ref: ${refs[0]})`;
  }
  return ch;
}

function extractCounterparty(narration) {
  const n = cleanNarration(narration);
  if (!n) return null;
  const upper = n.toUpperCase();
  const mode = detectMode(upper);

  if (mode === 'INTEREST' || /\bINT\.?PD\b|\bINTEREST\b/i.test(upper)) {
    return 'BANK INTEREST';
  }
  if (mode === 'ATM' || /\bATM\b|\bATW\b|\bCWDR\b|\bNFS\b/i.test(upper)) {
    return 'ATM CASH';
  }
  if (mode === 'CASH' || /\bCASH\s*(?:DEP|WDL|WITHDRAWAL|DEPOSIT)\b|\bCSH\b|\bCDM\b/i.test(upper)) {
    return 'CASH DEPOSIT / WITHDRAWAL';
  }
  if (mode === 'CHEQUE') {
    const chqPayee = n.match(/(?:BY\s*CLG|TO\s*CLG|CHQ|CHEQUE|CLG|CTS)[^A-Za-z]*([A-Za-z][A-Za-z\s.&]{2,35})/i);
    if (chqPayee) {
      const norm = normalizeCounterpartyName(chqPayee[1]);
      if (norm) return norm;
    }
    return 'CHEQUE CLEARING';
  }
  if (mode === 'CARD') {
    const posMatch = n.match(/(?:POS|ECOM|CARD)\s*(?:[\dX*]+\s*)?[-/:\s]*([A-Za-z][A-Za-z0-9\s.&]{2,35})/i);
    if (posMatch) {
      const norm = normalizeCounterpartyName(posMatch[1]);
      if (norm) return norm;
    }
    return 'CARD / POS MERCHANT';
  }

  // MB: / IB: mobile/internet banking transfer prefix (e.g. "MB:RECEIVED FROM <NAME>", "MB:TRF TO <NAME>")
  const mbRecdMatch = n.match(/^(?:MB|IB|INB)\s*[:\/\-]\s*(?:RECEIVED\s*FROM|TRF\s*(?:FROM|TO)|TRANSFER\s*(?:FROM|TO))\s*([A-Za-z][A-Za-z0-9\s.&]{2,35})/i);
  if (mbRecdMatch) {
    const clean = normalizeCounterpartyName(mbRecdMatch[1].replace(/\/.*$/, ''));
    if (clean) return clean;
  }
  const mbIbMatch = n.match(/^(?:MB|IB|INB)\s*[:\/\-]\s*(?:TRF\s*(?:TO|FROM)?\s*)?([A-Za-z][A-Za-z0-9\s.&]{2,35})/i);
  if (mbIbMatch) {
    const norm = normalizeCounterpartyName(mbIbMatch[1]);
    if (norm) return norm;
  }

  // Recd:IMPS/<REF>/<NAME>/...
  const recdImpsMatch = n.match(/^Recd\s*:\s*IMPS\s*\/\s*[\w\d]+\s*\/\s*([A-Za-z][A-Za-z0-9\s.&]{2,35})/i);
  if (recdImpsMatch) {
    const clean = normalizeCounterpartyName(recdImpsMatch[1].replace(/\/.*$/, ''));
    if (clean) return clean;
  }

  if (n.includes('/')) {
    const rawParts = n.split('/').map((p) => p.trim()).filter((p) => p && p.length > 2);

    if (mode === 'UPI' || rawParts.some((p) => /^UPI(?:CR|DR|AR|AB)?$/i.test(p))) {
      const candidates = [];
      for (let i = 0; i < rawParts.length; i++) {
        const seg = rawParts[i];
        if (seg.length <= 2) continue;
        const segUpper = seg.toUpperCase();
        if (NOISE_SEGMENTS_RE.test(segUpper)) continue;
        if (BANK_CODE_RE.test(segUpper)) continue;
        if (/^\d+$/.test(seg) && !/^[6-9]\d{9}$/.test(seg)) continue;
        if (/^\d{2}:\d{2}:\d{2}$/.test(seg)) continue;
        if (/^(?:PAYMENT|PAY|SENT|RECEIVED|COLLECT|TRANSFER|REMARKS|UPI|NA|OTHERS)\b/i.test(segUpper)) continue;
        if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(segUpper)) continue;

        if (seg.includes('@')) {
          const vpaPrefix = seg.split('@')[0].trim();
          const normVpa = normalizeCounterpartyName(vpaPrefix);
          if (normVpa && normVpa.length > 2) candidates.push({ name: normVpa, priority: 1 });
          continue;
        }

        const norm = normalizeCounterpartyName(seg);
        if (norm && norm.length > 2) {
          const hasLetters = /[A-Z]{2,}/.test(norm);
          candidates.push({ name: norm, priority: hasLetters ? 2 : 4 });
        }
      }
      candidates.sort((a, b) => a.priority - b.priority);
      if (candidates.length > 0) return candidates[0].name;
    }

    const candidates = [];
    for (const seg of rawParts) {
      if (seg.length <= 2) continue;
      const segUpper = seg.toUpperCase();
      if (NOISE_SEGMENTS_RE.test(segUpper)) continue;
      if (BANK_CODE_RE.test(segUpper)) continue;
      if (/^\d+$/.test(seg) && !/^[6-9]\d{9}$/.test(seg)) continue;
      if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(segUpper)) continue;
      if (/^[A-Z]{2,6}\d{6,18}$/i.test(segUpper)) continue;

      if (seg.includes('@')) {
        const vpaPrefix = seg.split('@')[0].trim();
        const normVpa = normalizeCounterpartyName(vpaPrefix);
        if (normVpa && normVpa.length > 2) return normVpa;
      }

      const norm = normalizeCounterpartyName(seg);
      if (norm && norm.length > 2 && /[A-Z]{2,}/.test(norm)) {
        candidates.push(norm);
      }
    }
    if (candidates.length > 0) return candidates[0];
  }

  if (n.includes('-')) {
    const dashParts = n.split('-').map((p) => p.trim()).filter(Boolean);
    if (dashParts.length >= 2 && /^(?:UPI|NEFT|RTGS|IMPS|ACH|NACH|ECS|MANDATE|MB|IB)/i.test(dashParts[0])) {
      for (let i = 1; i < dashParts.length; i++) {
        const seg = dashParts[i];
        const segUpper = seg.toUpperCase();
        if (NOISE_SEGMENTS_RE.test(segUpper)) continue;
        if (BANK_CODE_RE.test(segUpper)) continue;
        if (/^\d+$/.test(seg)) continue;
        if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(segUpper)) continue;
        if (/^[A-Z]{2,6}\d{6,18}$/i.test(segUpper)) continue;
        if (seg.includes('@')) continue;
        const norm = normalizeCounterpartyName(seg);
        if (norm && /[A-Z]{2,}/.test(norm)) return norm;
      }
    }
  }

  const vpaMatch = n.match(/([A-Za-z0-9._-]+)@[A-Za-z0-9_-]+/);
  if (vpaMatch) {
    const norm = normalizeCounterpartyName(vpaMatch[1]);
    if (norm) return norm;
  }

  const finalNorm = normalizeCounterpartyName(n);
  if (finalNorm) return finalNorm;
  return formatFallbackCounterparty(n, mode);
}

function extractMobileNumber(narration, counterparty) {
  const combined = `${counterparty || ''} ${narration || ''}`;
  const vpaMob = combined.match(/\b([6-9]\d{9})(?:[-._]\d+)?@[A-Za-z0-9_-]+/);
  if (vpaMob) return vpaMob[1];
  const standaloneMob = combined.match(/(?:^|[\/\-\s:])([6-9]\d{9})(?:$|[\/\-\s:@])/);
  if (standaloneMob) return standaloneMob[1];
  return null;
}

// Sweep / FD internal movement regex (Step 2: "Sweep Transfer To/From", "FD PREMAT PROCEEDS", "FD booking", "TD")
const SWEEP_OR_FD_INTERNAL_RE = /\b(?:SWEEP\s*(?:TRF|TRANSFER)(?:\s*FROM|\s*TO)?|AUTO\s*SWEEP|MOD\s*(?:TRF|BAL|REDEMPTION|CREATION)|FD\s*(?:PREMAT(?:URE)?\s*PROCEEDS|BOOKING|CLOSURE|MATURITY|PROCEEDS|OPEN(?:ING)?|REDEMPTION|LIQUIDATION|BREAK|TRF)|FIXED\s*DEPOSIT|TD\s*(?:PREMAT|PROCEEDS|CLOSURE|MATURITY|BOOKING|OPEN)|RD\s*(?:MATURITY|CLOSURE|PROCEEDS|INSTALLMENT))\b/i;

// Explicit refund / cancellation / reversal wording (Trait 13 & Step 2: "OrderCanc", "refund", "Return from", "REV-UPI", "REVERSAL")
const REFUND_MERCHANT_OR_WORDING_RE = /\b(?:ORDER\s*CANC(?:ELLED)?|ORDERCANC|REFUND|REVERSAL|REV[\-\s]*UPI|REV[\-\s]*IMPS|REV[\-\s]*NEFT|RETURN\s*FROM|REV\b|CASHBACK|CHARGEBACK|FAILED\s*TXN|CANCELLED|CRV|RFD|GPAYONLINEPAREFUNDS)\b/i;

/**
 * Trait 14: Account holder name may be a short or truncated form in the header while counterparties show a longer form.
 * - High-confidence match (exact full multi-token match, explicit SELF wording, or shared reference pair without refund wording)
 *   -> confirmed internal own-account transfer (excluded from income).
 * - Subset match (where short/truncated holder tokens are a proper subset of longer counterparty tokens, or single-token match without ref/account confirmation)
 *   -> "possible own account/related" (`isPossibleOwnAccountRelated: true`, separate lower-confidence label, NOT excluded blindly from income!).
 */
function evaluateHolderMatchAndInternalMovement(narration, counterparty, accountHolderName, sharedRefIds = new Set(), isExactReversalPair = false) {
  const nUpper = (narration || '').toUpperCase();
  const cpUpper = (counterparty || '').toUpperCase();

  // 1. Sweep / FD / TD internal movements -> Category: 'Sweep/FD (internal)'
  if (/\bSWEEP\s*(?:TRF|TRANSFER)|\bAUTO\s*SWEEP|\bMOD\s*(?:TRF|REDEMPTION|CREATION)/i.test(nUpper)) {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: true,
      kind: 'Sweep transfer (From/To linked deposit)',
      isPossibleOwnAccountRelated: false,
    };
  }
  if (/\bFD\s*PREMAT(?:URE)?\s*PROCEEDS|\bTD\s*PREMAT/i.test(nUpper)) {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: true,
      kind: 'FD premature proceeds (internal deposit movement)',
      isPossibleOwnAccountRelated: false,
    };
  }
  if (/\bFD\s*(?:BOOKING|OPEN(?:ING)?)|\bFIXED\s*DEPOSIT\s*(?:BOOKING|OPEN)|\bTD\s*(?:BOOKING|OPEN)/i.test(nUpper)) {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: true,
      kind: 'FD booking (internal deposit movement)',
      isPossibleOwnAccountRelated: false,
    };
  }
  if (SWEEP_OR_FD_INTERNAL_RE.test(nUpper)) {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: true,
      kind: 'Internal FD / TD deposit movement',
      isPossibleOwnAccountRelated: false,
    };
  }

  // 2. Exact Reversal Pair: a debit and a credit with the same transaction reference and equal amount (paise)
  if (isExactReversalPair) {
    return {
      isHighConfidenceInternal: false,
      isSweepOrFd: false,
      isSharedReferenceReversal: true,
      isExactReversalPair: true,
      kind: 'Reversal pair (same reference & equal amount)',
      isPossibleOwnAccountRelated: false,
    };
  }

  // 2b. Shared reference ID across opposite-direction rows (Trait 13)
  const refs = extractReferenceIds(narration);
  const hasSharedRef = sharedRefIds && sharedRefIds.size > 0 && refs.some((r) => sharedRefIds.has(r));

  if (hasSharedRef && REFUND_MERCHANT_OR_WORDING_RE.test(nUpper)) {
    return {
      isHighConfidenceInternal: false,
      isSweepOrFd: false,
      isSharedReferenceReversal: true,
      kind: 'Same-reference reversal / refund pair',
      isPossibleOwnAccountRelated: false,
    };
  }

  if (hasSharedRef) {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: false,
      kind: 'Same-reference debit/credit pair (internal movement)',
      isPossibleOwnAccountRelated: false,
    };
  }

  // 3. Explicit self-transfer wording
  if (/\bSELF\s*TRANSFER\b|\bTO\s+SELF\b|\bBY\s+SELF\b|\bOWN\s*A\/?C\b/i.test(nUpper) || cpUpper === 'SELF') {
    return {
      isHighConfidenceInternal: true,
      isSweepOrFd: false,
      kind: 'Own-account transfer (explicit self)',
      isPossibleOwnAccountRelated: false,
    };
  }

  // 4. Own-account detection: must work for single-token holder names as well as multi-token names,
  // and must never match on address words.
  if (accountHolderName) {
    const cleanedHolder = String(accountHolderName)
      .toUpperCase()
      .replace(/\b(?:MR|MRS|MS|DR|SHRI|SMT|M\/S|ACCOUNT|HOLDER|CUSTOMER|NOT|MENTIONED|SPECIFIED)\b\.?/g, ' ')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .trim();

    const holderTokens = cleanedHolder
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !ADDRESS_STOP_WORDS_RE.test(t) && !MONTH_TOKEN_RE.test(t) && !BANK_BRANCH_BOILERPLATE_RE.test(t));

    // Ignore fallback counterparty strings like "NEFT (REF: ...)" when comparing holder tokens
    const isFallbackCp = /\(REF:/i.test(cpUpper) || /^(?:UPI|NEFT|RTGS|IMPS|TRANSFER|MANDATE|CHEQUE|CARD|INTEREST|CHARGES)$/i.test(cpUpper);
    const cpTokens = isFallbackCp
      ? []
      : cpUpper
          .replace(/[^A-Z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 2 && !ADDRESS_STOP_WORDS_RE.test(t) && !MONTH_TOKEN_RE.test(t) && !BANK_BRANCH_BOILERPLATE_RE.test(t));

    if (holderTokens.length > 0 && cpTokens.length > 0) {
      const cpTokenSet = new Set(cpTokens);
      const matchedTokens = holderTokens.filter(
        (ht) => cpTokenSet.has(ht) || (ht.length >= 4 && cpTokens.some((ct) => ct.startsWith(ht)))
      );
      const allHolderTokensMatched = matchedTokens.length === holderTokens.length;

      // Single-token holder name: match when the counterparty field equals the holder's name token(s)
      if (holderTokens.length === 1 && allHolderTokensMatched && cpTokens.length === 1 && cpTokens[0] === holderTokens[0]) {
        return {
          isHighConfidenceInternal: true,
          isSweepOrFd: false,
          kind: 'Own-account transfer (holder name match)',
          isPossibleOwnAccountRelated: false,
        };
      }

      // Multi-token holder name: exact token match or all holder tokens present in counterparty
      if (allHolderTokensMatched && holderTokens.length >= 2) {
        return {
          isHighConfidenceInternal: true,
          isSweepOrFd: false,
          kind: cpTokens.length === holderTokens.length
            ? 'Own-account transfer (exact holder name match)'
            : 'Own-account transfer (holder name match)',
          isPossibleOwnAccountRelated: false,
        };
      }

      // Subset match: at least 2 tokens matched when holder name has multiple tokens
      if (holderTokens.length >= 2 && matchedTokens.length >= 2) {
        return {
          isHighConfidenceInternal: false,
          isSweepOrFd: false,
          kind: null,
          isPossibleOwnAccountRelated: true,
          possibleOwnAccountReason: `Possible own account / related party (holder tokens "${holderTokens.join(' ')}" subset of "${cpTokens.join(' ')}")`,
        };
      }
    }
  }

  return {
    isHighConfidenceInternal: false,
    isSweepOrFd: false,
    kind: null,
    isPossibleOwnAccountRelated: false,
  };
}

function getInternalMovementKind(narration, counterparty, accountHolderName, sharedRefIds = new Set()) {
  const res = evaluateHolderMatchAndInternalMovement(narration, counterparty, accountHolderName, sharedRefIds);
  return res.isHighConfidenceInternal ? res.kind : null;
}

function isOwnAccount(narration, counterparty, accountHolderName, sharedRefIds = new Set()) {
  return Boolean(getInternalMovementKind(narration, counterparty, accountHolderName, sharedRefIds));
}

// Rule 9: Bounce / Return / Mandate failure detection
const BOUNCE_RETURN_RE = /\b(?:ECS\s*(?:RET(?:URN)?|BOUNCE|FAIL|DISHON)|NACH\s*(?:RET(?:URN)?|BOUNCE|FAIL|DISHON)|ACH\s*(?:RET(?:URN)?|BOUNCE|FAIL|DISHON)|MANDATE\s*(?:FAIL(?:ED|URE)?|RET(?:URN)?|REJECT(?:ED)?)|SI\s*(?:FAIL(?:ED)?|RET(?:URN)?)|CH(?:E?Q(?:UE)?)?\s*(?:RET(?:URN)?|BOUNCE|DISHON(?:OUR)?)|INWARD\s*CLG\s*RET|OUTWARD\s*CLG\s*RET|EMI\s*(?:BOUNCE|RET(?:URN)?|FAIL)|INSUFFICIENT\s*FUNDS)\b|CHRG\s*[:\-][^\n]*\bRETURN\b/i;

function detectBounceEvent(narration, counterparty, debit, credit) {
  const n = cleanNarration(narration);
  if (!BOUNCE_RETURN_RE.test(n)) return null;
  const upper = n.toUpperCase();
  const isCharge = /\b(?:CHRG|CHARGE|FEE|PENAL)\b/i.test(upper);
  let bounceType = 'Mandate / Payment Return';
  if (/NACH|ACH/i.test(upper)) bounceType = 'NACH / ACH Return';
  else if (/ECS/i.test(upper)) bounceType = 'ECS Return';
  else if (/CHQ|CHEQUE|CLG/i.test(upper)) bounceType = 'Cheque Return';
  else if (/MANDATE|AUTOPAY|SI\b/i.test(upper)) bounceType = 'Mandate Failure / Return';

  let mandateOrReason = counterparty && !/^(?:BANK CHARGES|EXTERNAL PARTY|OTHER)$/i.test(counterparty)
    ? counterparty
    : n;
  const chrgMatch = n.match(/Chrg\s*[:\-]\s*(.+)$/i);
  if (chrgMatch) {
    mandateOrReason = chrgMatch[1].trim();
  }

  return {
    isBounce: true,
    bounceType,
    isBounceCharge: isCharge,
    chargeAmount: isCharge ? Math.max(debit || 0, credit || 0) : 0,
    amount: Math.max(debit || 0, credit || 0),
    mandate: mandateOrReason,
    narration: n,
  };
}

// Step 2 Category keyword patterns (generic rules, no hard-coding of sample names)

// Investment: "PURCHASE OF MUTUALFUND", SIP, NACH to an AMC or "MF-OTM", broking/clearing
const INVESTMENT_RE = /\b(?:PURCHASE\s*OF\s*MUTUAL\s*FUND|MUTUAL\s*FUND|MUTUALFUND|MF[\-\s]*OTM|MF\s*(?:PURCHASE|SIP|FOLIO|REDEMPTION|NAV)|SIP\b|SYSTEMATIC\s*INVESTMENT|INDIAN\s*CLEARING\s*CORP|ICCL\b|BSE\s*STAR\s*MF|NSE\s*MF|CAMS\b|KFINTECH|MFU\b|ZERODHA|GROWW|UPSTOX|ANGEL\s*ONE|ANGEL\s*BROKING|5PAISA|KUVERA|COIN\s*BY\s*ZERODHA|ETMONEY|PAYTM\s*MONEY|INDMONEY|AMC\b|SBI\s*MF|HDFC\s*MF|ICICI\s*PRUDENTIAL\s*MF|NIPPON\s*INDIA\s*MF|AXIS\s*MF|KOTAK\s*MF|ADITYA\s*BIRLA\s*SUN\s*LIFE\s*MF|UTI\s*MF|MIRAE\s*ASSET|PARAG\s*PARIKH|PPFAS|QUANT\s*MF|MOTILAL\s*OSWAL|DSP\s*MF|TATA\s*MF|BANDHAN\s*MF|EDELWEISS\s*MF|FRANKLIN\s*TEMPLETON|SUNDARAM\s*MF|INVESCO\s*MF|CANARA\s*ROBECO|HSBC\s*MF)\b/i;

// Credit card payment: "credit card amount return", "CC payment", card bill payments (CRED, bank card names)
const CREDIT_CARD_PAYMENT_RE = /\b(?:CRED\b|CRED\s*CLUB|DREAMPLUG|CREDIT\s*CARD\s*(?:BILL|PAYMENT|PMT|DUES|AMOUNT\s*RETURN)|CC\s*(?:BILL|PAYMENT|PMT|DUES)|CARD\s*BILL\s*(?:PAYMENT|PMT)?|BILLDESK\s*(?:CC|CARD)|SBICARD|SBI\s*CARD|HDFC\s*CARD|ICICI\s*CARD|AXIS\s*CARD|KOTAK\s*CARD|AMEX\s*(?:BILL|CARD)|RBL\s*CARD|INDUSIND\s*CARD|ONE\s*CARD|ONECARD|AU\s*CC)\b/i;

const CREDIT_CARD_INFLOW_RE = /\b(?:CREDIT\s*CARD(?:\s*AMOUNT\s*RETURN)?|CC\s*(?:AMT|AMOUNT|RETURN|REFUND|TRF|TRANSFER|PAYMENT)|CARD\s*(?:AMT|AMOUNT|RETURN|TRF|TRANSFER)|CRED\b|CRED\s*CLUB|DREAMPLUG|SBICARD|SBI\s*CARD|ONECARD)\b/i;

// Government benefit / subsidy: LPG/DBT subsidies, PFMS, APBS, PM KISAN, etc.
const GOVT_SUBSIDY_RE = /\b(?:DBT\b|DBTL\b|LPG\s*SUBSIDY|PAHAL\b|PFMS\b|APBS\b|PM\s*KISAN|GOVT\s*SUBSIDY|SUBSIDY\s*CR|AADHAAR\s*PAYMENT\s*BRIDGE|NREGA|MGNREGA|SCHOLARSHIP\s*DBT)\b/i;

// Insurance / pension: "APY-SI", "PMSBY", "PMJJBY", LIC renewals
const INSURANCE_PENSION_RE = /\b(?:APY[\-\s]*SI|INSURANCE|INSUR|POLICY|PREMIUM|PMSBY|PMJJBY|APY\b|ATAL\s*PENSION|NPS|PENSION|EPFO|PF\b|LIC\b|LIC\s*RENEWAL|LIFE\s*INSURANCE|HDFC\s*LIFE|SBI\s*LIFE|ICICI\s*PRU|MAX\s*LIFE|BAJAJ\s*ALLIANZ|KOTAK\s*LIFE|TATA\s*AIA|BIRLA\s*SUN\s*LIFE|PNB\s*METLIFE|STAR\s*HEALTH|CARE\s*HEALTH|NIVA\s*BUPA|HDFC\s*ERGO|ICICI\s*LOMBARD|NEW\s*INDIA\s*ASSURANCE|UNITED\s*INDIA|ORIENTAL\s*INSURANCE|NATIONAL\s*INSURANCE|ACKO|DIGIT\s*INSURANCE|POLICYBAZAAR)\b/i;

// Rent (narration containing rent)
const RENT_RE = /\b(?:HOUSE\s*RENT|HOME\s*RENT|FLAT\s*RENT|ROOM\s*RENT|OFFICE\s*RENT|SHOP\s*RENT|RENT\s*(?:FOR|PAID|PAYMENT|MONTH)|NOBROKER\s*RENT|CRED\s*RENT|RENTAL)\b|\bRENT\b/i;

// Education
const EDUCATION_RE = /\b(?:SCHOOL\s*FEE|COLLEGE\s*FEE|TUITION\s*FEE|UNIVERSITY|ACADEMY|INSTITUTE\s*OF|EDUCATION|EDTECH|BYJUS|UNACADEMY|PHYSICSWALLAH|VEDANTU|UPGRAD|COURSERA|UDEMY|COACHING|HOSTEL\s*FEE|EXAM\s*FEE)\b/i;

// Healthcare (pharmacy/medical keywords)
const HEALTHCARE_RE = /\b(?:PHARMACY|MEDICAL|MEDICINE|MEDPLUS|APOLLO\s*(?:PHARMACY|HOSPITAL|CLINIC)|NETMEDS|PHARMEASY|TATA\s*1MG|1MG\b|HOSPITAL|CLINIC|NURSING\s*HOME|DIAGNOSTICS|PATHLABS|DR\s*LAL|METROPOLIS|THYROCARE|CHEMIST|DRUGGIST|DENTAL|EYECARE|HEALTHCARE)\b/i;

// Food delivery
const FOOD_DELIVERY_RE = /\b(?:ZOMATO|SWIGGY|EATSURE|DOMINOS|PIZZA\s*HUT|KFC|MCDONALDS|BURGER\s*KING|SUBWAY|STARBUCKS|BOX8|FAASOS|BEHROUZ|FRESHMENU|MAGICPIN\s*FOOD)\b/i;

// Travel / transport
const TRAVEL_TRANSPORT_RE = /\b(?:IRCTC|RAILWAY|UBER|OLA\b|RAPIDO|NAMMA\s*YATRI|BLUSMART|RED\s*BUS|REDBUS|ABHIBUS|MAKEMYTRIP|GOIBIBO|YATRA|CLEARTRAVEL|CLEARTRIP|EASEMYTRIP|IXIGO|INDIGO|AIR\s*INDIA|VISTARA|SPICEJET|AKASA\s*AIR|METRO\s*RAIL|DMRC|BMTC|MSRCTC|KSRTC|UPSRTC|TOLL\s*PLAZA)\b/i;

// Subscriptions
const SUBSCRIPTIONS_RE = /\b(?:NETFLIX|SPOTIFY|AMAZON\s*PRIME|PRIME\s*VIDEO|DISNEY\s*HOTSTAR|HOTSTAR|JIO\s*CINEMA|SONYLIV|ZEE5|YOUTUBE\s*PREMIUM|GOOGLE\s*ONE|APPLE\s*(?:SERVICES|MUSIC|ICLOUD)|MICROSOFT\s*365|ADOBE|CANVA|CHATGPT|OPENAI|SUBSCRIPTION)\b/i;

// Utilities & bills (recharges, electricity, broadband, water, gas, fastag)
const UTILITIES_BILLS_RE = /\b(?:RECHARGE|PREPAID|POSTPAID|DTH|TATASKY|TATA\s*PLAY|DISH\s*TV|SUN\s*DIRECT|AIRTEL|JIO|RELIANCE\s*JIO|VODAFONE|VI\s*INDIA|BSNL|MTNL|ACT\s*FIBERNET|HATHWAY|TIKONA|BROADBAND|WIFI|INTERNET|ELECTRICITY|POWER|DISCOM|BESCOM|MSEDCL|TSSPDCL|TSNPDCL|APSPDCL|TANGEDCO|TNEB|KSEB|UPPCL|DHBVN|UHBVN|PSPCL|WBSEDCL|CESC|TORRENT\s*POWER|ADANI\s*ELECTRICITY|TATA\s*POWER|BSES|NDPL|WATER\s*BOARD|BWSSB|DJB|HMWSSB|GAS|INDANE|BHARAT\s*GAS|HP\s*GAS|MAHANAGAR\s*GAS|IGL|ADANI\s*GAS|GUJARAT\s*GAS|LPG|CYLINDER|BBPS|BILL\s*PAY|BILLPAY|UTILITY|MUNICIPAL|PROPERTY\s*TAX|FASTAG|NETC)\b/i;

// Loan/EMI (gold loan, home loan, personal/vehicle loan, lender/NBFC/SFB, EMI/mandate wording)
const LENDER_LOAN_EMI_RE = /\b(?:HOME\s*LOAN|GOLD\s*LOAN|PERSONAL\s*LOAN|CAR\s*LOAN|AUTO\s*LOAN|VEHICLE\s*LOAN|HOUSING\s*LOAN|EDUCATION\s*LOAN|BUSINESS\s*LOAN|MORTGAGE|LAP\b|EMI\b|LOAN|LENDING|LENDER|NBFC|FINANCE|FINCORP|FINTECH|MICROFINANCE|MFI|SFB|SMALL\s*FINANCE|BAJAJ\s*FINANCE|BAJAJ\s*FINSERV|HDB\s*FINANCIAL|HDBFS|HOME\s*CREDIT|MUTHOOT|MANAPPURAM|CHOLAMANDALAM|TATA\s*CAPITAL|IDFC\s*FIRST|TVS\s*CREDIT|L&T\s*FINANCE|MAHINDRA\s*FINANCE|SHRIRAM\s*FINANCE|ADITYA\s*BIRLA\s*FINANCE|POONAWALLA|FULLERTON|SMFG|HERO\s*FINCORP|IIFL|PIRAMAL|INDIABULLS|LIC\s*HOUSING|PNB\s*HOUSING|AAVAS|APTUS|CAN\s*FIN\s*HOMES|REPCO\s*HOME|HOME\s*FIRST|KREDITBEE|NAVI\b|KISSHT|RING\b|MONEYVIEW|PAYSENSE|CASHE|EARLYSALARY|FIBE\b|LAZYPAY|SIMPL\b|SLICE\b|UNI\s*CARD|MPOCKKET|STASHFIN|TRUE\s*BALANCE|DHANI|ZESTMONEY|CRED\s*MINT|CRED\s*CASH|PREFR|LENDINGKART|INDIFI|KINARA|AVANSE|CREDILA|AUXILO|PROPELLD|ACH\s*DR|NACH\s*DR|ECS\s*DR|MANDATE|AUTOPAY)\b/i;

// Bank charges: "CHRGS", "Chrg:", "AMB CHRG", SMS alert, debit card fee, GST on charges, return charges
const REAL_BANK_CHARGES_RE = /\b(?:CHRGS?|AMB\s*CHRG|MIN(?:IMUM)?\s*BAL(?:ANCE)?\s*CHRG|MAB\s*CHRG|SMS\s*(?:ALERT\s*)?(?:CHRG|FEE|CHARGES?)|DEBIT\s*CARD\s*(?:ANNUAL\s*)?(?:FEE|CHRG|CHARGES?)|ATM\s*(?:CHRG|FEE)|ISSUANCE\s*(?:FEE|CHRG)|FOLIO\s*CHRG|PENAL\s*CHRG|BOUNCE\s*CHRG|RETURN\s*CHRG|NACH\s*RET\s*CHRG|ECS\s*RET\s*CHRG|IMPS\s*CHRG|NEFT\s*CHRG|CONSOLIDATED\s*CHARGES|SERVICE\s*CHARGE|GST\s*(?:ON\s*CHRG|@\s*18%|CHRG)|CGST|SGST|IGST)\b|CHRG\s*[:\-]/i;

const INTEREST_RE = /\b(?:INTEREST|INT\.?\s*PD|INT\.?\s*PAID|INT\.?\s*COLL|SB\s*INT|SAVINGS\s*INT|CREDIT\s*INTEREST|QUARTERLY\s*INTEREST|OD\s*INT|OVERDRAFT\s*INT)\b/i;

const MERCHANT_P2M_RE = /\b(?:BLINKIT|ZEPTO|INSTAMART|BIGBASKET|DUNZO|CAFE|RESTAURANT|HOTEL|BAKERY|SWEETS|FOOD|AMAZON|FLIPKART|MYNTRA|AJIO|MEESHO|NYKAA|TATA\s*CLIQ|SNAPDEAL|FIRSTCRY|DECATHLON|DMART|AVENUE\s*SUPERMARTS|RELIANCE\s*SMART|RELIANCE\s*FRESH|RELIANCE\s*RETAIL|MORE\s*RETAIL|SPENCERS|VISHAL\s*MEGA|LULU|SUPERMARKET|GROCERY|KIRANA|MART|STORES|TRADERS|ENTERPRISES|PETROL|FUEL|INDIAN\s*OIL|IOCL|BPCL|HPCL|SHELL|NAYARA|FILLING\s*STATION|PAYTMQR|BHARATPE|PHONEPE\s*MERCHANT|GPAY\s*MERCHANT|GOOGLEPAY\s*MERCHANT|PINELABS|MSWIPE|RAZORPAY|RZP|CASHFREE|PAYU|CCAVENUE|JUSTDIAL|URBAN\s*COMPANY|BOOKMYSHOW|PVR|INOX|SALON|SPA|GYM|CULTFIT|APPARELS|TEXTILES|FOOTWEAR|BATA|OPTICALS|LENSKART|JEWELLERS|WATCHES|ELECTRONICS|CROMA|VIJAY\s*SALES|MKT|MERCHANT|VYAPAR|DUKAAN|SHOP|RETAIL|BHANDAR|DAIRY|AMUL|MOTHER\s*DAIRY|HALDIRAM|BIKANERVALA)\b/i;

/**
 * Rule-based classifier mapping narration to category taxonomy
 */
function classifyTransactionRule(t, accountHolderName, sharedRefIds, isExactReversalPair = false) {
  const cleanedNarr = cleanNarration(t.narration);
  const n = cleanedNarr.toUpperCase();
  const cp = extractCounterparty(cleanedNarr);
  const mode = detectMode(cleanedNarr);

  // 1. Evaluate internal movement & holder name match (Trait 14 & Step 2)
  const holderEval = evaluateHolderMatchAndInternalMovement(
    cleanedNarr,
    cp,
    accountHolderName,
    sharedRefIds,
    isExactReversalPair
  );

  if (holderEval.isHighConfidenceInternal) {
    const cat = holderEval.isSweepOrFd ? 'Sweep/FD (internal)' : 'Own-account transfer';
    return {
      category: cat,
      counterparty: cp || (accountHolderName ? accountHolderName.toUpperCase() : 'SELF / INTERNAL'),
      mode,
      confidence: 0.97,
      isInternalMovement: true,
      internalMovementKind: holderEval.kind,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0 ? holderEval.kind : null,
      exclusionBucket: t.credit > 0 ? 'ownAccountCredits' : null,
    };
  }

  // Reversal pairing (same transaction reference and equal amount in paise) or shared-ref reversal
  if (holderEval.isSharedReferenceReversal) {
    const isExactPair = Boolean(holderEval.isExactReversalPair);
    return {
      category: t.credit > 0 ? 'Refund/reversal' : 'Other',
      counterparty: cp || 'REVERSAL / REFUND',
      mode,
      confidence: 0.97,
      isSharedReferenceReversal: true,
      isReversalPair: isExactPair,
      isInternalMovement: isExactPair,
      internalMovementKind: isExactPair ? holderEval.kind : null,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0
        ? (isExactPair ? 'Reversal credit (matched debit reference & amount)' : 'Shared-reference transaction reversal / refund')
        : null,
      exclusionBucket: t.credit > 0 ? 'reversalCredits' : null,
    };
  }

  const possibleOwnProps = holderEval.isPossibleOwnAccountRelated
    ? {
        isPossibleOwnAccountRelated: true,
        possibleOwnAccountReason: holderEval.possibleOwnAccountReason,
      }
    : {};

  // 2. Step 2: Micro amounts under ₹10 (including ₹0.01 and ₹2.00 verification credits/debits)
  const amt = Math.max(t.credit || 0, t.debit || 0);
  const isMicroAmount = amt > 0 && amt < 10;

  // 3. Explicit Bounce / Return charges ("ECS Return", "NACH return", "cheque return" charges, "Chrg: ... Return")
  const bounceInfo = detectBounceEvent(cleanedNarr, cp, t.debit, t.credit);
  if (bounceInfo && t.debit > 0) {
    return {
      category: 'Bank charges',
      counterparty: cp || 'BANK CHARGES',
      mode,
      confidence: 0.98,
      bounceInfo,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 4. Credit card payment & card-related credits ("credit card amount return", "CC payment", CRED, bank card names)
  if (CREDIT_CARD_PAYMENT_RE.test(n) || (t.credit > 0 && CREDIT_CARD_INFLOW_RE.test(n))) {
    const isCardCredit = t.credit > 0;
    const hasExplicitRefundWord = REFUND_MERCHANT_OR_WORDING_RE.test(n) || /\bRETURN\b/i.test(n);
    const isNeftRtgsImps = mode === 'NEFT' || mode === 'RTGS' || mode === 'IMPS';
    // NEFT/RTGS/IMPS credits are external transfers by default unless they have explicit refund/reversal wording
    if (isCardCredit && isNeftRtgsImps && !hasExplicitRefundWord) {
      return {
        category: 'Other',
        counterparty: cp || formatFallbackCounterparty(cleanedNarr, mode),
        mode,
        confidence: 0.85,
        isMicroAmount,
        isExcludedCredit: false,
        exclusionReason: null,
        ...possibleOwnProps,
      };
    }
    return {
      category: isCardCredit ? 'Refund/reversal' : 'Credit card payment',
      counterparty: cp || 'CREDIT CARD',
      mode,
      confidence: 0.93,
      isCreditCardRelated: true,
      isMicroAmount,
      isExcludedCredit: isCardCredit,
      exclusionReason: isCardCredit ? 'Credit card amount return / refund' : null,
      exclusionBucket: isCardCredit ? 'refundCredits' : null,
      ...possibleOwnProps,
    };
  }

  // 5. Investment ("PURCHASE OF MUTUALFUND", SIP, NACH to AMC, "MF-OTM") — exact match on narration n only
  if (INVESTMENT_RE.test(n)) {
    return {
      category: 'Investment',
      counterparty: cp || 'MUTUAL FUND / AMC',
      mode,
      confidence: 0.93,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 6. Government benefit / subsidy (LPG/DBT subsidies, PFMS, APBS) — exact match on narration n only
  if (GOVT_SUBSIDY_RE.test(n)) {
    return {
      category: 'Government benefit/subsidy',
      counterparty: cp || 'GOVT SUBSIDY / DBT',
      mode,
      confidence: 0.94,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 7. Refund / reversal:
  // Rule: NEFT/RTGS/IMPS credits are external transfers by default; they become "Refund/reversal"
  // ONLY when the narration has reversal/refund keywords or they match a prior debit by identical reference & amount.
  // Merchant refunds via IMPS/UPI are included in refunds when narration has refund/reversal wording or is a UPI/CARD merchant credit.
  const hasExplicitReversalWord = /\b(?:REVERSAL|REV[\-\s]*UPI|REV[\-\s]*IMPS|REV[\-\s]*NEFT|FAILED\s*TXN|CHARGEBACK|CRV)\b/i.test(n);
  const hasExplicitRefundWord = REFUND_MERCHANT_OR_WORDING_RE.test(n);
  const isNeftRtgsImps = mode === 'NEFT' || mode === 'RTGS' || mode === 'IMPS';
  const isMerchantCreditOnUpiOrCard =
    t.credit > 0 &&
    !isNeftRtgsImps &&
    (MERCHANT_P2M_RE.test(n) || FOOD_DELIVERY_RE.test(n) || TRAVEL_TRANSPORT_RE.test(n) || UTILITIES_BILLS_RE.test(n));

  if (hasExplicitRefundWord || isMerchantCreditOnUpiOrCard) {
    const bucket = hasExplicitReversalWord ? 'reversalCredits' : 'refundCredits';
    return {
      category: 'Refund/reversal',
      counterparty: cp || 'MERCHANT REFUND',
      mode,
      confidence: 0.95,
      bounceInfo: bounceInfo || null,
      isMicroAmount,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0
        ? (hasExplicitReversalWord ? 'Transaction reversal credit' : 'Merchant / transaction refund credit')
        : null,
      exclusionBucket: t.credit > 0 ? bucket : null,
      ...possibleOwnProps,
    };
  }

  // 8. Interest ("Int.Pd", interest)
  if (mode === 'INTEREST' || INTEREST_RE.test(n)) {
    return {
      category: 'Interest',
      counterparty: 'BANK INTEREST',
      mode: 'INTEREST',
      confidence: 0.99,
      isMicroAmount,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0 ? 'Bank interest credit' : null,
      exclusionBucket: t.credit > 0 ? 'interestCredits' : null,
      ...possibleOwnProps,
    };
  }

  // 9. Insurance / pension ("APY-SI", "PMSBY", "PMJJBY", LIC renewals) — exact match on narration n only
  if (INSURANCE_PENSION_RE.test(n)) {
    return {
      category: 'Insurance/pension',
      counterparty: cp || 'INSURANCE / PENSION',
      mode,
      confidence: 0.92,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 10. Specific consumer/obligation categories (exact match on row's own narration n only!)
  if (RENT_RE.test(n) && !/\b(?:DIFFERENT|CURRENT|PARENT|TORRENT)\b/i.test(n)) {
    return {
      category: 'Rent',
      counterparty: cp || 'RENT PAYEE',
      mode,
      confidence: 0.90,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }
  if (EDUCATION_RE.test(n)) {
    return {
      category: 'Education',
      counterparty: cp || 'EDUCATION / INSTITUTION',
      mode,
      confidence: 0.90,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }
  if (HEALTHCARE_RE.test(n)) {
    return {
      category: 'Healthcare',
      counterparty: cp || 'PHARMACY / HEALTHCARE',
      mode,
      confidence: 0.91,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }
  if (FOOD_DELIVERY_RE.test(n)) {
    return {
      category: 'Food delivery',
      counterparty: cp || 'FOOD DELIVERY',
      mode,
      confidence: 0.92,
      isMicroAmount,
      isExcludedCredit: t.credit > 0 && !isNeftRtgsImps,
      exclusionReason: t.credit > 0 && !isNeftRtgsImps ? 'Food delivery refund' : null,
      exclusionBucket: t.credit > 0 && !isNeftRtgsImps ? 'refundCredits' : null,
      ...possibleOwnProps,
    };
  }
  if (TRAVEL_TRANSPORT_RE.test(n)) {
    return {
      category: 'Travel/transport',
      counterparty: cp || 'TRAVEL / TRANSPORT',
      mode,
      confidence: 0.91,
      isMicroAmount,
      isExcludedCredit: t.credit > 0 && !isNeftRtgsImps,
      exclusionReason: t.credit > 0 && !isNeftRtgsImps ? 'Travel / ticket refund' : null,
      exclusionBucket: t.credit > 0 && !isNeftRtgsImps ? 'refundCredits' : null,
      ...possibleOwnProps,
    };
  }
  if (SUBSCRIPTIONS_RE.test(n)) {
    return {
      category: 'Subscriptions',
      counterparty: cp || 'SUBSCRIPTION SERVICE',
      mode,
      confidence: 0.91,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 11. Utilities & bills (including mobile recharges — before Bank charges so "RECHARGE" never matches "CHARGE")
  if (UTILITIES_BILLS_RE.test(n)) {
    return {
      category: 'Utilities & bills',
      counterparty: cp || 'UTILITY / RECHARGE',
      mode,
      confidence: 0.92,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 12. Bank charges ("CHRGS", "Chrg:", "AMB CHRG", SMS alert, debit card fee, GST on charges)
  if ((mode === 'CHARGES' || REAL_BANK_CHARGES_RE.test(n)) && !/\bRECHARGE\b/i.test(n)) {
    return {
      category: 'Bank charges',
      counterparty: 'BANK CHARGES',
      mode: 'CHARGES',
      confidence: 0.95,
      bounceInfo: bounceInfo || null,
      isMicroAmount,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0 ? 'Bank fee reversal' : null,
      exclusionBucket: t.credit > 0 ? 'reversalCredits' : null,
      ...possibleOwnProps,
    };
  }

  // 13. ATM cash vs Cash deposit/branch cash vs Cheque clearing (Step 2)
  if (mode === 'ATM' || /\b(?:ATM|ATW|CWDR|NFS\s*CASH)\b/i.test(n)) {
    return {
      category: 'ATM cash',
      counterparty: 'ATM CASH WITHDRAWAL',
      mode: 'ATM',
      confidence: 0.96,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }
  if (mode === 'CASH' || /\b(?:CSH\s*DEP|CASH\s*DEP|CASH\s*WDL|CDM|BY\s*CASH|TO\s*CASH)\b/i.test(n)) {
    return {
      category: 'Cash',
      counterparty: 'CASH DEPOSIT / WITHDRAWAL',
      mode: 'CASH',
      confidence: 0.95,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }
  if (mode === 'CHEQUE' || /\b(?:BY\s*CLG|TO\s*CLG|INW\s*CLG|OUT\s*CLG|CHQ|CHEQUE|CTS)\b/i.test(n)) {
    return {
      category: 'Cheque clearing',
      counterparty: cp || 'CHEQUE CLEARING',
      mode: 'CHEQUE',
      confidence: 0.94,
      bounceInfo: bounceInfo || null,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 14. Loan / EMI (gold loan, home loan, personal/vehicle loan, lender/NBFC/SFB, EMI/mandate wording)
  // Note: For credits, only mark as loan disbursement when explicitly loan/lender/disbursal or penny-drop preceded
  // (never mark generic NEFT/RTGS/IMPS credits as loan disbursements merely because the word "BANK" appears in narration).
  const isLoanOrLender = LENDER_LOAN_EMI_RE.test(n) || /loan\.\d+@/i.test(n);
  const isPennyDropDisbursal = t.credit >= 5000 && Boolean(t.isPrecededByPennyDrop);
  const isExplicitLoanDisbursalCredit =
    t.credit > 0 &&
    (isPennyDropDisbursal ||
      /\b(?:LOAN\s*DISB(?:URSAL|URSEMENT)?|DISBURSAL|DISBURSEMENT|GOLD\s*LOAN|PERSONAL\s*LOAN|HOME\s*LOAN|BUSINESS\s*LOAN|NBFC|FINCORP|MICROFINANCE|MFI|BAJAJ\s*FINANCE|HDB\s*FINANCIAL|MUTHOOT|MANAPPURAM|CHOLAMANDALAM|TATA\s*CAPITAL|SHRIRAM\s*FINANCE|POONAWALLA|FULLERTON|SMFG|HERO\s*FINCORP|IIFL|PIRAMAL|INDIABULLS|KREDITBEE|NAVI\b|MONEYVIEW|FIBE\b|LENDINGKART)\b/i.test(n));

  if ((t.debit > 0 && isLoanOrLender) || isExplicitLoanDisbursalCredit) {
    return {
      category: 'Loan/EMI',
      counterparty: cp || formatFallbackCounterparty(cleanedNarr, mode),
      mode,
      confidence: 0.92,
      isMicroAmount,
      isExcludedCredit: t.credit > 0,
      exclusionReason: t.credit > 0
        ? (isPennyDropDisbursal
            ? 'Loan disbursement (preceded by penny-drop verification)'
            : 'Loan disbursement from lender/NBFC')
        : null,
      exclusionBucket: t.credit > 0 ? 'loanDisbursementCredits' : null,
      ...possibleOwnProps,
    };
  }

  // 15. UPI P2M (merchants: retail, e-commerce, groceries, QR/POS merchants — exact match on row's own narration n only!)
  if (
    MERCHANT_P2M_RE.test(n) ||
    mode === 'CARD' ||
    /\b(?:PAYTMQR|BHARATPE|VYAPAR|MERCHANT|QR)\b/i.test(t.narration || '')
  ) {
    return {
      category: 'UPI P2M',
      counterparty: cp || formatFallbackCounterparty(cleanedNarr, mode === 'CARD' ? 'CARD' : 'UPI'),
      mode: mode === 'CARD' ? 'CARD' : 'UPI',
      confidence: 0.88,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 16. UPI P2P
  if (mode === 'UPI') {
    return {
      category: 'UPI P2P',
      counterparty: cp || formatFallbackCounterparty(cleanedNarr, 'UPI'),
      mode: 'UPI',
      confidence: 0.82,
      isMicroAmount,
      isExcludedCredit: false,
      exclusionReason: null,
      ...possibleOwnProps,
    };
  }

  // 17. Remaining non-UPI transfers (including external NEFT/RTGS/IMPS credits) default to Other (external transfer)
  return {
    category: 'Other',
    counterparty: cp || formatFallbackCounterparty(cleanedNarr, mode),
    mode,
    confidence: 0.50,
    isMicroAmount,
    isExcludedCredit: false,
    exclusionReason: null,
    ...possibleOwnProps,
  };
}

function unifyCounterparties(classifiedList) {
  const MERCHANT_CATEGORIES = new Set([
    'Food delivery',
    'UPI P2M',
    'Travel/transport',
    'Healthcare',
    'Utilities & bills',
    'Subscriptions',
    'Education',
    'Insurance/pension',
    'Investment',
  ]);
  const mobileToCanonicalName = new Map();
  const handlePrefixToCanonicalName = new Map();
  const nameCounts = new Map();

  for (const item of classifiedList) {
    // Do not register merchant category names into mobile/handle canonical maps so merchant names never overwrite P2P payees
    if (MERCHANT_CATEGORIES.has(item.category)) continue;
    const cp = item.counterparty || '';
    const mob = item.mobileNumber;
    const isFallbackCp = /\(REF:/i.test(cp) || /^(?:UPI|NEFT|RTGS|IMPS|TRANSFER|MANDATE|CHEQUE|CARD|INTEREST|CHARGES)$/i.test(cp);
    const isAlphabeticName = !isFallbackCp && /[A-Z]{3,}/.test(cp) && !/^(?:UPI|EXTERNAL|OTHER|MERCHANT|CASH|ATM|BANK|SELF)/.test(cp);

    if (isAlphabeticName) {
      nameCounts.set(cp, (nameCounts.get(cp) || 0) + 1);
      if (mob) {
        const existing = mobileToCanonicalName.get(mob);
        if (!existing || (nameCounts.get(cp) || 0) > (nameCounts.get(existing) || 0)) {
          mobileToCanonicalName.set(mob, cp);
        }
      }
    }

    const vpaMatch = (item.rawNarration || item.narration || '').match(/([A-Za-z0-9._-]+)@[A-Za-z0-9_-]+/);
    if (vpaMatch) {
      const basePrefix = vpaMatch[1].toUpperCase().replace(/[-_.]\d+$/, '');
      if (basePrefix.length >= 4 && isAlphabeticName) {
        handlePrefixToCanonicalName.set(basePrefix, cp);
      }
    }
  }

  for (const item of classifiedList) {
    // Merchant rows keep their own counterparty extracted from their own narration
    if (MERCHANT_CATEGORIES.has(item.category)) continue;
    let canonical = item.counterparty || formatFallbackCounterparty(item.narration, item.mode);
    const mob = item.mobileNumber;
    const rawNarr = item.rawNarration || item.narration || '';
    const vpaMatch = rawNarr.match(/([A-Za-z0-9._-]+)@[A-Za-z0-9_-]+/);
    const basePrefix = vpaMatch ? vpaMatch[1].toUpperCase().replace(/[-_.]\d+$/, '') : null;

    if (mob && mobileToCanonicalName.has(mob)) {
      canonical = mobileToCanonicalName.get(mob);
    } else if (basePrefix && handlePrefixToCanonicalName.has(basePrefix)) {
      canonical = handlePrefixToCanonicalName.get(basePrefix);
    }

    item.counterparty = canonical;
  }

  return classifiedList;
}

async function classifyLeftoversWithClaude(items) {
  const otherItems = items.filter((t) => t.category === 'Other');
  if (otherItems.length === 0) return;

  let client;
  try {
    client = getClaudeClient();
  } catch {
    return;
  }
  if (!client) return;

  const uniqueMap = new Map();
  for (const item of otherItems) {
    const key = `${item.credit > 0 ? 'CR' : 'DR'}|${item.narration.slice(0, 80)}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        id: uniqueMap.size + 1,
        type: item.credit > 0 ? 'CREDIT' : 'DEBIT',
        amount: item.credit > 0 ? item.credit : item.debit,
        narration: item.narration.slice(0, 100),
      });
    }
  }

  const batchList = Array.from(uniqueMap.values()).slice(0, 50);
  if (batchList.length === 0) return;

  try {
    const response = await client.messages.create({
      model: getClaudeModel(),
      max_tokens: 1500,
      tools: [
        {
          name: 'submit_categories',
          description: 'Classify bank statement transactions into the fixed category taxonomy.',
          input_schema: {
            type: 'object',
            properties: {
              classifications: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    category: {
                      type: 'string',
                      enum: CATEGORIES,
                    },
                  },
                  required: ['id', 'category'],
                },
              },
            },
            required: ['classifications'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_categories' },
      messages: [
        {
          role: 'user',
          content: `Classify each transaction below into one of the allowed categories (${CATEGORIES.join(', ')}). Note: Recharges are always "Utilities & bills", never "Bank charges". Mutual fund/SIP/AMC/MF-OTM debits are "Investment". CRED/card bills are "Credit card payment". Home/gold/personal loans are "Loan/EMI". Standing instructions for APY/PMSBY/PMJJBY/LIC are "Insurance/pension". LPG/DBT subsidies are "Government benefit/subsidy". Sweep/FD transfers are "Sweep/FD (internal)".\n\nTransactions:\n${JSON.stringify(batchList)}`,
        },
      ],
    });

    const toolBlock = (response.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_categories');
    const results = toolBlock?.input?.classifications;
    if (!Array.isArray(results)) return;

    const idToCategory = new Map();
    for (const r of results) {
      if (r && CATEGORIES.includes(r.category)) {
        idToCategory.set(r.id, r.category);
      }
    }

    const keyToCategory = new Map();
    for (const [key, entry] of uniqueMap.entries()) {
      if (idToCategory.has(entry.id)) {
        keyToCategory.set(key, idToCategory.get(entry.id));
      }
    }

    for (const item of otherItems) {
      const key = `${item.credit > 0 ? 'CR' : 'DR'}|${item.narration.slice(0, 80)}`;
      const newCat = keyToCategory.get(key);
      if (newCat && newCat !== 'Other') {
        item.category = newCat;
        if (item.credit > 0) {
          if (newCat === 'Own-account transfer' || newCat === 'Sweep/FD (internal)') {
            item.isInternalMovement = true;
            item.isExcludedCredit = true;
            item.exclusionReason = newCat;
            item.exclusionBucket = 'ownAccountCredits';
          } else if (newCat === 'Refund/reversal') {
            item.isExcludedCredit = true;
            item.exclusionReason = 'Transaction refund / reversal';
            item.exclusionBucket = 'refundCredits';
          } else if (newCat === 'Interest') {
            item.isExcludedCredit = true;
            item.exclusionReason = 'Bank interest credit';
            item.exclusionBucket = 'interestCredits';
          } else if (newCat === 'Loan/EMI') {
            item.isExcludedCredit = true;
            item.exclusionReason = 'Loan disbursement';
            item.exclusionBucket = 'loanDisbursementCredits';
          }
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }
}

async function classifyTransactions(transactions, accountHolderName, options = {}) {
  const txList = transactions || [];

  // 1. Identify any reference IDs that appear on BOTH a credit and a debit row (Trait 13)
  // AND detect exact reversal pairs: a debit and a credit with the same transaction reference and equal amount (paise).
  const creditRefs = new Set();
  const debitRefs = new Set();
  const debitRowsByRefAndPaise = new Map();
  const creditRowsByRefAndPaise = new Map();

  for (let i = 0; i < txList.length; i++) {
    const t = txList[i];
    const refs = extractReferenceIds(t.narration);
    const drPaise = t.debitPaise ?? Math.round((t.debit || 0) * 100);
    const crPaise = t.creditPaise ?? Math.round((t.credit || 0) * 100);
    if (crPaise > 0) {
      for (const r of refs) {
        creditRefs.add(r);
        const key = `${r}|${crPaise}`;
        if (!creditRowsByRefAndPaise.has(key)) creditRowsByRefAndPaise.set(key, []);
        creditRowsByRefAndPaise.get(key).push(i);
      }
    }
    if (drPaise > 0) {
      for (const r of refs) {
        debitRefs.add(r);
        const key = `${r}|${drPaise}`;
        if (!debitRowsByRefAndPaise.has(key)) debitRowsByRefAndPaise.set(key, []);
        debitRowsByRefAndPaise.get(key).push(i);
      }
    }
  }
  const sharedRefIds = new Set([...creditRefs].filter((r) => debitRefs.has(r)));
  const exactReversalPairIndexes = new Set();
  for (const [key, drIdxList] of debitRowsByRefAndPaise.entries()) {
    const crIdxList = creditRowsByRefAndPaise.get(key);
    if (crIdxList && crIdxList.length > 0) {
      drIdxList.forEach((idx) => exactReversalPairIndexes.add(idx));
      crIdxList.forEach((idx) => exactReversalPairIndexes.add(idx));
    }
  }

  // 2. Flag large credits (>= ₹5,000) preceded by a penny-drop (small verification credit ₹0.01..₹5 within prior rows)
  const pennyDropIndexes = new Set();
  for (let i = 0; i < txList.length; i++) {
    const t = txList[i];
    if (t.credit >= 5000 && /NEFT|IMPS|RTGS|TRANSFER|ACH|NACH/i.test(t.narration || '')) {
      for (let j = Math.max(0, i - 100); j < i; j++) {
        const prev = txList[j];
        if (prev.credit > 0 && prev.credit <= 5 && /penny|drop|imps|verify|test|sfb|finance|bank|lending|capital/i.test(prev.narration || '')) {
          pennyDropIndexes.add(i);
          break;
        }
      }
    }
  }

  // 3. Classify each transaction
  const classified = txList.map((t, idx) => {
    const rawNarration = t.narration || '';
    const cleanedNarr = cleanNarration(rawNarration);
    const debitPaise = t.debitPaise ?? Math.round((t.debit || 0) * 100);
    const creditPaise = t.creditPaise ?? Math.round((t.credit || 0) * 100);
    const balancePaise = t.balancePaise ?? Math.round((t.balance || 0) * 100);
    const isExactReversalPair = exactReversalPairIndexes.has(idx);

    const debit = t.debit ?? (debitPaise / 100);
    const credit = t.credit ?? (creditPaise / 100);
    const balance = t.balance ?? (balancePaise / 100);
    const enrichedT = {
      ...t,
      debit,
      credit,
      balance,
      debitPaise,
      creditPaise,
      balancePaise,
      narration: cleanedNarr,
      isPrecededByPennyDrop: pennyDropIndexes.has(idx),
    };
    const classification = classifyTransactionRule(
      enrichedT,
      accountHolderName,
      sharedRefIds,
      isExactReversalPair
    );
    const mobileNumber = extractMobileNumber(rawNarration, classification.counterparty);
    const bounceInfo = classification.bounceInfo || detectBounceEvent(cleanedNarr, classification.counterparty, t.debit, t.credit);
    const refs = extractReferenceIds(rawNarration);

    return {
      ...t,
      id: t.id || idx + 1,
      index: idx + 1,
      rawNarration,
      narration: cleanedNarr,
      debit,
      credit,
      balance,
      debitPaise,
      creditPaise,
      balancePaise,
      reference: refs[0] || null,
      channel: classification.mode,
      category: classification.category,
      counterparty: classification.counterparty || formatFallbackCounterparty(cleanedNarr, classification.mode),
      mobileNumber,
      mode: classification.mode,
      confidence: classification.confidence,
      isMicroAmount: Boolean(classification.isMicroAmount),
      isInternalMovement: Boolean(classification.isInternalMovement),
      internalMovementKind: classification.internalMovementKind || null,
      isSharedReferenceReversal: Boolean(classification.isSharedReferenceReversal),
      isReversalPair: Boolean(classification.isReversalPair),
      isPossibleOwnAccountRelated: Boolean(classification.isPossibleOwnAccountRelated),
      possibleOwnAccountReason: classification.possibleOwnAccountReason || null,
      isCreditCardRelated: Boolean(classification.isCreditCardRelated),
      bounceInfo: bounceInfo || null,
      isExcludedCredit: Boolean(classification.isExcludedCredit),
      exclusionReason: classification.exclusionReason || null,
      exclusionBucket: classification.exclusionBucket || null,
    };
  });

  // 4. Unify / merge counterparties by normalized name or mobile number across UPI handles & suffixes
  unifyCounterparties(classified);

  // 5. Optional batched Claude fallback for remaining "Other" rows
  if (options.useClaudeFallback) {
    await classifyLeftoversWithClaude(classified);
  }

  return classified;
}

module.exports = {
  CATEGORIES,
  cleanCounterpartyName,
  cleanNarration,
  detectMode,
  extractCounterparty,
  normalizeCounterpartyName,
  extractMobileNumber,
  extractReferenceIds,
  evaluateHolderMatchAndInternalMovement,
  getInternalMovementKind,
  isOwnAccount,
  detectBounceEvent,
  classifyTransactionRule,
  classifyTransactions,
};
