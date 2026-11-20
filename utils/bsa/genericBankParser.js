/**
 * utils/genericBankParser.js
 *
 * Universal, bank-agnostic statement parser for Indian bank statements.
 * - Layout-aware row reconstruction (Bug Class 1): Uses pdf.js text items with x/y coordinates,
 *   detects column x-boundaries from the table header row, anchors each row on its amount/balance
 *   line, and attaches multi-line particulars above AND below the anchor by y-proximity within
 *   the row's vertical band (solving vertically-centred date/amount cells where the first line
 *   of a multi-line narration has a higher y than the date/balance line).
 * - Narration sanity validation (Bug Class 2): Flags any row whose narration contains table-header
 *   or page-furniture tokens or two different transaction reference numbers, reducing confidence
 *   and recording flagged rows in unresolvedRows so the page is re-extracted via Claude.
 * - Strict account metadata & period parsing (Bug Class 3): Extracts holder name strictly from
 *   labelled holder fields (stopping at end of line or next label, never address text) and parses
 *   all common printed statement period formats (DD/MM/YYYY, DD-Mon-YYYY, ISO YYYY-MM-DD).
 * - All money arithmetic is performed in signed integer paise.
 */

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/**
 * Normalize date strings to DD-MM-YYYY.
 * Supports: dd-mm-yyyy, dd/mm/yyyy, dd Mon yyyy, dd-Mon-yy, yyyy-mm-dd.
 * Ignores a second value date in the same cell, e.g. "17-Aug-26 (17-Aug-26)".
 */
function normalizeDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/\s*\(\s*\d{1,4}[-\/\s][A-Za-z0-9]{1,9}[-\/\s]\d{1,4}\s*\).*$/, '').trim();
  s = s.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i, '').trim();

  // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3].length === 2 ? (parseInt(m[3], 10) > 60 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    const mmNum = parseInt(mm, 10);
    const ddNum = parseInt(dd, 10);
    if (mmNum < 1 || mmNum > 12 || ddNum < 1 || ddNum > 31) return null;
    return `${dd}-${mm}-${yyyy}`;
  }
  // DD-MMM-YYYY, DD MMM YYYY, DD-MMM-YY, DD/MMM/YYYY
  m = s.match(/^(\d{1,2})[-\/\s.,]+([A-Za-z]{3,9})[-\/\s.,]+(\d{2,4})$/);
  if (m && MONTH_MAP[m[2].toLowerCase()]) {
    const dd = m[1].padStart(2, '0');
    const mm = MONTH_MAP[m[2].toLowerCase()];
    const yyyy = m[3].length === 2 ? (parseInt(m[3], 10) > 60 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    const ddNum = parseInt(dd, 10);
    if (ddNum < 1 || ddNum > 31) return null;
    return `${dd}-${mm}-${yyyy}`;
  }
  // YYYY-MM-DD or YYYY/MM/DD
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    const mmNum = parseInt(m[2], 10);
    const ddNum = parseInt(m[3], 10);
    if (mmNum < 1 || mmNum > 12 || ddNum < 1 || ddNum > 31) return null;
    return `${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[1]}`;
  }
  return null;
}

/**
 * Parse a monetary value with full Indian/western grouping and negative/overdraft/Dr/Cr support:
 * Returns { value, paise, hasExplicitSign, rawSign, isPlaceholder } where paise is signed integer paise.
 */
function parseSignedAmountInfo(raw) {
  if (raw === null || raw === undefined) return { value: NaN, paise: NaN, hasExplicitSign: false, rawSign: null };
  if (typeof raw === 'number') {
    const paise = Number.isFinite(raw) ? Math.round(raw * 100) : NaN;
    return {
      value: Number.isFinite(paise) ? paise / 100 : NaN,
      paise,
      hasExplicitSign: raw < 0,
      rawSign: raw < 0 ? '-' : null,
    };
  }
  let s = String(raw).trim();
  if (!s || /^[-–—]+$/.test(s) || /^(?:NIL|NA|N\/A|NULL)$/i.test(s)) {
    return { value: NaN, paise: NaN, hasExplicitSign: false, rawSign: null, isPlaceholder: true };
  }

  s = s.replace(/₹|\bRs\.?|\bINR\b/gi, '').trim();
  if (!s) return { value: NaN, paise: NaN, hasExplicitSign: false, rawSign: null };

  let isNegative = false;
  let hasExplicitSign = false;
  let rawSign = null;

  if (/^\(\s*[\d,]+(?:\.\d+)?\s*\)$/.test(s)) {
    isNegative = true;
    hasExplicitSign = true;
    rawSign = '()';
    s = s.replace(/[()]/g, '').trim();
  }

  const drMatch = s.match(/^(?:DR|Dr|dr)\.?\s*([\d,.\-+]+)$/) || s.match(/^([\d,.\-+]+)\s*(?:DR|Dr|dr)\.?$/);
  const crMatch = s.match(/^(?:CR|Cr|cr)\.?\s*([\d,.\-+]+)$/) || s.match(/^([\d,.\-+]+)\s*(?:CR|Cr|cr)\.?$/);

  if (drMatch) {
    isNegative = true;
    hasExplicitSign = true;
    rawSign = 'DR';
    s = drMatch[1].trim();
  } else if (crMatch) {
    hasExplicitSign = true;
    rawSign = 'CR';
    s = crMatch[1].trim();
  }

  if (s.startsWith('-') || s.endsWith('-')) {
    isNegative = true;
    hasExplicitSign = true;
    rawSign = rawSign || '-';
    s = s.replace(/^-+|-+$/g, '').trim();
  } else if (s.startsWith('+') || s.endsWith('+')) {
    hasExplicitSign = true;
    rawSign = rawSign || '+';
    s = s.replace(/^\++|\++$/g, '').trim();
  }

  const cleaned = s.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return { value: NaN, paise: NaN, hasExplicitSign: false, rawSign: null };
  }
  const parts = cleaned.split('.');
  const rupees = parseInt(parts[0], 10);
  const decStr = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  const decPaise = parseInt(decStr, 10);
  if (!Number.isFinite(rupees) || !Number.isFinite(decPaise)) {
    return { value: NaN, paise: NaN, hasExplicitSign: false, rawSign: null };
  }
  const absPaise = rupees * 100 + decPaise;
  const signedPaise = isNegative ? -absPaise : absPaise;
  return {
    value: signedPaise / 100,
    paise: signedPaise,
    hasExplicitSign,
    rawSign,
  };
}

function parseAmount(str) {
  return parseSignedAmountInfo(str).value;
}

/**
 * Bug Class 2: Generic Narration Sanity Validation
 * Flags any row whose narration contains:
 * (a) table-header or page-furniture tokens (Particulars, Cheque No, Customer Details, IFS Code,
 *     Branch, Page x of y, Effective available balance, Statement of Account, etc.)
 * (b) two different transaction reference numbers (indicating two rows were merged or misaligned).
 */
const FURNITURE_OR_HEADER_IN_NARRATION_RE =
  /\b(?:Particulars|Tran(?:saction)?\s+Particulars|Cheque\s*No\.?|Chq\.?\s*\/?\s*Ref\.?\s*No\.?|Customer\s+Details|Account\s+Details|IFS\s*Code|IFSC\s*Code|MICR\s*Code|Branch\s*Name|Branch\s*Code|Branch\s*Address|Page\s+\d+\s+of\s+\d+|Effective\s+available\s+balance|Statement\s+of\s+Account|STATEMENT\s+OF\s+THE\s+ACCOUNT|Opening\s+Balance|Closing\s+Balance|Withdrawal\s*Amt|Deposit\s*Amt|Running\s+Balance|Value\s+Date\s+Particulars|Account\s+Holder\s+Name|Customer\s+ID|Mode\s+of\s+Operation|Nominee\s+Registered|Drawing\s+Power|Sanction\s+Limit)\b/i;

function extractDistinctReferenceNumbers(narration) {
  if (!narration) return [];
  // Strip bank internal channel references (e.g. "UPI-620267833895", "IMPS-621613059122", "NACH-123456789012")
  // where the prefix is attached by a hyphen/slash/colon to an internal transaction ID.
  // ALSO strip bank-prefixed destination account numbers common in Indian banking UPI/NEFT/IMPS narrations:
  // e.g. "/SBIN/000000360051", "/CNRB/123456789012", "/PUNB/000100010001", etc.
  let s = String(narration)
    .replace(/(?:UPI|IMPS|NEFT|RTGS|NACH|ACH|BBPS|MB|INB)[-_/:]\d{10,16}/gi, ' ')
    .replace(/\/(?:[A-Z]{4}|[A-Z]{3,6})\/(\d{9,18})/gi, ' ')
    .toUpperCase();
  const refs = new Set();

  // 12-digit UPI / IMPS RRNs (excluding 10-digit mobile numbers before @)
  const rrnMatches = s.match(/\b\d{12,16}\b/g) || [];
  for (const r of rrnMatches) {
    // Ignore strings that start with three or more zeros (common for zero-padded account numbers like 000000360051)
    if (/^000+\d+/.test(r)) continue;
    refs.add(r);
  }

  // Alphanumeric NEFT / RTGS UTRs (4 bank letters + 9..16 alphanumeric chars with at least 6 digits)
  const utrMatches = s.match(/\b[A-Z]{4}0?[A-Z0-9]\d{8,14}\b/g) || [];
  for (const u of utrMatches) {
    // Ignore IFSC codes (which are 11 chars: 4 letters + '0' + 6 chars)
    if (u.length === 11 && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(u)) continue;
    refs.add(u);
  }

  return Array.from(refs);
}

