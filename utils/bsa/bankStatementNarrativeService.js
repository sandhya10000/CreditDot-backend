const Anthropic = require('@anthropic-ai/sdk');

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    const apiKey = (process.env.BANK_STATEMENT_ANALYZER_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY / BANK_STATEMENT_ANALYZER_API_KEY is missing');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getNarrativeModel() {
  return (
    process.env.BANK_STATEMENT_NARRATIVE_MODEL ||
    process.env.BANK_STATEMENT_ANALYZER_MODEL ||
    'claude-haiku-5-5'
  ).trim();
}

function formatInrNum(n) {
  const val = Number(n || 0);
  const absStr = Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return val < 0 ? `-₹${absStr}` : `₹${absStr}`;
}

/**
 * Extracts numbers mentioned in text so we can verify every numeric claim against analytics.
 */
function extractMentionedNumbers(text) {
  const str = String(text || '');
  const matches = str.match(/(?:₹\s*)?-?\d[\d,]*(?:\.\d+)?%?/g) || [];
  return matches
    .map((m) => {
      const isPercent = m.endsWith('%');
      const cleaned = m.replace(/[₹,\s%]/g, '');
      const val = parseFloat(cleaned);
      return Number.isFinite(val) ? { raw: m.trim(), val, isPercent } : null;
    })
    .filter(Boolean);
}

/**
 * Collects all valid reference numbers from analytics payload so we can check narrative accuracy.
 */
function buildAllowedNumberSet(analytics) {
  const allowed = new Set();
  const addNum = (n) => {
    if (typeof n === 'number' && Number.isFinite(n)) {
      allowed.add(Number(n.toFixed(2)));
      allowed.add(Math.round(n));
      allowed.add(Math.abs(Number(n.toFixed(2))));
      allowed.add(Math.abs(Math.round(n)));
    }
  };

  const k = analytics.kpis || {};
  Object.values(k).forEach((v) => {
    if (typeof v === 'number') addNum(v);
  });

  if (k.foirCap !== null && k.foirCap !== undefined) {
    addNum(k.foirCap * 100);
  }
  if (analytics.salaryCheckEvidence) {
    addNum(analytics.salaryCheckEvidence.medianAmount);
    addNum((analytics.salaryCheckEvidence.months || []).length);
  }

  for (const m of analytics.monthlySummary || analytics.monthlyCashFlow || []) {
    addNum(m.credits);
    addNum(m.debits);
    addNum(m.netFlow);
    addNum(m.avgEod);
    addNum(m.minEod);
    addNum(m.closingBalance);
    addNum(m.txCount);
    addNum(m.daysCovered);
  }

  for (const c of analytics.categories?.debits || []) {
    addNum(c.total);
    addNum(c.pct);
    addNum(c.count);
  }
  for (const c of analytics.categories?.credits || []) {
    addNum(c.total);
    addNum(c.pct);
    addNum(c.count);
  }
  for (const o of analytics.obligations || analytics.recurringObligations || []) {
    addNum(o.monthlyAmount);
    addNum(o.amount);
    addNum(o.totalAmount);
    addNum(o.totalPaid);
    addNum(o.count);
  }
  for (const o of analytics.otherLoanInsurancePayments || []) {
    addNum(o.amount);
    addNum(o.totalPaid);
    addNum(o.count);
  }
  for (const ce of analytics.circularEvents || analytics.flaggedCircularEvents || []) {
    addNum(ce.creditAmount);
    addNum(ce.debitAmount);
    addNum(ce.pctOut);
  }
  for (const rot of analytics.creditCardRotations || []) {
    addNum(rot.creditAmount);
    addNum(rot.debitAmount);
    addNum(rot.pctRepaid);
    addNum(rot.hoursElapsed);
  }
  for (const b of analytics.bounceEvents || []) {
    addNum(b.chargeAmount);
    addNum(b.amount);
  }
  if (analytics.internalMovements) {
    addNum(analytics.internalMovements.count);
    addNum(analytics.internalMovements.totalCredits);
    addNum(analytics.internalMovements.totalDebits);
  }
  for (const b of analytics.excludedCreditBuckets || k.excludedCreditBuckets || []) {
    addNum(b.amount);
    addNum(b.count);
  }
  if (analytics.amlIndicators) {
    addNum(analytics.amlIndicators.rapidMovementCount);
    addNum(analytics.amlIndicators.structuringCashCount);
    addNum(analytics.amlIndicators.roundFigureSpikeCount);
  }

  for (let i = 0; i <= 31; i++) allowed.add(i);
  allowed.add(48);
  allowed.add(50);
  allowed.add(60);
  allowed.add(80);
  allowed.add(90);
  allowed.add(100);

  return allowed;
}

