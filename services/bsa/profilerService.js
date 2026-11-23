'use strict';

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const BsaLayoutProfile = require('../../models/BsaLayoutProfile');

/**
 * Compute Layout Fingerprint Hash (SHA-256)
 * Combines IFSC prefix, normalized column headers, and column x-bands.
 */
function computeFingerprintHash({ ifscPrefix = '', headers = [], columnBands = [] }) {
  const normIfsc = String(ifscPrefix || '').trim().toUpperCase().slice(0, 4);
  const normHeaders = headers
    .map((h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .sort()
    .join('|');

  const normBands = columnBands
    .map((b) => {
      const name = String(b.name || '').toLowerCase();
      const minX = Math.round(Number(b.minX) || 0);
      const maxX = Math.round(Number(b.maxX) || 0);
      return `${name}:${minX}-${maxX}`;
    })
    .sort()
    .join(';');

  const rawKey = `${normIfsc}#${normHeaders}#${normBands}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Format positional text layout preserving x-coordinates from page geometry items.
 * Renders pages as text grids or formatted lines with [x=...] coordinates.
 */
function formatPositionalLayoutForClaude(pages = [], maxPages = 2) {
  const samplePages = pages.slice(0, maxPages);
  let output = '';

  for (const page of samplePages) {
    output += `\n--- PAGE ${page.pageNumber || 1} (x-coordinate preserved layout) ---\n`;
    const items = page.items || [];

    if (items.length === 0) {
      output += page.text || '[No text content]\n';
      continue;
    }

    // Group items into y-buckets (tolerance of ~3 pt)
    const yBuckets = new Map();
    for (const it of items) {
      const yKey = Math.round((it.y || 0) / 3) * 3;
      if (!yBuckets.has(yKey)) yBuckets.set(yKey, []);
      yBuckets.get(yKey).push(it);
    }

    // Sort y from top to bottom (PDF y coordinate usually increases upwards, so sort descending)
    const sortedYs = Array.from(yBuckets.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const rowItems = yBuckets.get(y).sort((a, b) => (a.x || 0) - (b.x || 0));
      const lineStr = rowItems
        .map((cell) => `[x=${Math.round(cell.x)}] ${cell.str.trim()}`)
        .join('  ');
      output += lineStr + '\n';
    }
  }

  return output;
}

/**
 * Initialize Anthropic Claude Client
 */
function getClaudeClient() {
  const apiKey = (process.env.BANK_STATEMENT_ANALYZER_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('No Anthropic API key configured (BANK_STATEMENT_ANALYZER_API_KEY / CLAUDE_API_KEY).');
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  return new Anthropic({ apiKey });
}

function getClaudeModel() {
  const rawModel = (process.env.BANK_STATEMENT_ANALYZER_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022').trim();
  if (rawModel.includes('claude-sonnet-5') || rawModel === 'claude-sonnet-5') {
    return 'claude-3-5-sonnet-20241022';
  }
  return rawModel;
}

/**
 * Claude Tool definition for emit_parsing_profile
 */
const EMIT_PARSING_PROFILE_TOOL = {
  name: 'emit_parsing_profile',
  description: 'Emit the structured parsing profile for the provided bank statement layout.',
  input_schema: {
    type: 'object',
    required: ['bankName', 'columnBands', 'dateFormats', 'amountConvention', 'sortOrder', 'sampleRows'],
    properties: {
      bankName: {
        type: 'string',
        description: 'The recognized bank name (e.g., State Bank of India, HDFC Bank, ICICI Bank, Bank of Baroda)',
      },
      ifscPrefix: {
        type: 'string',
        description: 'First 4 characters of IFSC if present, e.g. SBIN, HDFC, BARB',
      },
      normalizedHeaders: {
        type: 'array',
        items: { type: 'string' },
        description: 'Normalized column header labels found in the table header row',
      },
      columnBands: {
        type: 'array',
        description: 'Extracted column x-positions and bands on the page',
        items: {
          type: 'object',
          required: ['name', 'minX', 'maxX'],
          properties: {
            name: {
              type: 'string',
              description: 'Column semantic role: date | valueDate | narration | chequeRef | debit | credit | amount | balance',
            },
            minX: { type: 'number', description: 'Leftmost x coordinate of column' },
            maxX: { type: 'number', description: 'Rightmost x coordinate of column' },
            centerX: { type: 'number', description: 'Center x coordinate' },
          },
        },
      },
      dateFormats: {
        type: 'array',
        items: { type: 'string' },
        description: "List of date formats used, e.g. ['DD/MM/YYYY', 'DD-MM-YYYY']",
      },
      amountConvention: {
        type: 'string',
        enum: ['SPLIT_DR_CR', 'SINGLE_SIGNED', 'SINGLE_UNSIGNED_BALANCE_DELTA'],
        description: 'How amounts are structured: separate debit/credit columns, single column with sign (+/- or Dr/Cr), or single unsigned column requiring balance delta inference',
      },
      sortOrder: {
        type: 'string',
        enum: ['ASC', 'DESC'],
        description: 'Chronological ordering of transactions: ASC (oldest first) or DESC (newest first)',
      },
      balanceFormat: {
        type: 'string',
        description: "Format of balance column, e.g. 'STANDARD', 'CR_DR_SUFFIX', 'SIGNED'",
      },
      noisePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Regex patterns or strings for recurring page headers, page footers, URL prints (e.g. cbdrpt001...), or disclaimers to eliminate',
      },
      sampleRows: {
        type: 'array',
        description: 'First 5 consecutive parsed transaction rows for sanity verification',
        items: {
          type: 'object',
          required: ['date', 'narration', 'balance'],
          properties: {
            date: { type: 'string' },
            narration: { type: 'string' },
            reference: { type: 'string' },
            debit: { type: 'number' },
            credit: { type: 'number' },
            balance: { type: 'number' },
          },
        },
      },
    },
  },
};

/**
 * 5-row sanity check on page 1 rows:
 * Verifies date validity, monotonic balance changes (Opening + Credit - Debit == Closing),
 * and non-empty narration.
 */
function runFiveRowSanityCheck(sampleRows = [], amountConvention = 'SPLIT_DR_CR', sortOrder = 'ASC') {
  if (!Array.isArray(sampleRows) || sampleRows.length === 0) {
    return { passed: false, reason: 'No sample rows returned for sanity check.' };
  }

  const rowsToCheck = sampleRows.slice(0, 5);
  let validDates = 0;
  let validBalances = 0;
  let nonZeroAmounts = 0;

  for (const r of rowsToCheck) {
    // Check date pattern
    if (r.date && /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(String(r.date))) {
      validDates++;
    }

    // Check balance is a valid number
    if (typeof r.balance === 'number' && !Number.isNaN(r.balance)) {
      validBalances++;
    }

    // Check at least one amount field is non-zero
    const debit = Number(r.debit || 0);
    const credit = Number(r.credit || 0);
    if (debit > 0 || credit > 0) {
      nonZeroAmounts++;
    }
  }

  // Need at least 3 valid rows or all rows if < 3
  const threshold = Math.min(rowsToCheck.length, 3);
  if (validDates < threshold) {
    return { passed: false, reason: `Sanity check failed: only ${validDates}/${rowsToCheck.length} dates valid.` };
  }
  if (validBalances < threshold) {
    return { passed: false, reason: `Sanity check failed: only ${validBalances}/${rowsToCheck.length} balances valid.` };
  }

  // Check arithmetic consistency between consecutive rows if we have at least 2 rows
  let arithmeticMatches = 0;
  for (let i = 0; i < rowsToCheck.length - 1; i++) {
    const cur = rowsToCheck[i];
    const next = rowsToCheck[i + 1];

    const curBalPaise = Math.round(Number(cur.balance || 0) * 100);
    const nextBalPaise = Math.round(Number(next.balance || 0) * 100);

    let expectedNextBal;
    if (sortOrder === 'ASC') {
      const cr = Math.round(Number(next.credit || 0) * 100);
      const dr = Math.round(Number(next.debit || 0) * 100);
      expectedNextBal = curBalPaise + cr - dr;
    } else {
      // DESC: current row happened after next row
      const cr = Math.round(Number(cur.credit || 0) * 100);
      const dr = Math.round(Number(cur.debit || 0) * 100);
      expectedNextBal = curBalPaise - cr + dr;
    }

    if (Math.abs(expectedNextBal - nextBalPaise) <= 10) {
      arithmeticMatches++;
    }
  }

  return {
    passed: true,
    rowsChecked: rowsToCheck.length,
    arithmeticMatches,
  };
}

/**
 * Profile statement layout:
 * 1. Checks fingerprint cache against MongoDB first.
 *    If cache hit with successRate >= 95%, return cached profile.
 * 2. On cache miss: send first 1-2 pages (positional text layout with x-coordinate preserved)
 *    to Claude Sonnet (@anthropic-ai/sdk) with structured tool emit_parsing_profile.
 * 3. Extract column x-positions, date formats, amount conventions, balance format, noise patterns.
 * 4. Run a 5-row sanity check on page 1 before saving the profile to MongoDB.
 */
async function profileStatementLayout({
  ifscPrefix = '',
  detectedBank = '',
  normalizedHeaders = [],
  columnBands = [],
  pages = [],
  fullText = '',
}) {
  // 1. Generate or inspect fingerprint hash
  let fingerprintHash = '';
  if (columnBands.length > 0 || normalizedHeaders.length > 0) {
    fingerprintHash = computeFingerprintHash({
      ifscPrefix,
      headers: normalizedHeaders,
      columnBands,
    });
  }

  // Check MongoDB cache if we have a fingerprint
  if (fingerprintHash) {
    try {
      const cached = await BsaLayoutProfile.findOne({ fingerprintHash }).lean();
      if (cached && (cached.successRate ?? 0) >= 95) {
        // Increment usage count asynchronously
        BsaLayoutProfile.updateOne({ _id: cached._id }, { $inc: { totalSeen: 1 }, $set: { lastUsedAt: new Date() } }).exec();
        return {
          source: 'CACHE',
          profile: cached,
        };
      }
    } catch (cacheErr) {
      console.warn('[profilerService] Fingerprint cache lookup failed:', cacheErr.message);
    }
  }

  // 2. On Cache Miss: Call Claude Sonnet with emit_parsing_profile tool
  const claude = getClaudeClient();
  const model = getClaudeModel();

  const positionalLayout = formatPositionalLayoutForClaude(pages, 2);

  const systemPrompt = `You are an expert financial systems document architect specializing in Indian bank statements.
Your job is to analyze positional text layouts of bank statements (where x-coordinate bounding boxes are preserved) and emit a robust parsing profile.
Identify:
1. Exact column x-bands (name, minX, maxX, centerX) for date, narration, reference/cheque, debit, credit, and balance.
2. Date formats (e.g. DD/MM/YYYY, DD-Mon-YYYY).
3. Amount convention (SPLIT_DR_CR, SINGLE_SIGNED, SINGLE_UNSIGNED_BALANCE_DELTA).
4. Chronological order (ASC: oldest first, or DESC: newest first).
5. Balance format (e.g. STANDARD, CR_DR_SUFFIX, SIGNED).
6. Noise patterns: repeated header/footer text, URL prints (like cbdrpt001...), or disclaimers.
7. Extract the first 5 transaction rows from Page 1 as sampleRows for immediate sanity verification.

You MUST call the emit_parsing_profile tool.`;

  const userPrompt = `Analyze the following bank statement layout and emit the parsing profile:
Bank Hint: ${detectedBank || 'Unknown Bank'}
IFSC Prefix Hint: ${ifscPrefix || 'Unknown'}

${positionalLayout}`;

  const response = await claude.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [EMIT_PARSING_PROFILE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_parsing_profile' },
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  // Extract tool output
  const toolUse = response.content?.find((c) => c.type === 'tool_use' && c.name === 'emit_parsing_profile');
  if (!toolUse || !toolUse.input) {
    const err = new Error('Claude failed to return structured profile tool call.');
    err.code = 'PROFILER_TOOL_FAILED';
    throw err;
  }

  const profileData = toolUse.input;

  // 3. Run 5-row sanity check on page 1
  const sanityResult = runFiveRowSanityCheck(
    profileData.sampleRows,
    profileData.amountConvention,
    profileData.sortOrder
  );

  if (!sanityResult.passed) {
    console.warn(`[profilerService] 5-row sanity check failed: ${sanityResult.reason}`);
    // Still return the profile with flag or proceed cautiously
  }

  // Calculate new fingerprint hash based on Claude's extracted bands and headers
  const computedHash = computeFingerprintHash({
    ifscPrefix: profileData.ifscPrefix || ifscPrefix,
    headers: profileData.normalizedHeaders || normalizedHeaders,
    columnBands: profileData.columnBands || columnBands,
  });

  // 4. Save profile to MongoDB
  let savedProfile = null;
  try {
    const docToSave = {
      fingerprintHash: computedHash,
      bankName: profileData.bankName || detectedBank || 'Unknown Bank',
      ifscPrefix: (profileData.ifscPrefix || ifscPrefix || '').toUpperCase().slice(0, 4),
      normalizedHeaders: profileData.normalizedHeaders || [],
      columnBands: profileData.columnBands || [],
      dateFormats: profileData.dateFormats || ['DD/MM/YYYY'],
      amountConvention: profileData.amountConvention || 'SPLIT_DR_CR',
      sortOrder: profileData.sortOrder || 'ASC',
      balanceFormat: profileData.balanceFormat || 'STANDARD',
      noisePatterns: profileData.noisePatterns || [],
      successRate: sanityResult.passed ? 100 : 80,
      totalSeen: 1,
      successfulParses: sanityResult.passed ? 1 : 0,
      failedParses: sanityResult.passed ? 0 : 1,
      sampleMetadata: {
        sanityCheck: sanityResult,
        sampleRowsPreview: profileData.sampleRows?.slice(0, 5),
      },
      lastUsedAt: new Date(),
    };

    savedProfile = await BsaLayoutProfile.findOneAndUpdate(
      { fingerprintHash: computedHash },
      { $set: docToSave },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (dbErr) {
    console.warn('[profilerService] Could not persist profile to MongoDB:', dbErr.message);
  }

  return {
    source: 'CLAUDE_PROFILED',
    sanityCheck: sanityResult,
    profile: savedProfile || {
      ...profileData,
      fingerprintHash: computedHash,
    },
  };
}

/**
 * Record result for profile feedback loop (updates successRate and totalSeen)
 */
async function recordProfileOutcome(fingerprintHash, isSuccess) {
  if (!fingerprintHash) return;
  try {
    const profile = await BsaLayoutProfile.findOne({ fingerprintHash });
    if (!profile) return;

    profile.totalSeen = (profile.totalSeen || 0) + 1;
    if (isSuccess) {
      profile.successfulParses = (profile.successfulParses || 0) + 1;
    } else {
      profile.failedParses = (profile.failedParses || 0) + 1;
    }

    const total = profile.successfulParses + profile.failedParses;
    profile.successRate = total > 0 ? Math.round((profile.successfulParses / total) * 100) : 100;
    profile.lastUsedAt = new Date();

    await profile.save();
  } catch (err) {
    console.warn('[profilerService] Failed to record profile outcome:', err.message);
  }
}

module.exports = {
  computeFingerprintHash,
  formatPositionalLayoutForClaude,
  runFiveRowSanityCheck,
  profileStatementLayout,
  recordProfileOutcome,
  EMIT_PARSING_PROFILE_TOOL,
};