function validateNarrationSanity(narration) {
  if (!narration || typeof narration !== 'string') {
    return {
      valid: false,
      isValid: false,
      reasons: ['Empty narration'],
      reason: 'Empty narration',
    };
  }

  const reasons = [];
  const trimmed = narration.trim();

  if (trimmed.length < 2) {
    reasons.push('Narration too short (< 2 characters)');
  }

  // Detect garbage / unreadable OCR artifacts
  const nonPrintable = trimmed.replace(/[\x20-\x7E]/g, '');
  if (nonPrintable.length > trimmed.length * 0.4 && trimmed.length > 5) {
    reasons.push('High concentration of non-printable or corrupt OCR characters');
  }

  const furnitureMatch = trimmed.match(FURNITURE_OR_HEADER_IN_NARRATION_RE);
  if (furnitureMatch) {
    reasons.push(`Narration contaminated by table-header / page-furniture token ("${furnitureMatch[0]}")`);
  }

  const distinctRefs = extractDistinctReferenceNumbers(trimmed);
  if (distinctRefs.length >= 2) {
    const filtered = distinctRefs.filter(
      (r, idx) => !distinctRefs.some((other, oIdx) => oIdx !== idx && other.includes(r))
    );
    if (filtered.length >= 2) {
      reasons.push(`Narration contains two different transaction reference numbers (${filtered.slice(0, 2).join(' vs ')})`);
    }
  }

  const isValid = reasons.length === 0;
  return {
    valid: isValid,
    isValid,
    reasons,
    reason: isValid ? null : reasons.join('; '),
  };
}

/**
 * Strip mid-table page noise, browser print headers/footers, "Page X of Y" split across two lines,
 * narration code legends, QR/contact blocks, and ads.
 */