/**
 * Validates that every number or claim in the narrative matches the computed metrics.
 */
function verifyNarrativeClaims(parsed, analytics) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.executive_summary || !Array.isArray(parsed.key_strengths) || !Array.isArray(parsed.key_concerns)) {
    return false;
  }

  const k = analytics.kpis || {};
  const allText = [
    parsed.executive_summary,
    ...parsed.key_strengths,
    ...parsed.key_concerns,
    parsed.recommendation_note || '',
  ].join(' ');

  if ((k.emiBounces || 0) > 0 && /\b(?:zero|0|no)\s+(?:emi\s+)?(?:bounces?|returns?|dishonou?rs?)\b/i.test(allText)) {
    return false;
  }

  if (
    ((k.negativeBalanceDays || 0) > 0 || (k.minBalance || 0) < 0) &&
    /\b(?:no\s+overdraft|never\s+(?:went\s+)?negative|always\s+positive\s+balance|zero\s+overdrawn\s+days)\b/i.test(allText)
  ) {
    return false;
  }

  if (
    ((k.negativeBalanceDays || 0) > 0 || (k.minBalance || 0) < 0) &&
    !/\b(?:negative|overdrawn|overdraft|od\b)/i.test(allText)
  ) {
    return false;
  }

  const allowed = buildAllowedNumberSet(analytics);
  const mentioned = extractMentionedNumbers(allText);

  for (const item of mentioned) {
    if (item.val >= 2020 && item.val <= 2035 && Number.isInteger(item.val)) continue;

    let matched = false;
    for (const ref of allowed) {
      if (Math.abs(item.val - ref) <= Math.max(1, Math.abs(ref) * 0.015)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }

  return true;
}

/**
 * Deterministic fallback narrative built exclusively from computed engine metrics.
 */
function buildFallbackNarrative(analytics) {
  const k = analytics.kpis || {};
  const verdict = analytics.verdict || {};
  const sal = analytics.salaryCheckEvidence || {};
  const strengths = [];
  const concerns = [];

  const observedObligationsCount =
    (analytics.obligations || analytics.recurringObligations || []).length +
    (analytics.otherLoanInsurancePayments || []).filter((o) => o.isLoanEvidence).length;

  if ((k.emiBounces || 0) > 0 || (k.returnChargesCount || 0) > 0) {
    const bounceCount = k.emiBounces || 0;
    const sampleMandates = (analytics.bounceEvents || [])
      .slice(0, 3)
      .map((b) => `${b.bounceType}${b.mandate ? ` (${b.mandate})` : ''} on ${b.date}`)
      .join('; ');
    concerns.push(
      `${bounceCount} confirmed bounce/return event(s) and ${k.returnChargesCount || 0} return/penalty charge event(s) totaling ${formatInrNum(k.returnChargesTotal || 0)} detected${sampleMandates ? `: ${sampleMandates}` : ''}.`
    );
  } else if (observedObligationsCount > 0) {
    strengths.push(
      `No bounce or return events recorded across ${observedObligationsCount} observed obligation(s).`
    );
  }

  if (sal.detected) {
    strengths.push(sal.evidence);
  }

  if ((k.negativeBalanceDays || 0) > 0 || (k.minBalance || 0) < 0) {
    concerns.push(
      `Account balance went negative (overdrawn / OD facility usage) for ${k.negativeBalanceDays || 0} calendar day(s) (${k.negativeBalanceDaysPct || '0%'} of period), reaching a minimum balance of ${formatInrNum(k.minBalance || 0)}.`
    );
  } else if ((k.abbToEmiRatio || 0) >= 1.5) {
    strengths.push(
      `Strong liquidity cushion with Average Bank Balance (${formatInrNum(k.abb)}) at ${k.abbToEmiRatio}x of monthly obligations and a minimum balance of ${formatInrNum(k.minBalance || 0)}.`
    );
  }

  if (k.foirNumeric !== null && k.foirNumeric !== undefined) {
    if (k.foirNumeric <= 40) {
      strengths.push(
        `Healthy Fixed Obligation to Income Ratio (FOIR) of ${k.foirNumeric}% against estimated monthly income of ${formatInrNum(k.estimatedMonthlyIncome)}.`
      );
    } else if (k.foirNumeric > 50) {
      concerns.push(
        `Elevated FOIR of ${k.foirNumeric}% with monthly obligations of ${formatInrNum(k.monthlyObligation)} against estimated monthly income of ${formatInrNum(k.estimatedMonthlyIncome)}.`
      );
    }
  } else if ((k.monthlyObligation || 0) > 0) {
    concerns.push(
      `Recurring monthly obligations of ${formatInrNum(k.monthlyObligation)} observed, but insufficient full-month history to establish FOIR (FOIR: Not available).`
    );
  } else if (!sal.detected) {
    concerns.push('No verified recurring monthly salary or corporate payroll credits identified across full statement months.');
  }

  if ((k.netCashFlow || 0) >= 0) {
    strengths.push(
      `Positive net cash flow of ${formatInrNum(k.netCashFlow)} across ${k.totalTransactions || 0} transactions (${k.creditCount || 0} credits, ${k.debitCount || 0} debits).`
    );
  } else {
    concerns.push(
      `Negative net cash flow of ${formatInrNum(k.netCashFlow)} over the statement period (${formatInrNum(k.totalCredits)} credits vs ${formatInrNum(k.totalDebits)} debits).`
    );
  }

  if ((k.circularCreditTotal || 0) > 0) {
    concerns.push(
      `Pass-through / circular turnover of ${formatInrNum(k.circularCreditTotal)} (${k.circularPctOfCredits || 0}% of total credits) identified and excluded from genuine income.`
    );
  }

  if ((analytics.creditCardRotations?.length || 0) > 0) {
    concerns.push(
      `${analytics.creditCardRotations.length} credit-card rotation pattern(s) totaling ${formatInrNum(k.creditCardRotationTotal || 0)} detected (card-related credits followed within 48 hours by card bill payments >= 80%) and excluded from genuine income.`
    );
  }

  if ((analytics.internalMovements?.count || 0) > 0) {
    strengths.push(
      `${analytics.internalMovements.count} internal/own-money movement(s) (sweep/FD/own-account transfers totaling ${formatInrNum(analytics.internalMovements.totalCredits)} in credits and ${formatInrNum(analytics.internalMovements.totalDebits)} in debits) were separated from genuine income and pass-through scoring.`
    );
  }

  if (k.insufficientHistory) {
    concerns.push(
      `Statement covers only ${k.distinctCalendarDays || 0} calendar days (${k.fullMonthsCount || 0} full month(s)); assessment is capped due to insufficient history.`
    );
  }

  if (strengths.length === 0) {
    strengths.push(
      `Reconciled ledger of ${k.totalTransactions || 0} transactions with closing balance of ${formatInrNum(k.closingBalance)}.`
    );
  }
  if (concerns.length === 0) {
    concerns.push('No major transactional anomalies, bounces, or overdraft breaks identified in the analyzed window.');
  }

  const overdrawnSummaryClause =
    (k.negativeBalanceDays || 0) > 0 || (k.minBalance || 0) < 0
      ? ` The account experienced negative/overdrawn balances on ${k.negativeBalanceDays || 0} calendar day(s) with a minimum balance of ${formatInrNum(k.minBalance || 0)}.`
      : '';

  const execSummary = `Across ${k.distinctCalendarDays || 0} calendar days (${k.monthsCovered || 0} month(s)), the account recorded ${k.totalTransactions || 0} transactions with total credits of ${formatInrNum(k.totalCredits)}, total debits of ${formatInrNum(k.totalDebits)}, and a closing balance of ${formatInrNum(k.closingBalance)}. Average Bank Balance stands at ${formatInrNum(k.abb)} with ${k.emiBounces || 0} bounce(s).${overdrawnSummaryClause}`;

  const recNote =
    k.foirCap !== null && k.foirCap !== undefined && k.estimatedMonthlyIncome > 0
      ? `Overall risk assessment is ${verdict.label || k.verdict || 'CAUTIOUS'}. At a ${Math.round(k.foirCap * 100)}% FOIR cap on verified monthly income of ${formatInrNum(k.estimatedMonthlyIncome)}, maximum total monthly obligation capacity is ${formatInrNum(k.maxEmiCapacity)} (incremental headroom: ${formatInrNum(k.availableEmiCapacity)}).`
      : `Overall risk assessment is ${verdict.label || k.verdict || 'CAUTIOUS'}. Manual income verification is recommended before sanctioning credit exposure (${(verdict.reasons || [])[0] || k.verdictReason || 'refer to scorecard'}).`;

  return {
    executive_summary: execSummary,
    key_strengths: strengths.slice(0, 4),
    key_concerns: concerns.slice(0, 5),
    recommendation_note: recNote,
  };
}

async function generateNarrative(analytics) {
  const fallback = buildFallbackNarrative(analytics);

  const payload = {
    account: analytics.account,
    kpis: analytics.kpis,
    verdict: analytics.verdict,
    salaryCheckEvidence: analytics.salaryCheckEvidence,
    scorecard: analytics.scorecard?.rows || analytics.scorecard,
    topDebitCategories: (analytics.categories?.debits || []).slice(0, 5),
    topCreditCategories: (analytics.categories?.credits || []).slice(0, 5),
    obligations: analytics.obligations,
    otherLoanInsurancePayments: analytics.otherLoanInsurancePayments,
    circularEventsCount: (analytics.circularEvents || []).length,
    creditCardRotationsCount: (analytics.creditCardRotations || []).length,
    bounceEventsCount: (analytics.bounceEvents || []).length,
    internalMovements: analytics.internalMovements
      ? {
          count: analytics.internalMovements.count,
          totalCredits: analytics.internalMovements.totalCredits,
          totalDebits: analytics.internalMovements.totalDebits,
        }
      : null,
  };

  const prompt = `You are a senior credit underwriter writing an executive narrative for an Indian Bank Statement Analysis report.
You are given ONLY pre-computed financial analytics in JSON.
Do NOT invent, estimate, or extrapolate any numbers that are not explicitly present in the JSON.
Every single number you cite MUST appear in the JSON input.
If kpis.negativeBalanceDays > 0 or kpis.minBalance < 0, you MUST explicitly state in executive_summary and key_concerns that negative/overdrawn balances occurred, citing negativeBalanceDays and minBalance.
If kpis.emiBounces > 0, you MUST cite the bounce count in key_concerns and never claim zero bounces.
If kpis.foir is null, state that FOIR is N/A because verified monthly income was not established.
If kpis.insufficientHistory is true, note that the statement history is under 3 full months.

Input JSON:
${JSON.stringify(payload, null, 2)}

Return ONLY valid JSON with this exact structure (no markdown fences):
{
  "executive_summary": "2-3 sentence factual overview citing exact numbers from kpis (including negative balance days and minBalance if negative)",
  "key_strengths": ["2-3 bullet strings citing exact figures from the JSON"],
  "key_concerns": ["2-4 bullet strings citing exact figures from the JSON"],
  "recommendation_note": "1-2 sentence underwriting recommendation consistent with verdict.label and kpis.foirCap"
}`;

  try {
    const client = getAnthropicClient();
    const claudeCall = client.messages.create({
      model: getNarrativeModel(),
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const timeoutGuard = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
    const response = await Promise.race([claudeCall, timeoutGuard]);

    if (!response) {
      console.warn('[bsa-narrative] Haiku call reached 8s timeout limit. Using instant deterministic synthesis.');
      return fallback;
    }

    const text = response.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallback;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!verifyNarrativeClaims(parsed, analytics)) {
      console.warn('[bsaNarrative] AI narrative failed claim verification; using deterministic narrative.');
      return fallback;
    }
    return parsed;
  } catch (err) {
    console.warn(`[bsa-narrative] Failed to generate AI narrative (${err.message}). Using deterministic fallback.`);
    return fallback;
  }
}

module.exports = {
  generateNarrative,
  buildFallbackNarrative,
  verifyNarrativeClaims,
};
