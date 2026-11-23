'use strict';

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Claude client initialization
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
 * Format Indian Rupees with commas
 */
function formatInr(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return '₹0.00';
  return `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Metric Placeholders Map:
 * Provides exact substitutions for templated placeholders {{metric_name}}
 */
function buildMetricPlaceholders(analytics = {}, scorecard = {}) {
  const summary = analytics.summary || {};
  const eod = analytics.eodMetrics || {};
  const forensics = analytics.forensics || {};
  const emiInfo = forensics.loansAndEmis || {};

  return {
    monthly_genuine_income: formatInr(summary.monthlyGenuineIncome),
    income_stability_cv: `${((summary.incomeStabilityCv || 0) * 100).toFixed(1)}%`,
    total_monthly_emi: formatInr(summary.totalMonthlyEmi || emiInfo.totalMonthlyEmi),
    foir: summary.foir !== null && summary.foir !== undefined ? `${summary.foir}%` : 'N/A',
    avg_eod_balance: formatInr(eod.avgEod),
    min_eod_balance: formatInr(eod.minEod),
    max_eod_balance: formatInr(eod.maxEod),
    days_below_1k_pct: `${eod.pctDaysBelow1k || 0}%`,
    days_below_10k_pct: `${eod.pctDaysBelow10k || 0}%`,
    total_credits: formatInr(summary.totalGrossCredits),
    total_debits: formatInr(summary.totalDebits),
    total_excluded_credits: formatInr(summary.totalExcludedCredits),
    credit_score: String(scorecard.score || 700),
    score_band: scorecard.scoreBand || 'GOOD',
    rating_label: scorecard.ratingLabel || 'STANDARD APPROVAL',
    bounce_count: String(forensics.reversalsAndBounces?.bounceEvents?.length || 0),
    circular_events_count: String(forensics.circularAndSelf?.circularEvents?.length || 0),
  };
}

/**
 * Replaces placeholders {{metric_name}} with exact verified numbers.
 */
function substitutePlaceholders(templateText = '', placeholders = {}) {
  if (!templateText) return '';
  let result = String(templateText);

  for (const [key, val] of Object.entries(placeholders)) {
    const rx = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(rx, val);
  }

  // Fallback for any unmatched {{...}} placeholder
  result = result.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, p1) => {
    return placeholders[p1] !== undefined ? placeholders[p1] : match;
  });

  return result;
}

/**
 * Deterministic Fallback Narrative Generator
 * (Used when Claude API key is absent, offline, or times out)
 */
function buildDeterministicFallbackNarrative(analytics = {}, scorecard = {}, placeholders = {}) {
  const summary = analytics.summary || {};
  const eod = analytics.eodMetrics || {};
  const forensics = analytics.forensics || {};
  const emiInfo = forensics.loansAndEmis || {};
  const bounces = forensics.reversalsAndBounces?.bounceEvents || [];
  const circulars = forensics.circularAndSelf?.circularEvents || [];

  const incomeStr = placeholders.monthly_genuine_income;
  const emiStr = placeholders.total_monthly_emi;
  const foirStr = placeholders.foir;
  const score = placeholders.credit_score;

  let persona = 'Salaried / Steady Professional';
  if ((summary.incomeStabilityCv || 0) > 0.40) {
    persona = 'Self-Employed / Variable Earner';
  } else if ((forensics.circularAndSelf?.circularEvents || []).length > 2) {
    persona = 'High-Velocity Trading / Rotation Profile';
  }

  const execSummary = `Borrower demonstrates genuine monthly income of ${incomeStr} with an income stability CV of ${placeholders.income_stability_cv}. Total detected monthly EMI obligations are ${emiStr}, yielding a FOIR of ${foirStr}. Average daily liquidity stands at ${placeholders.avg_eod_balance}. Overall underwriting credit risk score is evaluated at ${score}/1000 (${scorecard.scoreBand || 'GOOD'}).`;

  const behavioralPersona = `The borrower exhibits characteristics of a ${persona}. Cash inflows are predominantly received through electronic channels with regular monthly debits for household, utility, and debt obligations. Account balances remained under ₹1,000 for ${placeholders.days_below_1k_pct} of observed calendar days.`;

  const amlObservations = circulars.length > 0
    ? `${circulars.length} rapid fund rotation/pass-through events were detected within 48-hour turnover windows. Inflows were closely matched by near-instantaneous outflows, warranting secondary proof of funds verification.`
    : `No rapid circular money transfers, structuring, or pass-through patterns were observed across the audited period. Fund flow velocity appears organic.`;

  const keyLenderConditions = [
    bounces.length > 0 ? `Obtain written justification and clearance certificates for ${bounces.length} return/bounce charges.` : 'Zero cheque/ECS return charges confirmed.',
    (summary.foir || 0) > 50 ? `Strict 50% FOIR cap enforcement: cap additional monthly EMI at ₹${Math.max(0, Math.round((summary.monthlyGenuineIncome * 0.5) - (summary.totalMonthlyEmi || 0))).toLocaleString('en-IN')}.` : 'FOIR is within standard institutional guidelines (<50%).',
    'Mandatory NACH / e-Mandate registration for all scheduled debt collections.',
    'Verification of ongoing employment/business operations prior to final disbursement.',
  ];

  return {
    executiveUnderwritingSummary: execSummary,
    borrowerBehavioralPersona: behavioralPersona,
    amlObservations,
    keyLenderConditions,
  };
}

/**
 * Generate Qualitative Underwriting Narrative
 *
 * Rules:
 * 1. Sends ONLY pre-aggregated statistics, anomalies, and transaction IDs (never raw statement pages).
 * 2. Prompts Claude for executive underwriting summary, behavioral persona, AML observations, and lender conditions.
 * 3. Enforces prompt guard: Claude must reference numbers only via templated placeholders {{metric_name}}.
 * 4. Substitutes placeholders with guaranteed pre-calculated numbers.
 */
async function generateQualitativeNarrative(analytics = {}, scorecard = {}, options = {}) {
  const placeholders = buildMetricPlaceholders(analytics, scorecard);
  const summary = analytics.summary || {};
  const forensics = analytics.forensics || {};

  // Build compact pre-aggregated context
  const preAggregatedPayload = {
    income: {
      totalGrossCredits: summary.totalGrossCredits,
      totalExcludedCredits: summary.totalExcludedCredits,
      monthlyGenuineIncome: summary.monthlyGenuineIncome,
      incomeStabilityCv: summary.incomeStabilityCv,
    },
    obligations: {
      totalMonthlyEmi: summary.totalMonthlyEmi,
      foir: summary.foir,
      detectedLenders: (forensics.loansAndEmis?.detectedEmis || []).map((e) => ({
        lender: e.lenderName,
        monthlyEmi: e.monthlyEmi,
        confidence: e.confidence,
      })),
    },
    liquidity: {
      avgEod: analytics.eodMetrics?.avgEod,
      minEod: analytics.eodMetrics?.minEod,
      pctDaysBelow1k: analytics.eodMetrics?.pctDaysBelow1k,
    },
    forensics: {
      bounceChargesCount: forensics.reversalsAndBounces?.bounceEvents?.length || 0,
      circularEventsCount: forensics.circularAndSelf?.circularEvents?.length || 0,
      selfTransfersCount: forensics.circularAndSelf?.selfTransfers?.length || 0,
    },
    scorecard: {
      score: scorecard.score,
      scoreBand: scorecard.scoreBand,
      ratingLabel: scorecard.ratingLabel,
      auditFactors: (scorecard.auditTrail || []).map((a) => `${a.factor}: ${a.finding} (${a.level})`),
    },
  };

  // Check if live Claude should be called
  if (options.useLiveClaude === false || (!process.env.BANK_STATEMENT_ANALYZER_API_KEY && !process.env.CLAUDE_API_KEY)) {
    return buildDeterministicFallbackNarrative(analytics, scorecard, placeholders);
  }

  try {
    const claude = getClaudeClient();
    const model = getClaudeModel();

    const systemPrompt = `You are an elite credit underwriting and risk assessment officer for commercial and retail lending.
You review pre-aggregated financial statistics and write concise, professional credit intelligence narratives.

STRICT NUMERICAL GUARD RULES:
1. NEVER output raw currency numbers or percentages directly in your text.
2. ALWAYS use the exact templated placeholders below whenever referencing numbers:
   - Genuine Monthly Income: {{monthly_genuine_income}}
   - Income Volatility / Stability: {{income_stability_cv}}
   - Monthly EMI Obligation: {{total_monthly_emi}}
   - Debt FOIR: {{foir}}
   - Average Daily Balance / EOD: {{avg_eod_balance}}
   - Minimum EOD Balance: {{min_eod_balance}}
   - Days Below ₹1,000: {{days_below_1k_pct}}
   - Credit Risk Score: {{credit_score}}
   - Bounce Count: {{bounce_count}}
   - Circular Events Count: {{circular_events_count}}

Return a structured JSON object with keys:
- executiveUnderwritingSummary (string)
- borrowerBehavioralPersona (string)
- amlObservations (string)
- keyLenderConditions (array of strings)`;

    const userPrompt = `Here are the pre-aggregated metrics and forensic findings for the borrower:
${JSON.stringify(preAggregatedPayload, null, 2)}

Generate the underwriting narrative adhering strictly to the templated placeholder rules.`;

    const response = await claude.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const replyText = response.content?.[0]?.text || '';
    const jsonMatch = replyText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain valid JSON narrative object.');
    }

    const parsedNarrative = JSON.parse(jsonMatch[0]);

    // Replace templated placeholders with exact audited numbers
    return {
      executiveUnderwritingSummary: substitutePlaceholders(parsedNarrative.executiveUnderwritingSummary, placeholders),
      borrowerBehavioralPersona: substitutePlaceholders(parsedNarrative.borrowerBehavioralPersona, placeholders),
      amlObservations: substitutePlaceholders(parsedNarrative.amlObservations, placeholders),
      keyLenderConditions: (parsedNarrative.keyLenderConditions || []).map((c) => substitutePlaceholders(c, placeholders)),
    };
  } catch (err) {
    console.warn('[narrativeService] Claude qualitative narrative generation failed, using deterministic fallback:', err.message);
    return buildDeterministicFallbackNarrative(analytics, scorecard, placeholders);
  }
}

module.exports = {
  buildMetricPlaceholders,
  substitutePlaceholders,
  buildDeterministicFallbackNarrative,
  generateQualitativeNarrative,
};