function preprocessLinesAndExtractPageMeta(rawLines) {
  const cleanedLines = [];
  const pageBfBalances = [];
  const pageTotals = [];
  let currentPage = 1;
  let inLegendOrDisclaimer = false;

  const NOISE_LINE_RE =
    /^(?:https?:\/\/\S+|about:blank|\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\b.*|Transaction\s+Details\s+Page\s+\d+(?:\s+of\s+\d+)?|Page\s+\d+\s+of\s+\d+|Page\s+\d+|\*\*This\s+is\s+a\s+computer.*|This\s+is\s+a\s+system\s+generated.*|statement\s+does\s+not\s+require\s+any\s+signature.*|Registered\s+Office\s*:.*|Corporate\s+Office\s*:.*|Toll\s*Free\s*(?:No|Number)?\s*:.*|Customer\s+Care\s*:.*|Visit\s+us\s+at\s*:.*|Scan\s+QR\s+Code.*|Download\s+our\s+App.*|Never\s+share\s+your\s+OTP.*|DICGC\s+insures.*|End\s+of\s+Statement.*|\*+\s*End\s+of\s+Statement\s*\*+)$/i;

  const LEGEND_START_RE =
    /^(?:Legends?\s*(?:used\s+in\s+the\s+statement|for\s+narration|\/?\s*Abbreviations?)|Abbreviations?\s+Used|Important\s+Information|Terms\s+and\s+Conditions|Glossary\s+of\s+Terms)\s*[:\-]?$/i;

  for (let i = 0; i < rawLines.length; i++) {
    const line = (rawLines[i] || '').trim();
    if (!line) continue;

    const splitPageMatch = line.match(/^Page\s+(\d+)\s*$/i);
    if (splitPageMatch) {
      currentPage = parseInt(splitPageMatch[1], 10) || currentPage + 1;
      if (i + 1 < rawLines.length && /^of\s+\d+\s*$/i.test((rawLines[i + 1] || '').trim())) {
        i++;
      }
      inLegendOrDisclaimer = false;
      continue;
    }

    const inlinePageMatch =
      line.match(/(?:^|\b)Page\s+(\d+)\s+of\s+(\d+)\b/i) ||
      line.match(/^Transaction\s+Details\s+Page\s+(\d+)(?:\s+of\s+(\d+))?$/i);
    if (inlinePageMatch && line.length < 60) {
      currentPage = parseInt(inlinePageMatch[1], 10) || currentPage + 1;
      inLegendOrDisclaimer = false;
      continue;
    }

    if (LEGEND_START_RE.test(line)) {
      inLegendOrDisclaimer = true;
      continue;
    }
    if (inLegendOrDisclaimer) {
      if (
        /^(?:\d{1,4}\s+)?(?:\d{1,2}[-\/\s][A-Za-z0-9]{2,3}[-\/\s]\d{2,4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\b/.test(
          line
        ) &&
        /\d+\.\d{2}/.test(line)
      ) {
        inLegendOrDisclaimer = false;
      } else {
        continue;
      }
    }

    const bfMatch = line.match(
      /^(?:B\/F|Brought\s+Forward|Balance\s+Brought\s+Forward|Balance\s+B\/F|Opening\s+Balance\s+B\/F)\b.*?(?:INR|Rs\.?|₹)?\s*((?:Dr|Cr|DR|CR)?\s*\(?[+-]?[\d,]+\.\d{2}\)?\s*(?:Cr|Dr|CR|DR|-)?)/i
    );
    if (bfMatch) {
      const info = parseSignedAmountInfo(bfMatch[1]);
      if (Number.isFinite(info.value)) {
        pageBfBalances.push({
          page: currentPage,
          balance: info.value,
          balancePaise: info.paise,
          hasExplicitSign: info.hasExplicitSign,
        });
      }
      continue;
    }

    const pageTotMatch = line.match(/^Page\s+Total\b(.*)$/i);
    if (pageTotMatch) {
      const amts = [
        ...pageTotMatch[1].matchAll(
          /(?:(Cr|Dr|CR|DR)\.?\s*)?(\(\s*(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\s*\)|[+-]?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}-?)(?:\s*(Cr|Dr|CR|DR))?/g
        ),
      ]
        .map((m) => parseSignedAmountInfo(m[0]))
        .filter((x) => Number.isFinite(x.value));
      if (amts.length >= 2) {
        pageTotals.push({
          page: currentPage,
          debitTotal: Math.abs(amts[0].value),
          creditTotal: Math.abs(amts[1].value),
          balance: amts[2] ? amts[2].value : null,
        });
      }
      continue;
    }

    if (NOISE_LINE_RE.test(line)) continue;

    cleanedLines.push({ page: currentPage, text: line, raw: rawLines[i] });
  }

  return { cleanedLines, pageBfBalances, pageTotals };
}

/**
 * Bug Class 3: Strict Account Metadata & Period Parsing
 * - Takes account holder name ONLY from the labelled holder field value (stops at end of line or next label),
 *   never from unlabelled salutation/address lines.
 * - Parses printed statement periods in all common formats:
 *   DD/MM/YYYY to DD/MM/YYYY, DD-MM-YYYY, DD-Mon-YYYY, DD Mon YYYY, and ISO YYYY-MM-DD to YYYY-MM-DD.
 */
const NEXT_HEADER_LABEL_RE =
  /\s+(?:Date|Statement\s*Date|Date\s*of\s*Statement|Account\s*(?:No|Number|Type|Status|Branch|Currency|Description)|A\/c\s*(?:No|Number|Type)|Branch(?:\s*Name|\s*Code|\s*Address)?|IFSC(?:\s*Code)?|IFS\s*Code|MICR(?:\s*Code)?|Customer\s*(?:ID|No|Number|Rel)|CIF(?:\s*No|\s*ID)?|CRN|Address|Communication\s*Address|Branch\s*Address|Joint\s*Holder|Nominee|Period|Statement\s*(?:Period|From)|Currency|Drawing\s*Power|Sanction\s*Limit|Od\s*Limit|Phone|Mobile|Email|PAN|CKYC|GSTIN|Scheme|Product|Mode\s*of\s*Operation)\b.*$/i;

const ADDRESS_CONTAMINATION_RE =
  /\b(?:S\/O|D\/O|W\/O|C\/O|H\s*NO|HOUSE\s*NO|FLAT\s*NO|PLOT\s*NO|DOOR\s*NO|WARD\s*NO|SECTOR|PHASE|BLOCK|COLONY|NAGAR|VIHAR|ENCLAVE|APARTMENT|SOCIETY|ROAD|MARG|STREET|LANE|GALI|NEAR|OPP|OPPOSITE|BEHIND|BESIDE|TEHSIL|TALUK|TALUKA|DIST|DISTRICT|MANDAL|VILLAGE|POST|PO\b|PS\b|PIN(?:\s*CODE)?|\d{6})\b/i;

function extractAccountInfo(fullText, detectedBank, pageBfBalances = []) {
  const t = fullText || '';

  // Only match explicitly labelled holder fields or clear header name blocks
  const p1Text = t.slice(0, 2000);
  const holderMatch =
    t.match(
      /(?:Account\s*Holder(?:'?s)?\s*Name|Name\s*of\s*(?:the\s*)?(?:Account\s*Holder|Customer)|Customer\s*Name|Primary\s*Holder(?:\s*Name)?|A\/c\s*Holder\s*Name|Account\s*Title)\s*[:\-]?\s*(?:\d+\s*:\s*)?([^\r\n]+)/i
    ) ||
    t.match(/Welcome\s*:\s*(?:[\s\S]{0,60}?)\s*((?:MR|MRS|MS|MISS|DR|SHRI|SMT)\.?\s+[A-Za-z][A-Za-z\s.]{1,50})/i) ||
    t.match(/Account\s*No\s*:\s*\d+\s+INR\s+([A-Za-z][A-Za-z\s.]{1,50}?)(?:\r?\n|\s{2,}|Gl\s*Sub)/i) ||
    t.match(/(?:^|\n)\s*(?:Holder\s*Name|Account\s*Name|Customer\s*Name|Name)\s*[:\-]?\s*([A-Za-z][^\r\n]{1,60})/i) ||
    p1Text.match(/(?:^|\r?\n)\s*((?:MR|MRS|MS|MISS|DR|SHRI|SMT|M\/S)\.?\s*[A-Za-z][A-Za-z\s.]{1,50})(?:\r?\n|$)/i);

  let rawHolder = 'Account Holder';
  if (holderMatch && holderMatch[1]) {
    let candidate = holderMatch[1]
      .split(/\r?\n/)[0]
      .replace(/\s{4,}.*$/, '') // Stop at wide column boundary between multi-column headers
      .replace(NEXT_HEADER_LABEL_RE, '')
      .replace(/\s*[:|].*$/, '')
      .replace(/^\s*(?:MR|MRS|MS|MISS|DR|SHRI|SMT|KUM|M\/S)\.?\s+/i, '')
      .replace(/\s+[A-Za-z]+,[A-Za-z]+.*$/, '') // Strip city/state comma tokens e.g. "FARIDABAD,FARIDABAD"
      .replace(/\s+/g, ' ')
      .trim();

    // Strip any trailing address segment if glued on the same line
    const addrIdx = candidate.search(ADDRESS_CONTAMINATION_RE);
    if (addrIdx > 2) {
      candidate = candidate.slice(0, addrIdx).replace(/[,\-\/]+\s*$/, '').trim();
    }
    if (candidate && candidate.length >= 2 && !ADDRESS_CONTAMINATION_RE.test(candidate)) {
      rawHolder = candidate;
    }
  }

  const accMatch =
    t.match(/(?:Account\s*(?:No|Number|#)|A\/c\s*(?:No|Number))\s*[:\-]?\s*([X*\d]{6,22})/i) ||
    t.match(/Statement\s+(?:of\s+Account|for\s+A\/c)\s*[:\-]?\s*([X*\d]{6,22})/i) ||
    t.match(/Account\s*No[\s\S]{0,80}?:\s*(\d{8,20})/i);
  const ifscMatch = t.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);

  const rawAcc = accMatch ? accMatch[1].trim() : 'Not printed on statement';
  const accountNumberMasked =
    rawAcc && rawAcc !== 'Not printed on statement' && rawAcc.length > 4 && !/[X*]/.test(rawAcc)
      ? `${'X'.repeat(rawAcc.length - 4)}${rawAcc.slice(-4)}`
      : rawAcc;

  // Bug Class 3: Parse printed statement periods in all common formats:
  // DD/MM/YYYY to DD/MM/YYYY, DD-MM-YYYY, DD-Mon-YYYY, DD Mon YYYY, and ISO YYYY-MM-DD to YYYY-MM-DD
  let printedFrom = null;
  let printedTo = null;
  const DATE_TOKEN_PATTERN =
    '(?:\\d{4}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}|\\d{1,2}[-\\/.]\\d{1,2}[-\\/.]\\d{2,4}|\\d{1,2}[-\\/\\s.,]+[A-Za-z]{3,9}[-\\/\\s.,]+\\d{2,4})';
  const periodRegex1 = new RegExp(
    `(?:Period|Statement\\s*(?:Period|From|for\\s*the\\s*period|Date)|From\\s*Date|Transaction\\s*Period|For\\s*the\\s*Period|From)\\s*[:\\-]?\\s*(?:from\\s*)?(${DATE_TOKEN_PATTERN})\\s*(?:to|To|TO|-|–|—|→|upto|Up\\s*to|and)\\s*(?:Date\\s*[:\\-]?\\s*)?(${DATE_TOKEN_PATTERN})`,
    'i'
  );
  const periodRegex2 = new RegExp(
    `Statement\\s*start\\s*date\\s*[:\\s]*(${DATE_TOKEN_PATTERN})[\\s\\S]{0,80}?Statement\\s*end\\s*date\\s*[:\\s]*(${DATE_TOKEN_PATTERN})`,
    'i'
  );
  const periodMatch = t.match(periodRegex1) || t.match(periodRegex2);
  if (periodMatch) {
    printedFrom = normalizeDate(periodMatch[1]) || periodMatch[1].trim();
    printedTo = normalizeDate(periodMatch[2]) || periodMatch[2].trim();
  }

  let printedOpening = null;
  let printedOpeningSource = null;
  let printedOpeningHasExplicitSign = false;
  let printedClosing = null;
  let printedClosingSource = null;
  let printedClosingHasExplicitSign = false;
  let printedTotalDebits = null;
  let printedTotalCredits = null;
  let printedDebitCount = null;
  let printedCreditCount = null;
  let printedTotalTxCount = null;

  // 1. Try extracting from 4-column summary blocks (Opening, Debit/Withdrawal, Credit/Deposit, Closing)
  const numRe = '(?:INR|Rs\\.?|₹)?\\s*\\(?[+-]?[\\d,]+(?:\\.\\d{2})?\\)?(?:\\s*(?:Cr|Dr|CR|DR|-))?';
  const summaryTableRe1 = new RegExp(
    '(?:Opening\\s*Balance\\s*(?:Total\\s*)?(?:Debit|Withdrawals?)\\s*(?:Total\\s*)?(?:Credit|Deposits?)\\s*Closing\\s*Balance)[\\r\\n\\s]*' +
    '(' + numRe + ')' +
    '\\s*(' + numRe + ')' +
    '\\s*(' + numRe + ')' +
    '\\s*(' + numRe + ')',
    'i'
  );
  const summaryTableRe2 = new RegExp(
    '(?:Opening\\s*Balance\\s*(?:Total\\s*)?(?:Credit|Deposits?)\\s*(?:Total\\s*)?(?:Debit|Withdrawals?)\\s*Closing\\s*Balance)[\\r\\n\\s]*' +
    '(' + numRe + ')' +
    '\\s*(' + numRe + ')' +
    '\\s*(' + numRe + ')' +
    '\\s*(' + numRe + ')',
    'i'
  );

  const sm1 = t.match(summaryTableRe1);
  const sm2 = !sm1 ? t.match(summaryTableRe2) : null;

  // Pattern for SBI-style summary: "Statement Summary ... Brought Forward ... Dr Count Cr Count Total Debits Total Credits Closing Balance ... 12,230.95CR 1233 306 39,98,938.43 39,94,422.00 7,714.52CR"
  const sbiSummaryRe =
    /(?:Statement\s*Summary|Account\s*Summary)[\s\S]*?Brought\s*Forward[\s\S]*?Closing\s*Balance[\s\S]*?([0-9,]+\.\d{2}(?:\s*(?:CR|DR))?)[\s\S]*?([0-9,]+\.\d{2})[\s\S]*?([0-9,]+\.\d{2})[\s\S]*?([0-9,]+\.\d{2}(?:\s*(?:CR|DR))?)/i;
  const smSbi = !sm1 && !sm2 ? t.match(sbiSummaryRe) : null;

  if (sm1) {
    const opInfo = parseSignedAmountInfo(sm1[1]);
    const drVal = Math.abs(parseAmount(sm1[2]));
    const crVal = Math.abs(parseAmount(sm1[3]));
    const clInfo = parseSignedAmountInfo(sm1[4]);
    if (Number.isFinite(opInfo.value)) {
      printedOpening = opInfo.value;
      printedOpeningHasExplicitSign = opInfo.hasExplicitSign;
      printedOpeningSource = 'summary_table_opening';
    }
    if (Number.isFinite(drVal)) printedTotalDebits = drVal;
    if (Number.isFinite(crVal)) printedTotalCredits = crVal;
    if (Number.isFinite(clInfo.value)) {
      printedClosing = clInfo.value;
      printedClosingHasExplicitSign = clInfo.hasExplicitSign;
      printedClosingSource = 'summary_table_closing';
    }
  } else if (sm2) {
    const opInfo = parseSignedAmountInfo(sm2[1]);
    const crVal = Math.abs(parseAmount(sm2[2]));
    const drVal = Math.abs(parseAmount(sm2[3]));
    const clInfo = parseSignedAmountInfo(sm2[4]);
    if (Number.isFinite(opInfo.value)) {
      printedOpening = opInfo.value;
      printedOpeningHasExplicitSign = opInfo.hasExplicitSign;
      printedOpeningSource = 'summary_table_opening';
    }
    if (Number.isFinite(drVal)) printedTotalDebits = drVal;
    if (Number.isFinite(crVal)) printedTotalCredits = crVal;
    if (Number.isFinite(clInfo.value)) {
      printedClosing = clInfo.value;
      printedClosingHasExplicitSign = clInfo.hasExplicitSign;
      printedClosingSource = 'summary_table_closing';
    }
  } else if (smSbi) {
    const opInfo = parseSignedAmountInfo(smSbi[1]);
    const drVal = Math.abs(parseAmount(smSbi[2]));
    const crVal = Math.abs(parseAmount(smSbi[3]));
    const clInfo = parseSignedAmountInfo(smSbi[4]);
    if (Number.isFinite(opInfo.value)) {
      printedOpening = opInfo.value;
      printedOpeningHasExplicitSign = opInfo.hasExplicitSign;
      printedOpeningSource = 'summary_table_opening';
    }
    if (Number.isFinite(drVal)) printedTotalDebits = drVal;
    if (Number.isFinite(crVal)) printedTotalCredits = crVal;
    if (Number.isFinite(clInfo.value)) {
      printedClosing = clInfo.value;
      printedClosingHasExplicitSign = clInfo.hasExplicitSign;
      printedClosingSource = 'summary_table_closing';
    }
    const countMatch = t.match(/Dr\s*Count\s*Cr\s*Count[\s\S]*?(\d{1,6})\s+(\d{1,6})/i);
    if (countMatch) {
      const drC = parseInt(countMatch[1], 10);
      const crC = parseInt(countMatch[2], 10);
      if (Number.isFinite(drC)) printedDebitCount = drC;
      if (Number.isFinite(crC)) printedCreditCount = crC;
    }
  }

  // 2. Fall back to standard individual field matching if not found
  if (printedOpening === null) {
    const openMatch = t.match(
      /(?:Opening\s+Balance|Balance\s+as\s+on\s+Start\s+Date)\s*(?:as\s+on\s+[^\s:]+\s*)?[:\-]?\s*(?:INR|Rs\.?|₹)?\s*((?:Dr|Cr|DR|CR)?\s*\(?[+-]?[\d,]+\.\d{2}\)?\s*(?:Cr|Dr|CR|DR|-)?)/i
    );
    if (openMatch) {
      const info = parseSignedAmountInfo(openMatch[1]);
      if (Number.isFinite(info.value)) {
        printedOpening = info.value;
        printedOpeningHasExplicitSign = info.hasExplicitSign;
        printedOpeningSource = 'printed_opening';
      }
    } else if (pageBfBalances.length > 0 && pageBfBalances[0].page === 1) {
      printedOpening = pageBfBalances[0].balance;
      printedOpeningHasExplicitSign = pageBfBalances[0].hasExplicitSign;
      printedOpeningSource = 'page1_bf';
    }
  }

  if (printedClosing === null) {
    const closeMatch = t.match(
      /(?:Closing\s+Balance|Effective\s+Available\s+Balance|Clear\s+Balance|Balance\s+as\s+on\s+End\s+Date)\s*(?:as\s+on\s+[^\s:]+\s*)?[:\-]?\s*(?:INR|Rs\.?|₹)?\s*((?:Dr|Cr|DR|CR)?\s*\(?[+-]?[\d,]+\.\d{2}\)?\s*(?:Cr|Dr|CR|DR|-)?)/i
    );
    if (closeMatch) {
      const info = parseSignedAmountInfo(closeMatch[1]);
      if (Number.isFinite(info.value)) {
        printedClosing = info.value;
        printedClosingHasExplicitSign = info.hasExplicitSign;
        printedClosingSource = 'printed_closing';
      }
    }
  }

  if (printedTotalDebits === null) {
    const totDrMatch = t.match(
      /(?:Total\s+(?:Debit|Withdrawal)s?(?:\s+Amount)?|Debit\s+Total|Total\s+Withdrawn)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})/i
    );
    if (totDrMatch) {
      const v = Math.abs(parseAmount(totDrMatch[1]));
      if (Number.isFinite(v)) printedTotalDebits = v;
    }
  }

  if (printedTotalCredits === null) {
    const totCrMatch = t.match(
      /(?:Total\s+(?:Credit|Deposit)s?(?:\s+Amount)?|Credit\s+Total|Total\s+Deposited)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})/i
    );
    if (totCrMatch) {
      const v = Math.abs(parseAmount(totCrMatch[1]));
      if (Number.isFinite(v)) printedTotalCredits = v;
    }
  }

  let unlabeledTotalPair = null;
  const unlabeledTotMatches = Array.from(
    t.matchAll(
      /(?:^|\n)\s*(?:Grand\s+Total|Total|Statement\s+Total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})\s+(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?/gi
    )
  );
  if (unlabeledTotMatches.length > 0 && printedTotalDebits === null && printedTotalCredits === null) {
    // Pick the last matching total row (the true end-of-statement totals, skipping header summaries)
    const lastMatch = unlabeledTotMatches[unlabeledTotMatches.length - 1];
    const a = Math.abs(parseAmount(lastMatch[1]));
    const b = Math.abs(parseAmount(lastMatch[2]));
    if (Number.isFinite(a) && Number.isFinite(b)) {
      unlabeledTotalPair = [a, b];
    }
  }

  if (printedDebitCount === null) {
    const drCntMatch = t.match(/(?:No\.?\s*of\s*Debits?|Debit\s*Count|Total\s*Debit\s*Txns?)\s*[:\-]?\s*(\d{1,5})\b/i);
    if (drCntMatch) printedDebitCount = parseInt(drCntMatch[1], 10);
  }
  if (printedCreditCount === null) {
    const crCntMatch = t.match(/(?:No\.?\s*of\s*Credits?|Credit\s*Count|Total\s*Credit\s*Txns?)\s*[:\-]?\s*(\d{1,5})\b/i);
    if (crCntMatch) printedCreditCount = parseInt(crCntMatch[1], 10);
  }
  if (printedTotalTxCount === null) {
    const totCntMatch = t.match(
      /(?:Total\s*(?:No\.?\s*of\s*)?Transactions?|Transaction\s*Count)\s*[:\-]?\s*(\d{1,6})\b/i
    );
    if (totCntMatch) printedTotalTxCount = parseInt(totCntMatch[1], 10);
  }

  return {
    bankName: detectedBank && detectedBank !== 'Unknown Bank' ? detectedBank : 'Bank not identified',
    accountHolderName: rawHolder,
    accountNumber: rawAcc,
    accountNumberMasked,
    ifsc: ifscMatch ? ifscMatch[1] : 'Not printed on statement',
    printedFrom,
    printedTo,
    printedOpening,
    printedOpeningSource,
    printedOpeningHasExplicitSign,
    printedClosing,
    printedClosingSource,
    printedClosingHasExplicitSign,
    printedTotalDebits,
    printedTotalCredits,
    unlabeledTotalPair,
    printedDebitCount,
    printedCreditCount,
    printedTotalTxCount,
  };
}

function mergeWrappedLines(rawLines) {
  if (!rawLines || rawLines.length === 0) return '';
  let merged = String(rawLines[0] || '').trim();
  for (let i = 1; i < rawLines.length; i++) {
    const next = String(rawLines[i] || '').trim();
    if (!next) continue;
    const prevEndsWithConnector = /[\/\-_]$/.test(merged);
    const prevEndsWithRefFragment =
      /\b(?:UPI|IMPS|NEFT|RTGS|ACH|NACH)[\/\-][A-Za-z0-9\/\-]*\d{3,10}$/i.test(merged) &&
      /^\d{2,10}\b/.test(next);
    const prevEndsWithHalfUtr = /\b[A-Z]{4}[0-9A-Z]{3,8}$/.test(merged) && /^\d{4,10}\b/.test(next);
    if (prevEndsWithConnector || prevEndsWithRefFragment || prevEndsWithHalfUtr) {
      merged = `${merged}${next}`;
    } else {
      merged = `${merged} ${next}`;
    }
  }
  return merged.replace(/\s+/g, ' ').trim();
}

function cleanRowNarrationText(rawNarration) {
  if (!rawNarration) return 'Bank Transaction';
  return (
    String(rawNarration)
      .replace(/^\(?\d{1,2}[-\/\s][A-Za-z0-9]{2,3}[-\/\s]\d{2,4}\)?\s*/, '')
      .replace(/^(?:TO\s+TRANSFER|BY\s+TRANSFER|TRANSFER)\s*[-:/]?\s*/i, '')
      .replace(/\s+(?:Transfer|TRANSFER|Chq\s*Paid|Chq\/Ref\.?\s*No\.?)\s*$/i, '')
      .replace(/\s+[A-Z0-9]{0,4}\d{9,18}\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim() || String(rawNarration).trim()
  );
}

function detectChronologicalOrder(rows) {
  if (!rows || rows.length < 2) return 'oldest-first';
  const toTs = (d) => {
    const [dd, mm, yyyy] = (d || '').split('-').map(Number);
    return new Date(yyyy || 2000, (mm || 1) - 1, dd || 1).getTime();
  };

  let fwdChainMatches = 0;
  let revChainMatches = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const pBal = prev.balancePaise ?? Math.round((prev.balance || 0) * 100);
    const cBal = curr.balancePaise ?? Math.round((curr.balance || 0) * 100);
    const cCr = curr.creditPaise ?? Math.round((curr.credit || 0) * 100);
    const cDr = curr.debitPaise ?? Math.round((curr.debit || 0) * 100);
    const pCr = prev.creditPaise ?? Math.round((prev.credit || 0) * 100);
    const pDr = prev.debitPaise ?? Math.round((prev.debit || 0) * 100);
    const cAmb = curr.ambiguousPaise ?? Math.round((curr.ambiguousAmt || 0) * 100);
    const pAmb = prev.ambiguousPaise ?? Math.round((prev.ambiguousAmt || 0) * 100);

    if (cCr > 0 || cDr > 0) {
      if (Math.abs(pBal + cCr - cDr - cBal) <= 1 || Math.abs(pBal + cCr - cDr - -cBal) <= 1) {
        fwdChainMatches++;
      }
    } else if (cAmb > 0 && pAmb > 0 && cAmb !== pAmb) {
      if (Math.abs(Math.abs(cBal - pBal) - cAmb) <= 1) fwdChainMatches++;
    }

    if (pCr > 0 || pDr > 0) {
      if (Math.abs(cBal + pCr - pDr - pBal) <= 1 || Math.abs(cBal + pCr - pDr - -pBal) <= 1) {
        revChainMatches++;
      }
    } else if (pAmb > 0 && cAmb > 0 && pAmb !== cAmb) {
      if (Math.abs(Math.abs(pBal - cBal) - pAmb) <= 1) revChainMatches++;
    }
  }

  const firstTs = toTs(rows[0].date);
  const lastTs = toTs(rows[rows.length - 1].date);

  if (revChainMatches > fwdChainMatches && revChainMatches >= 1) {
    return 'newest-first';
  }
  if (fwdChainMatches > revChainMatches && fwdChainMatches >= 1) {
    return 'oldest-first';
  }
  if (firstTs > lastTs) return 'newest-first';
  return 'oldest-first';
}

const HEADER_SYNONYMS = {
  serial: /^(?:s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|#|serial\s*no\.?)$/i,
  date: /^(?:txn\s*date|tran(?:saction)?\s*date|post(?:ing)?\s*date|date|gl\.?\s*date)$/i,
  valueDate: /^(?:value\s*date|val\.?\s*date)$/i,
  narration: /^(?:particulars|description|narration|remarks|transaction\s*details|details|tran\s*particulars)$/i,
  reference: /^(?:chq\.?\s*(?:\/|\s)?\s*ref\.?\s*no\.?|cheque\s*no\.?|ref(?:erence)?\s*no\.?|utr\s*no\.?|instrument\s*no\.?|chq\s*no\.?)$/i,
  debit: /^(?:debit|withdrawal(?:s|\s*amt\.?|\s*amount)?|dr\.?|paid\s*out|debit\s*amount|dr\s*amt|withdraw)$/i,
  credit: /^(?:credit|deposit(?:s|\s*amt\.?|\s*amount)?|cr\.?|paid\s*in|credit\s*amount|cr\s*amt)$/i,
  amount: /^(?:amount|txn\s*amount|transaction\s*amount|amount\s*\(?inr\)?)$/i,
  type: /^(?:type|dr\s*\/\s*cr|cr\s*\/\s*dr|d\/c)$/i,
  balance: /^(?:balance|closing\s*balance|running\s*balance|available\s*balance|net\s*balance|bal\.?)$/i,
};

function splitGluedAmountTokens(str) {
  return String(str || '')
    .replace(/(\d+\.\d{2}-)(?=\d)/g, '$1 ')
    .replace(/(\d+\.\d{2})(?=\d{1,3}(?:,\d{2,3})+\.\d{2})/g, '$1 ');
}

/**
 * Detect learned column x-boundaries and header y-positions from positioned PDF items.
 * Returns { columns: { colName: centerX }, boundaries: [{ name, minX, maxX, centerX }], headerYByPage: Map }
 */
function detectColumnLayoutFromGeometry(pagesItems = []) {
  let bestColumns = null;
  const headerYByPage = new Map();
  const footerYByPage = new Map();

  for (const page of pagesItems) {
    const items = page.items || [];
    const yBuckets = new Map();
    for (const it of items) {
      const yKey = Math.round(it.y / 3) * 3;
      if (!yBuckets.has(yKey)) yBuckets.set(yKey, []);
      yBuckets.get(yKey).push(it);
    }

    const sortedYs = Array.from(yBuckets.keys()).sort((a, b) => b - a);
    for (const yKey of sortedYs) {
      const rowItems = yBuckets.get(yKey).sort((a, b) => a.x - b.x);
      const joined = rowItems.map((r) => r.str).join(' ').trim();

      // Detect footer / summary boundary on this page
      if (
        /^(?:Page\s+Total|Grand\s+Total|Closing\s+Balance|End\s+of\s+Statement|\*\*This\s+is\s+a\s+computer|Legends?\s*used|Registered\s+Office)/i.test(
          joined
        )
      ) {
        const curFooterY = footerYByPage.get(page.pageNumber) ?? -Infinity;
        if (yKey > curFooterY) footerYByPage.set(page.pageNumber, yKey);
      }

      // Detect table header row
      if (
        /\b(?:date|particulars|description|narration|remarks)\b/i.test(joined) &&
        /\b(?:balance|closing)\b/i.test(joined) &&
        /\b(?:debit|withdrawal|withdraw|dr|credit|deposit|cr|amount)\b/i.test(joined)
      ) {
        headerYByPage.set(page.pageNumber, yKey);
        const cols = {};
        for (const cell of rowItems) {
          const txt = cell.str.trim();
          const centerX = cell.x + (cell.w || txt.length * 4.5) / 2;
          for (const [colName, rx] of Object.entries(HEADER_SYNONYMS)) {
            if (rx.test(txt) && !cols[colName]) {
              cols[colName] = { x: cell.x, centerX, w: cell.w || txt.length * 4.5 };
            }
          }
        }
        if (cols.balance && (cols.debit || cols.credit || cols.amount) && !bestColumns) {
          bestColumns = cols;
        }
      }
    }
  }

  if (!bestColumns) return null;

  // Build sorted x-boundaries between adjacent columns using midpoints
  const sortedCols = Object.entries(bestColumns)
    .map(([name, info]) => ({ name, x: info.x, centerX: info.centerX }))
    .sort((a, b) => a.centerX - b.centerX);

  const boundaries = sortedCols.map((col, idx) => {
    const prev = sortedCols[idx - 1];
    const next = sortedCols[idx + 1];
    const minX = prev ? (prev.centerX + col.centerX) / 2 : -Infinity;
    const maxX = next ? (col.centerX + next.centerX) / 2 : Infinity;
    return {
      name: col.name,
      centerX: col.centerX,
      minX,
      maxX,
    };
  });

  const simpleMap = {};
  for (const c of sortedCols) simpleMap[c.name] = c.centerX;
  simpleMap._boundaries = boundaries;
  simpleMap._headerYByPage = headerYByPage;
  simpleMap._footerYByPage = footerYByPage;
  return simpleMap;
}

/**
 * Bug Class 1 Fix: Layout-Aware Row Reconstruction using pdf.js text items with x/y coordinates.
 * Why the bug happened:
 *   In many Indian bank statements (e.g. SBI, IOB, PNB, Canara, Union, HDFC), the Date, Amount, and Balance
 *   cells are vertically centred in a tall table row while the Particulars cell has 2–4 lines starting at the
 *   top of the row. In top-to-bottom y-order, the first line of Particulars has a HIGHER y than its own row's
 *   Date/Balance line! A line-by-line parser therefore attaches that first line to the PREVIOUS row, and on
 *   the first row of a page it either drops the line or picks up table header text.
 * How this fixes it:
 *   1. Detects the table header y-position on each page and ignores all items at or above the table header
 *      (and below any footer / page-number / summary banner).
 *   2. Identifies "anchor bands" (y-lines that carry a valid running balance and amount/date).
 *   3. Computes the vertical band `[bandBottomY, bandTopY]` around each anchor using the midpoints between
 *      consecutive anchors on that page (or when dates are top-aligned, from the anchor down to the next row).
 *   4. Attaches all Particulars/Reference text items whose `y` falls within `[bandBottomY, bandTopY]` to that
 *      row in top-to-bottom (`y` descending) order, never cross-contaminating adjacent rows or headers.
 */
function reconstructRowsFromGeometry(pagesGeometry) {
  if (!pagesGeometry || pagesGeometry.length === 0) return null;
  const layout = detectColumnLayoutFromGeometry(pagesGeometry);
  if (!layout || !layout._boundaries) return null;

  const boundaries = layout._boundaries;
  const headerYByPage = layout._headerYByPage || new Map();
  const footerYByPage = layout._footerYByPage || new Map();

  function assignCol(x) {
    for (const b of boundaries) {
      if (x >= b.minX && x < b.maxX) return b.name;
    }
    return 'narration';
  }

  const reconstructedRows = [];

  for (const pageObj of pagesGeometry) {
    if (pageObj.isImageOnly) continue;
    const pageNum = pageObj.pageNumber;
    const headerY = headerYByPage.get(pageNum);
    const footerY = footerYByPage.get(pageNum);

    // Group items into horizontal y-lines (within 2.5pt tolerance)
    const yBuckets = new Map();
    for (const it of pageObj.items || []) {
      const yKey = Math.round(it.y / 2.5) * 2.5;
      // Strictly exclude anything at or above the table header row on this page
      if (headerY !== undefined && yKey >= headerY - 2) continue;
      // Strictly exclude anything at or below a detected footer/total row on this page
      if (footerY !== undefined && yKey <= footerY + 2) continue;

      if (!yBuckets.has(yKey)) yBuckets.set(yKey, []);
      yBuckets.get(yKey).push(it);
    }

    const sortedYs = Array.from(yBuckets.keys()).sort((a, b) => b - a); // top-to-bottom (descending y)
    const visualLines = [];

    for (const yKey of sortedYs) {
      const rowItems = yBuckets.get(yKey).sort((a, b) => a.x - b.x);
      const fullLineText = rowItems.map((r) => r.str).join(' ').trim();
      if (!fullLineText) continue;

      // Skip repeated mid-page headers, page numbers, B/F lines, or customer banners
      if (
        /^(?:Page\s+\d+|Transaction\s+Details|Opening\s+Balance|Closing\s+Balance|B\/F|Brought\s+Forward|Carried\s+Forward|Total\b|Grand\s+Total|Statement\s+of\s+Account)/i.test(
          fullLineText
        ) ||
        FURNITURE_OR_HEADER_IN_NARRATION_RE.test(fullLineText)
      ) {
        continue;
      }

      const cells = {
        serial: [],
        date: [],
        valueDate: [],
        narration: [],
        reference: [],
        debit: [],
        credit: [],
        amount: [],
        type: [],
        balance: [],
      };

      for (const it of rowItems) {
        const subTokens = splitGluedAmountTokens(it.str).split(/\s+/).filter(Boolean);
        for (let sIdx = 0; sIdx < subTokens.length; sIdx++) {
          const tok = subTokens[sIdx];
          const approxX = it.x + sIdx * 32 + (it.w || tok.length * 4.5) / (2 * subTokens.length);
          const col = assignCol(approxX);
          if (cells[col]) cells[col].push(tok);
          else cells.narration.push(tok);
        }
      }

      const dateStr = cells.date.join(' ') || '';
      const normDate = normalizeDate(dateStr);
      const balInfo = parseSignedAmountInfo(cells.balance.join(' '));
      const drInfo = parseSignedAmountInfo(cells.debit.join(' '));
      const crInfo = parseSignedAmountInfo(cells.credit.join(' '));
      const amtInfo = parseSignedAmountInfo(cells.amount.join(' '));

      const hasBalance = Number.isFinite(balInfo.value);
      const hasAmount =
        (Number.isFinite(drInfo.value) && Math.abs(drInfo.value) > 0) ||
        (Number.isFinite(crInfo.value) && Math.abs(crInfo.value) > 0) ||
        (Number.isFinite(amtInfo.value) && Math.abs(amtInfo.value) > 0);

      visualLines.push({
        y: yKey,
        cells,
        normDate,
        hasBalance,
        hasAmount,
        balInfo,
        drInfo,
        crInfo,
        amtInfo,
        fullLineText,
      });
    }

    // Find anchor lines: lines that have a valid balance AND (amount OR date)
    const anchors = [];
    for (let idx = 0; idx < visualLines.length; idx++) {
      const vl = visualLines[idx];
      if (vl.hasBalance && (vl.hasAmount || vl.normDate)) {
        anchors.push({ lineIdx: idx, y: vl.y, vl });
      }
    }

    if (anchors.length === 0) continue;

    // Determine whether this layout vertically centres anchors (i.e. narration lines appear ABOVE the first anchor)
    const hasNarrationAboveFirstAnchor = anchors[0].lineIdx > 0 && visualLines.slice(0, anchors[0].lineIdx).some(
      (l) => (l.cells.narration.length > 0 || l.cells.reference.length > 0) && !l.hasBalance
    );

    for (let aIdx = 0; aIdx < anchors.length; aIdx++) {
      const currAnchor = anchors[aIdx];
      const prevAnchor = aIdx > 0 ? anchors[aIdx - 1] : null;
      const nextAnchor = aIdx + 1 < anchors.length ? anchors[aIdx + 1] : null;

      let bandTopY;
      let bandBottomY;

      if (hasNarrationAboveFirstAnchor) {
        // Vertically-centred date/amount/balance cells: row band spans from midpoint with previous anchor to midpoint with next anchor
        bandTopY = prevAnchor ? (prevAnchor.y + currAnchor.y) / 2 : Infinity;
        bandBottomY = nextAnchor ? (currAnchor.y + nextAnchor.y) / 2 : -Infinity;
      } else {
        // Top-aligned date/amount/balance cells: row band starts at current anchor y (+2pt tolerance) down to just above next anchor y
        bandTopY = currAnchor.y + 2;
        bandBottomY = nextAnchor ? nextAnchor.y + 2 : -Infinity;
      }

      const bandLines = visualLines.filter((l) => l.y <= bandTopY && l.y > bandBottomY);
      bandLines.sort((a, b) => b.y - a.y); // top-to-bottom

      let rowDate = currAnchor.vl.normDate;
      let rowSerial = currAnchor.vl.cells.serial.length > 0 ? parseInt(currAnchor.vl.cells.serial.join(''), 10) : null;
      const narrSegments = [];

      for (const bl of bandLines) {
        if (!rowDate && bl.normDate) rowDate = bl.normDate;
        if (!Number.isInteger(rowSerial) && bl.cells.serial.length > 0) {
          const sCand = parseInt(bl.cells.serial.join(''), 10);
          if (Number.isInteger(sCand)) rowSerial = sCand;
        }
        const seg = [...bl.cells.narration, ...bl.cells.reference].join(' ').trim();
        if (seg) narrSegments.push(seg);
      }

      if (!rowDate) continue;

      const { balInfo, drInfo, crInfo, amtInfo, cells } = currAnchor.vl;
      const typeStr = cells.type.join(' ').toUpperCase();

      let debitPaise = Number.isFinite(drInfo.paise) && Math.abs(drInfo.paise) > 0 ? Math.abs(drInfo.paise) : 0;
      let creditPaise = Number.isFinite(crInfo.paise) && Math.abs(crInfo.paise) > 0 ? Math.abs(crInfo.paise) : 0;
      let ambiguousPaise = 0;

      if (debitPaise === 0 && creditPaise === 0 && Number.isFinite(amtInfo.paise) && Math.abs(amtInfo.paise) > 0) {
        const absPaise = Math.abs(amtInfo.paise);
        if (/^CR|CREDIT/i.test(typeStr) || amtInfo.rawSign === 'CR' || amtInfo.rawSign === '+') {
          creditPaise = absPaise;
        } else if (/^DR|DEBIT/i.test(typeStr) || amtInfo.rawSign === 'DR' || amtInfo.rawSign === '-' || amtInfo.rawSign === '()') {
          debitPaise = absPaise;
        } else {
          ambiguousPaise = absPaise;
        }
      }

      const mergedNarr = cleanRowNarrationText(mergeWrappedLines(narrSegments));
      reconstructedRows.push({
        serial: Number.isInteger(rowSerial) ? rowSerial : null,
        page: pageNum,
        date: rowDate,
        narration: mergedNarr || 'Bank Transaction',
        debitPaise,
        creditPaise,
        ambiguousPaise,
        debit: debitPaise / 100,
        credit: creditPaise / 100,
        ambiguousAmt: ambiguousPaise / 100,
        balancePaise: balInfo.paise,
        balance: balInfo.value,
        balanceHasExplicitSign: balInfo.hasExplicitSign,
      });
    }
  }

  return reconstructedRows.length > 0 ? { rows: reconstructedRows, layout } : null;
}

/**
 * Parse a statement using universal generic strategies:
 * - First attempts layout-aware x/y row reconstruction when PDF page geometry with column headers is available.
 * - Falls back to line-based parsing when only plain text is available.
 * - Runs narration sanity validation on every row and records any contaminated/merged row in unresolvedRows.
 */
function parseGenericStatement(fullText, detectedBank, options = {}) {
  const rawAllLines = splitGluedAmountTokens(fullText || '').split(/\r?\n/);
  const { cleanedLines, pageBfBalances, pageTotals } = preprocessLinesAndExtractPageMeta(rawAllLines);
  const accountInfo = extractAccountInfo(fullText, detectedBank, pageBfBalances);

  let rawRows = [];
  let learnedColumns = null;

  // Try layout-aware x/y geometry reconstruction first when pagesGeometry is available
  if (options.pagesGeometry && options.pagesGeometry.length > 0) {
    const geoRes = reconstructRowsFromGeometry(options.pagesGeometry);
    if (geoRes && geoRes.rows.length > 0) {
      rawRows = geoRes.rows;
      learnedColumns = geoRes.layout;
    }
  }

  // Fallback to text-stream line parser when geometry is unavailable or did not match a table header
  if (rawRows.length === 0) {
    const ROW_START_RE =
      /^(?:(\d{1,5})\s+)?(\d{1,2}[-\/.]\d{1,2}[-\/.]20\d{2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2}(?=\s|$)|\d{1,2}[-\/\s.,]+[A-Za-z]{3,9}[-\/\s.,]+(?:20\d{2}|\d{2})\b|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}\b)(?:\s+\(?(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{1,2}[-\/\s.,]+[A-Za-z]{3,9}[-\/\s.,]+\d{2,4}|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})\)?)?/;

    const SKIP_LINE_RE =
      /^(?:Statement\s+of\s+Account|STATEMENT\s+OF\s+THE\s+ACCOUNT|Opening\s+Balance|Closing\s+Balance|Effective\s+available\s+balance|Total\b|Grand\s+Total|Statement\s+Total|Summary|Report\s+Generation|Date\s+Particulars|Sr\.?\s*No\.?\s+Date|Sl\.?\s*No\.?\s+Date|S\.?\s*No\.?\s+Date|Txn\s+Date|Tran\s+Date|Post(?:ing)?\s+Date|Value\s+Date|Branch\s+Name|Branch\s+Code|Branch\s+Address|Branch\s+Contact|MICR\s+Code|Customer\s+ID|Account\s+Type|Mode\s+of\s+Operation|Account\s+Opening\s+Date|Statement\s*:\s*From|Amount\s+in\(INR\)|RemarksRef|WithdrawDeposit|Customer\s+Details|Account\s+Details)/i;

    const SIGNED_AMT_RE =
      /(?:(Cr|Dr|CR|DR)\.?\s*)?(\(\s*(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\s*\)|[+-]?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}-?)(?:\s*(Cr|Dr|CR|DR)\b)?/gi;

    const blocks = [];
    let current = null;

    for (const item of cleanedLines) {
      const line = item.text;
      const page = item.page;
      if (!line) continue;
      if (SKIP_LINE_RE.test(line)) continue;
      if (FURNITURE_OR_HEADER_IN_NARRATION_RE.test(line) && !/\d+\.\d{2}/.test(line)) continue;

      if (
        current &&
        current.rawLines.length === 1 &&
        /^\(?\d{1,2}[-\/\s][A-Za-z0-9]{2,3}[-\/\s]\d{2,4}\)?$/.test(line)
      ) {
        continue;
      }

      const dm = line.match(ROW_START_RE);
      if (dm) {
        const candidateSerial = dm[1] ? parseInt(dm[1], 10) : null;
        const normDate = normalizeDate(dm[2]);
        if (normDate) {
          if (current) blocks.push(current);
          const remainder = line.slice(dm[0].length).trim();
          current = {
            serial: candidateSerial,
            date: normDate,
            page,
            rawLines: [remainder],
          };
          continue;
        }
      }

      // Only attach continuation lines if the current row has NOT yet closed its amounts OR if the line is a valid continuation
      if (current) {
        const joinedSoFar = mergeWrappedLines(current.rawLines);
        const currentHasAmounts = (joinedSoFar.match(/\d+\.\d{2}/g) || []).length >= 2;
        const lineHasAnyAmount = /\d+\.\d{2}/.test(line);
        if (currentHasAmounts && lineHasAnyAmount) {
          continue;
        }
        current.rawLines.push(line);
      }
    }
    if (current) blocks.push(current);

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const joined = splitGluedAmountTokens(mergeWrappedLines(b.rawLines));
      const matches = [...joined.matchAll(SIGNED_AMT_RE)];
      if (matches.length < 2) continue;

      const balMatch = matches[matches.length - 1];
      const balInfo = parseSignedAmountInfo(balMatch[0]);
      if (!Number.isFinite(balInfo.value)) continue;

      let debitPaise = 0;
      let creditPaise = 0;
      let ambiguousPaise = 0;

      if (matches.length >= 3) {
        const m1 = matches[matches.length - 3];
        const m2 = matches[matches.length - 2];
        const a1 = Math.abs(parseSignedAmountInfo(m1[0]).paise);
        const a2 = Math.abs(parseSignedAmountInfo(m2[0]).paise);
        if (a1 > 0 && a2 === 0) debitPaise = a1;
        else if (a2 > 0 && a1 === 0) creditPaise = a2;
        else ambiguousPaise = a2 > 0 ? a2 : a1;
      } else {
        const amtMatch = matches[matches.length - 2];
        const amtInfo = parseSignedAmountInfo(amtMatch[0]);
        const amtP = Math.abs(amtInfo.paise);
        const tag = (amtInfo.rawSign || '').toUpperCase();

        const beforeAmt = joined.slice(0, amtMatch.index).trim();
        const betweenAmtAndBal = joined.slice(amtMatch.index + amtMatch[0].length, balMatch.index).trim();

        if (tag === 'CR' || tag === '+') {
          creditPaise = amtP;
        } else if (tag === 'DR' || tag === '-' || tag === '()') {
          debitPaise = amtP;
        } else if (/^[-–—]$/.test(betweenAmtAndBal)) {
          debitPaise = amtP;
        } else if (/(?:^|\s)[-–—]$/.test(beforeAmt)) {
          creditPaise = amtP;
        } else {
          ambiguousPaise = amtP;
        }
      }

      const firstAmtMatch = matches[Math.max(0, matches.length - 3)];
      const firstAmtIdx = joined.indexOf(firstAmtMatch[0]);
      const afterBalIdx = joined.lastIndexOf(balMatch[0]) + balMatch[0].length;
      const trailingWrappedText = joined.slice(afterBalIdx).trim();
      const leadingText = (firstAmtIdx > 0 ? joined.slice(0, firstAmtIdx) : joined)
        .replace(/(?:\s+[-–—])+$/, '')
        .trim();
      const combinedRawNarration = trailingWrappedText
        ? mergeWrappedLines([leadingText, trailingWrappedText])
        : leadingText;
      const narration = cleanRowNarrationText(combinedRawNarration);

      rawRows.push({
        serial: b.serial,
        page: b.page || 1,
        date: b.date,
        narration: narration || 'Bank Transaction',
        debitPaise,
        creditPaise,
        ambiguousPaise,
        debit: debitPaise / 100,
        credit: creditPaise / 100,
        ambiguousAmt: ambiguousPaise / 100,
        balancePaise: balInfo.paise,
        balance: balInfo.value,
        balanceHasExplicitSign: balInfo.hasExplicitSign,
      });
    }
  }

  const detectedOrder = detectChronologicalOrder(rawRows);
  if (detectedOrder === 'newest-first') {
    rawRows.reverse();
  }

  const transactions = [];
  const repairs = [];
  const unresolvedRows = [];
  const taintedPagesSet = new Set();
  const seenKeys = new Set();
  let prevBalancePaise =
    accountInfo.printedOpening !== null && Number.isFinite(accountInfo.printedOpening)
      ? Math.round(accountInfo.printedOpening * 100)
      : null;
  let chainBreaks = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    let debitPaise = r.debitPaise ?? Math.round((r.debit || 0) * 100);
    let creditPaise = r.creditPaise ?? Math.round((r.credit || 0) * 100);
    const ambPaise = r.ambiguousPaise ?? Math.round((r.ambiguousAmt || 0) * 100);
    let balPaise = r.balancePaise ?? Math.round((r.balance || 0) * 100);
    let signInferred = false;

    const dedupKey = `${r.date}|${r.narration}|${debitPaise}|${creditPaise}|${balPaise}`;
    if (seenKeys.has(dedupKey) && prevBalancePaise === balPaise) {
      repairs.push({ rowIndex: i, reason: 'Duplicate overlap row dropped', before: r, after: null });
      continue;
    }
    seenKeys.add(dedupKey);

    if (ambPaise > 0 && debitPaise === 0 && creditPaise === 0) {
      if (prevBalancePaise !== null) {
        if (Math.abs(prevBalancePaise + ambPaise - balPaise) <= 1) {
          creditPaise = ambPaise;
        } else if (Math.abs(prevBalancePaise - ambPaise - balPaise) <= 1) {
          debitPaise = ambPaise;
        } else if (!r.balanceHasExplicitSign && Math.abs(prevBalancePaise + ambPaise - -balPaise) <= 1) {
          creditPaise = ambPaise;
          balPaise = -balPaise;
          signInferred = true;
          repairs.push({
            rowIndex: transactions.length,
            type: 'SIGN_INFERRED_FROM_CHAIN',
            reason: 'sign inferred from chain',
            before: { balance: r.balance },
            after: { balance: balPaise / 100 },
          });
        } else if (!r.balanceHasExplicitSign && Math.abs(prevBalancePaise - ambPaise - -balPaise) <= 1) {
          debitPaise = ambPaise;
          balPaise = -balPaise;
          signInferred = true;
          repairs.push({
            rowIndex: transactions.length,
            type: 'SIGN_INFERRED_FROM_CHAIN',
            reason: 'sign inferred from chain',
            before: { balance: r.balance },
            after: { balance: balPaise / 100 },
          });
        } else if (balPaise > prevBalancePaise) {
          creditPaise = ambPaise;
        } else {
          debitPaise = ambPaise;
        }
      } else if (/Transfer-\s*\d|--\s*₹|\/CR\/|\bCR\b|\bCREDIT\b|\bDEP\b|\bBY\s+TRANSFER/i.test(r.narration)) {
        creditPaise = ambPaise;
      } else {
        debitPaise = ambPaise;
      }
    }

    if (prevBalancePaise !== null) {
      const expectedPaise = prevBalancePaise + creditPaise - debitPaise;

      if (Math.abs(expectedPaise - balPaise) > 1) {
        // Auto-heal sign if flipping sign reconciles chain (handles glued DR/CR or sign inverted by text streams)
        if (Math.abs(expectedPaise - -balPaise) <= 1) {
          balPaise = -balPaise;
          signInferred = true;
          repairs.push({
            rowIndex: transactions.length,
            date: r.date,
            type: 'SIGN_INFERRED_FROM_CHAIN',
            reason: 'sign inferred from chain',
            before: { balance: r.balance },
            after: { balance: balPaise / 100 },
          });
        } else {
          const swappedPaise = prevBalancePaise - creditPaise + debitPaise;
          if (Math.abs(swappedPaise - balPaise) <= 1 && (creditPaise > 0 || debitPaise > 0)) {
            repairs.push({
              rowIndex: transactions.length,
              reason: 'Swapped DR/CR repaired from running balance delta',
              before: { debit: debitPaise / 100, credit: creditPaise / 100 },
              after: { debit: creditPaise / 100, credit: debitPaise / 100 },
            });
            const tmp = debitPaise;
            debitPaise = creditPaise;
            creditPaise = tmp;
          } else if (
            Math.abs(swappedPaise - -balPaise) <= 1 &&
            (creditPaise > 0 || debitPaise > 0)
          ) {
            const tmp = debitPaise;
            debitPaise = creditPaise;
            creditPaise = tmp;
            balPaise = -balPaise;
            signInferred = true;
            repairs.push({
              rowIndex: transactions.length,
              type: 'SIGN_INFERRED_FROM_CHAIN',
              reason: 'sign inferred from chain (with DR/CR swap)',
              before: { debit: r.debit, credit: r.credit, balance: r.balance },
              after: { debit: debitPaise / 100, credit: creditPaise / 100, balance: balPaise / 100 },
            });
          } else if (creditPaise === 0 && debitPaise === 0 && balPaise !== prevBalancePaise) {
            const deltaPaise = balPaise - prevBalancePaise;
            if (deltaPaise > 0) creditPaise = deltaPaise;
            else debitPaise = -deltaPaise;
            repairs.push({
              rowIndex: transactions.length,
              reason: 'Missing amount repaired from running balance delta',
              before: { debit: 0, credit: 0 },
              after: { debit: debitPaise / 100, credit: creditPaise / 100 },
            });
          } else if (i === 0 && accountInfo.printedOpening !== null) {
            chainBreaks++;
            unresolvedRows.push({
              rowIndex: 0,
              date: r.date,
              page: r.page,
              serial: r.serial ?? null,
              narration: r.narration,
              prevBalance: prevBalancePaise / 100,
              debit: debitPaise / 100,
              credit: creditPaise / 100,
              balance: balPaise / 100,
              expectedBalance: expectedPaise / 100,
              delta: (balPaise - expectedPaise) / 100,
              reason: `Printed opening balance (₹${(prevBalancePaise / 100).toFixed(2)}) disagrees with first row derived opening balance (₹${((balPaise - creditPaise + debitPaise) / 100).toFixed(2)})`,
            });
          } else {
            chainBreaks++;
            unresolvedRows.push({
              rowIndex: transactions.length,
              date: r.date,
              page: r.page,
              serial: r.serial ?? null,
              narration: r.narration,
              prevBalance: prevBalancePaise / 100,
              debit: debitPaise / 100,
              credit: creditPaise / 100,
              balance: balPaise / 100,
              expectedBalance: expectedPaise / 100,
              delta: (balPaise - expectedPaise) / 100,
              reason: 'Running balance chain mismatch',
            });
          }
        }
      }
    }
    prevBalancePaise = balPaise;

    // Bug Class 2: Narration sanity validation
    const sanity = validateNarrationSanity(r.narration);
    if (!sanity.valid) {
      taintedPagesSet.add(r.page || 1);
      unresolvedRows.push({
        rowIndex: transactions.length,
        date: r.date,
        page: r.page || 1,
        serial: r.serial ?? null,
        narration: (r.narration || '').slice(0, 100),
        debit: debitPaise / 100,
        credit: creditPaise / 100,
        balance: balPaise / 100,
        reason: sanity.reason,
        isNarrationSanityFailure: true,
      });
    }

    transactions.push({
      id: `generic_${transactions.length + 1}`,
      serial: r.serial ?? null,
      page: r.page || 1,
      date: r.date,
      narration: r.narration,
      debitPaise,
      creditPaise,
      balancePaise: balPaise,
      debit: debitPaise / 100,
      credit: creditPaise / 100,
      balance: balPaise / 100,
      signInferredFromChain: signInferred,
      narrationSanityOk: sanity.valid,
    });
  }

  const completenessChecks = {
    available: ['narration_sanity'],
    passed: taintedPagesSet.size === 0 ? ['narration_sanity'] : [],
    failed: taintedPagesSet.size > 0 ? ['narration_sanity'] : [],
  };

  let expectedRowCount = transactions.length;
  const serialRows = transactions.filter((t) => typeof t.serial === 'number' && Number.isInteger(t.serial));
  if (serialRows.length >= 2) {
    completenessChecks.available.push('serial_numbers');
    const maxSerial = Math.max(...serialRows.map((t) => t.serial));
    if (maxSerial >= serialRows.length) {
      expectedRowCount = maxSerial;
    }
    let serialGapFound = false;
    let prevS = null;
    for (let idx = 0; idx < transactions.length; idx++) {
      const t = transactions[idx];
      if (typeof t.serial === 'number' && Number.isInteger(t.serial)) {
        if (prevS !== null && Math.abs(t.serial - prevS) > 1 && Math.abs(t.serial - prevS) <= 50) {
          serialGapFound = true;
          const step = t.serial > prevS ? 1 : -1;
          for (let s = prevS + step; s !== t.serial; s += step) {
            unresolvedRows.push({
              rowIndex: idx,
              serial: s,
              page: t.page || 1,
              position: `Between serial ${prevS} and ${t.serial} (row index ${idx})`,
              reason: `Missing serial number ${s} on page ${t.page || 1}`,
            });
          }
        }
        prevS = t.serial;
      }
    }
    if (serialGapFound) {
      completenessChecks.failed.push('serial_numbers');
    } else {
      completenessChecks.passed.push('serial_numbers');
    }
  }

  let openingBalancePaise = 0;
  let closingBalancePaise = 0;
  if (transactions.length > 0) {
    const first = transactions[0];
    const derivedOpeningPaise = first.balancePaise - first.creditPaise + first.debitPaise;
    if (accountInfo.printedOpening !== null && Number.isFinite(accountInfo.printedOpening)) {
      completenessChecks.available.push('opening_balance');
      const printedOpenPaise = Math.round(accountInfo.printedOpening * 100);
      if (Math.abs(printedOpenPaise - derivedOpeningPaise) <= 1) {
        openingBalancePaise = printedOpenPaise;
        completenessChecks.passed.push('opening_balance');
      } else if (!accountInfo.printedOpeningHasExplicitSign && Math.abs(-printedOpenPaise - derivedOpeningPaise) <= 1) {
        openingBalancePaise = -printedOpenPaise;
        completenessChecks.passed.push('opening_balance');
        repairs.push({
          rowIndex: 0,
          type: 'SIGN_INFERRED_FROM_CHAIN',
          reason: 'Opening balance sign inferred from chain',
          before: { openingBalance: accountInfo.printedOpening },
          after: { openingBalance: openingBalancePaise / 100 },
        });
      } else {
        openingBalancePaise = printedOpenPaise;
        completenessChecks.failed.push('opening_balance');
      }
    } else {
      openingBalancePaise = derivedOpeningPaise;
    }

    const derivedClosingPaise = transactions[transactions.length - 1].balancePaise;
    if (accountInfo.printedClosing !== null && Number.isFinite(accountInfo.printedClosing)) {
      completenessChecks.available.push('closing_balance');
      const printedClosePaise = Math.round(accountInfo.printedClosing * 100);
      if (Math.abs(printedClosePaise - derivedClosingPaise) <= 1) {
        closingBalancePaise = printedClosePaise;
        completenessChecks.passed.push('closing_balance');
      } else if (!accountInfo.printedClosingHasExplicitSign && Math.abs(-printedClosePaise - derivedClosingPaise) <= 1) {
        closingBalancePaise = -printedClosePaise;
        completenessChecks.passed.push('closing_balance');
      } else {
        closingBalancePaise = printedClosePaise;
        completenessChecks.failed.push('closing_balance');
        unresolvedRows.push({
          rowIndex: transactions.length - 1,
          page: transactions[transactions.length - 1].page || 1,
          reason: `Printed closing balance (₹${(printedClosePaise / 100).toFixed(2)}) disagrees with newest row balance (₹${(derivedClosingPaise / 100).toFixed(2)})`,
        });
      }
    } else {
      closingBalancePaise = derivedClosingPaise;
    }
  }

  const totalCreditsPaise = transactions.reduce((s, t) => s + t.creditPaise, 0);
  const totalDebitsPaise = transactions.reduce((s, t) => s + t.debitPaise, 0);
  const totalCredits = totalCreditsPaise / 100;
  const totalDebits = totalDebitsPaise / 100;

  if (accountInfo.printedTotalCredits !== null) {
    completenessChecks.available.push('printed_total_credits');
    if (Math.abs(Math.round(accountInfo.printedTotalCredits * 100) - totalCreditsPaise) <= 5) {
      completenessChecks.passed.push('printed_total_credits');
    } else {
      completenessChecks.failed.push('printed_total_credits');
      unresolvedRows.push({
        rowIndex: null,
        page: null,
        reason: `Printed Total Credits (₹${accountInfo.printedTotalCredits.toFixed(2)}) does not match computed Total Credits (₹${totalCredits.toFixed(2)})`,
      });
    }
  }
  if (accountInfo.printedTotalDebits !== null) {
    completenessChecks.available.push('printed_total_debits');
    if (Math.abs(Math.round(accountInfo.printedTotalDebits * 100) - totalDebitsPaise) <= 5) {
      completenessChecks.passed.push('printed_total_debits');
    } else {
      completenessChecks.failed.push('printed_total_debits');
      unresolvedRows.push({
        rowIndex: null,
        page: null,
        reason: `Printed Total Debits (₹${accountInfo.printedTotalDebits.toFixed(2)}) does not match computed Total Debits (₹${totalDebits.toFixed(2)})`,
      });
    }
  }

  if (accountInfo.unlabeledTotalPair) {
    completenessChecks.available.push('unlabeled_total_pair');
    const [u1, u2] = accountInfo.unlabeledTotalPair;
    const u1P = Math.round(u1 * 100);
    const u2P = Math.round(u2 * 100);
    const directMatch = Math.abs(u1P - totalDebitsPaise) <= 5 && Math.abs(u2P - totalCreditsPaise) <= 5;
    const swappedMatch = Math.abs(u1P - totalCreditsPaise) <= 5 && Math.abs(u2P - totalDebitsPaise) <= 5;
    if (directMatch) {
      accountInfo.printedTotalDebits = u1;
      accountInfo.printedTotalCredits = u2;
      completenessChecks.passed.push('unlabeled_total_pair');
    } else if (swappedMatch) {
      accountInfo.printedTotalCredits = u1;
      accountInfo.printedTotalDebits = u2;
      completenessChecks.passed.push('unlabeled_total_pair');
    } else {
      completenessChecks.failed.push('unlabeled_total_pair');
      unresolvedRows.push({
        rowIndex: null,
        page: null,
        reason: `End-of-statement total pair (₹${u1.toFixed(2)}, ₹${u2.toFixed(2)}) does not match computed totals (Debits ₹${totalDebits.toFixed(2)}, Credits ₹${totalCredits.toFixed(2)})`,
      });
    }
  }

  if (pageBfBalances.length > 1 && detectedOrder === 'oldest-first') {
    completenessChecks.available.push('per_page_bf_balances');
    let bfMismatch = false;
    for (const bf of pageBfBalances) {
      if (bf.page <= 1) continue;
      const priorRows = transactions.filter((t) => (t.page || 1) < bf.page);
      if (priorRows.length > 0) {
        const lastPriorPaise = priorRows[priorRows.length - 1].balancePaise;
        const bfPaise = bf.balancePaise ?? Math.round(bf.balance * 100);
        if (Math.abs(lastPriorPaise - bfPaise) > 2 && Math.abs(lastPriorPaise - -bfPaise) > 2) {
          bfMismatch = true;
          unresolvedRows.push({
            rowIndex: null,
            page: bf.page,
            reason: `Page ${bf.page} B/F balance (₹${bf.balance.toFixed(2)}) does not match previous page ending balance (₹${(lastPriorPaise / 100).toFixed(2)})`,
          });
        }
      }
    }
    if (bfMismatch) completenessChecks.failed.push('per_page_bf_balances');
    else completenessChecks.passed.push('per_page_bf_balances');
  }

  if (pageTotals.length > 0) {
    completenessChecks.available.push('per_page_totals');
    let pageTotMismatch = false;
    for (const pt of pageTotals) {
      const pRows = transactions.filter((t) => (t.page || 1) === pt.page);
      if (pRows.length > 0) {
        const pDrP = pRows.reduce((s, r) => s + r.debitPaise, 0);
        const pCrP = pRows.reduce((s, r) => s + r.creditPaise, 0);
        const ptDrP = Math.round(pt.debitTotal * 100);
        const ptCrP = Math.round(pt.creditTotal * 100);
        const matchOrder1 = Math.abs(pDrP - ptDrP) <= 5 && Math.abs(pCrP - ptCrP) <= 5;
        const matchOrder2 = Math.abs(pDrP - ptCrP) <= 5 && Math.abs(pCrP - ptDrP) <= 5;
        if (!matchOrder1 && !matchOrder2) {
          pageTotMismatch = true;
          unresolvedRows.push({
            rowIndex: null,
            page: pt.page,
            reason: `Page ${pt.page} printed total (₹${pt.debitTotal.toFixed(2)} / ₹${pt.creditTotal.toFixed(2)}) does not match page rows (Debits ₹${(pDrP / 100).toFixed(2)}, Credits ₹${(pCrP / 100).toFixed(2)})`,
          });
        }
      }
    }
    if (pageTotMismatch) completenessChecks.failed.push('per_page_totals');
    else completenessChecks.passed.push('per_page_totals');
  }

  const creditCount = transactions.filter((t) => t.creditPaise > 0).length;
  const debitCount = transactions.filter((t) => t.debitPaise > 0).length;
  if (
    accountInfo.printedDebitCount !== null ||
    accountInfo.printedCreditCount !== null ||
    accountInfo.printedTotalTxCount !== null
  ) {
    completenessChecks.available.push('printed_tx_counts');
    const drOk = accountInfo.printedDebitCount === null || accountInfo.printedDebitCount === debitCount;
    const crOk = accountInfo.printedCreditCount === null || accountInfo.printedCreditCount === creditCount;
    const totOk =
      accountInfo.printedTotalTxCount === null || accountInfo.printedTotalTxCount === transactions.length;
    if (drOk && crOk && totOk) {
      completenessChecks.passed.push('printed_tx_counts');
    } else {
      completenessChecks.failed.push('printed_tx_counts');
      unresolvedRows.push({
        rowIndex: null,
        page: null,
        reason: `Printed transaction count mismatch (printed: total=${accountInfo.printedTotalTxCount ?? 'N/A'}, dr=${accountInfo.printedDebitCount ?? 'N/A'}, cr=${accountInfo.printedCreditCount ?? 'N/A'} vs parsed: total=${transactions.length}, dr=${debitCount}, cr=${creditCount})`,
      });
    }
  }

  const openingBalance = openingBalancePaise / 100;
  const closingBalance = closingBalancePaise / 100;
  const transactionsFrom = transactions[0]?.date || null;
  const transactionsTo = transactions[transactions.length - 1]?.date || null;
  const printedFrom = accountInfo.printedFrom || null;
  const printedTo = accountInfo.printedTo || null;

  return {
    bankName: accountInfo.bankName,
    accountHolderName: accountInfo.accountHolderName,
    accountNumber: accountInfo.accountNumber,
    accountNumberMasked: accountInfo.accountNumberMasked,
    ifsc: accountInfo.ifsc,
    accountInfo,
    learnedColumns,
    printedFrom,
    printedTo,
    printedPeriod: printedFrom && printedTo ? `${printedFrom} → ${printedTo}` : 'Not printed on statement',
    transactionsFrom,
    transactionsTo,
    transactionsPeriod: transactionsFrom && transactionsTo ? `${transactionsFrom} → ${transactionsTo}` : 'N/A',
    statementFrom: printedFrom || transactionsFrom,
    statementTo: printedTo || transactionsTo,
    statementOrder: detectedOrder,
    openingBalancePaise,
    closingBalancePaise,
    totalCreditsPaise,
    totalDebitsPaise,
    openingBalance,
    closingBalance,
    exactOpeningBalance: openingBalance,
    exactClosingBalance: closingBalance,
    printedOpeningBalance: accountInfo.printedOpening,
    printedClosingBalance: accountInfo.printedClosing,
    printedTotalCredits: accountInfo.printedTotalCredits,
    printedTotalDebits: accountInfo.printedTotalDebits,
    totalCredits,
    totalDebits,
    creditCount,
    debitCount,
    chainBreaks,
    repairs,
    unresolvedRows,
    taintedPages: Array.from(taintedPagesSet),
    completenessChecks,
    expectedRowCount,
    transactions,
  };
}

module.exports = {
  normalizeDate,
  parseSignedAmountInfo,
  parseAmount,
  validateNarrationSanity,
  extractDistinctReferenceNumbers,
  mergeWrappedLines,
  cleanRowNarrationText,
  detectChronologicalOrder,
  detectColumnLayoutFromGeometry,
  reconstructRowsFromGeometry,
  preprocessLinesAndExtractPageMeta,
  extractAccountInfo,
  parseGenericStatement,
};
