'use strict';

/**
 * Transparent Credit Underwriting Risk Scorecard Service
 *
 * Scoring Framework (Scale: 0 to 1000, Baseline: 700):
 *
 * 1. Income Stability:
 *    - CV < 30% (<= 0.30): Highly stable salary/cashflow (+100 points, GREEN)
 *    - CV 30% - 60% (0.30 - 0.60): Moderate fluctuation (+25 points, AMBER)
 *    - CV > 60% (> 0.60): High volatility (-100 points, RED)
 *
 * 2. Repayment Hygiene:
 *    - Deduct 100 points per EMI / Cheque / Mandate bounce event (RED)
 *    - Deduct 50 points per negative balance / overdrawn day event (RED)
 *    - If 0 bounces and 0 negative days: Flawless repayment hygiene (+50 points, GREEN)
 *
 * 3. Liquidity Buffer:
 *    - Ratio of Avg EOD Balance to Monthly Outflow:
 *      - Ratio >= 1.0 (Average balance covers 1+ month of expenses): Strong cushion (+75 points, GREEN)
 *      - Ratio 0.4 - 1.0: Adequate cushion (+25 points, AMBER)
 *      - Ratio < 0.4: Thin cushion (-50 points, RED)
 *    - Penalize high % of days < ₹1,000:
 *      - > 30% days below ₹1k (-40 points, AMBER/RED)
 *
 * 4. Circular / Rotation Money Penalties:
 *    - Each probable/suspicious rotation event: deduct 40 to 80 points depending on volume & count (RED)
 *    - If 0 circular transactions: Clean banking flow (+25 points, GREEN)
 *
 * 5. FOIR (Fixed Obligation to Income Ratio):
 *    - FOIR <= 40%: Healthy debt capacity (+50 points, GREEN)
 *    - FOIR 41% - 60%: Moderate debt burden (0 points, AMBER)
 *    - FOIR > 60%: Overleveraged borrower (-75 points, RED)
 *
 * Output:
 * - score: Final 0-1000 clamped score
 * - scoreBand: EXCELLENT (800+), GOOD (700-799), FAIR (600-699), POOR (<600)
 * - auditTrail: Array of { factor, finding, lender_impact, level, point_delta }
 */

const BASELINE_SCORE = 700;

function evaluateRiskScorecard(analyticsResult = {}) {
  const summary = analyticsResult.summary || {};
  const eodMetrics = analyticsResult.eodMetrics || {};
  const forensics = analyticsResult.forensics || {};

  const auditTrail = [];
  let currentScore = BASELINE_SCORE;

  // -------------------------------------------------------------
  // FACTOR 1: Income Stability (CV)
  // -------------------------------------------------------------
  const cv = summary.incomeStabilityCv !== undefined ? summary.incomeStabilityCv : 1.0;
  const genuineIncome = summary.monthlyGenuineIncome || 0;

  if (genuineIncome <= 0) {
    const delta = -150;
    currentScore += delta;
    auditTrail.push({
      factor: 'Income Stability',
      finding: 'No genuine monthly income identified after excluding self-transfers, reversals, and disbursals.',
      lender_impact: 'Extremely high risk of default due to lack of verified regular income.',
      level: 'RED',
      point_delta: delta,
    });
  } else if (cv <= 0.30) {
    const delta = 100;
    currentScore += delta;
    auditTrail.push({
      factor: 'Income Stability',
      finding: `Low income volatility: Coefficient of Variation is ${(cv * 100).toFixed(1)}% (below 30% threshold).`,
      lender_impact: 'Demonstrates consistent, highly predictable monthly income inflows.',
      level: 'GREEN',
      point_delta: delta,
    });
  } else if (cv <= 0.60) {
    const delta = 25;
    currentScore += delta;
    auditTrail.push({
      factor: 'Income Stability',
      finding: `Moderate income volatility: Coefficient of Variation is ${(cv * 100).toFixed(1)}% (between 30% and 60%).`,
      lender_impact: 'Variable monthly cashflows; borrower may require conservative FOIR buffers.',
      level: 'AMBER',
      point_delta: delta,
    });
  } else {
    const delta = -100;
    currentScore += delta;
    auditTrail.push({
      factor: 'Income Stability',
      finding: `High income volatility: Coefficient of Variation is ${(cv * 100).toFixed(1)}% (exceeds 60% threshold).`,
      lender_impact: 'Irregular or lumpy cashflows increase payment default risk during low-earning months.',
      level: 'RED',
      point_delta: delta,
    });
  }

  // -------------------------------------------------------------
  // FACTOR 2: Repayment Hygiene (Bounces & Negative Balance)
  // -------------------------------------------------------------
  const bounceEvents = forensics.reversalsAndBounces?.bounceEvents || [];
  const bounceCount = bounceEvents.length;

  if (bounceCount > 0) {
    const delta = -Math.min(300, bounceCount * 100);
    currentScore += delta;
    auditTrail.push({
      factor: 'Repayment Hygiene',
      finding: `${bounceCount} bounce/return charge(s) detected (NACH / ECS / Cheque return charges).`,
      lender_impact: 'Severe negative indicator reflecting payment dishonour and insufficient funds at debit time.',
      level: 'RED',
      point_delta: delta,
    });
  } else {
    const delta = 50;
    currentScore += delta;
    auditTrail.push({
      factor: 'Repayment Hygiene',
      finding: 'Zero cheque/mandate return or bounce charges observed.',
      lender_impact: 'Exemplary banking discipline and clean clearing track record.',
      level: 'GREEN',
      point_delta: delta,
    });
  }

  // Negative balance days check
  const minEod = eodMetrics.minEod !== undefined ? eodMetrics.minEod : 0;
  const negativeEodDays = (eodMetrics.eodSeries || []).filter((s) => s.balance < 0).length;

  if (negativeEodDays > 0 || minEod < 0) {
    const delta = -Math.min(150, negativeEodDays * 50);
    currentScore += delta;
    auditTrail.push({
      factor: 'Overdrawn / Negative Balance',
      finding: `Account balance fell below ₹0 on ${negativeEodDays} day(s) (Minimum balance: ₹${minEod}).`,
      lender_impact: 'Unauthorized overdrawn status indicates severe liquidity stress.',
      level: 'RED',
      point_delta: delta,
    });
  }

  // -------------------------------------------------------------
  // FACTOR 3: Liquidity Buffer
  // -------------------------------------------------------------
  const avgEod = eodMetrics.avgEod || 0;
  const avgMonthlyOutflow = summary.avgMonthlyOutflow || 1;
  const liquidityRatio = avgMonthlyOutflow > 0 ? parseFloat((avgEod / avgMonthlyOutflow).toFixed(2)) : 0;

  if (liquidityRatio >= 1.0) {
    const delta = 75;
    currentScore += delta;
    auditTrail.push({
      factor: 'Liquidity Buffer',
      finding: `Strong average balance: Avg EOD ₹${avgEod.toLocaleString('en-IN')} represents ${liquidityRatio}x monthly expenses.`,
      lender_impact: 'Substantial savings buffer to absorb unexpected financial shocks.',
      level: 'GREEN',
      point_delta: delta,
    });
  } else if (liquidityRatio >= 0.40) {
    const delta = 25;
    currentScore += delta;
    auditTrail.push({
      factor: 'Liquidity Buffer',
      finding: `Adequate liquidity: Avg EOD ₹${avgEod.toLocaleString('en-IN')} covers ${liquidityRatio}x monthly expenses.`,
      lender_impact: 'Sufficient working liquidity under normal operating conditions.',
      level: 'AMBER',
      point_delta: delta,
    });
  } else {
    const delta = -50;
    currentScore += delta;
    auditTrail.push({
      factor: 'Liquidity Buffer',
      finding: `Thin liquidity cushion: Avg EOD ₹${avgEod.toLocaleString('en-IN')} covers only ${liquidityRatio}x monthly expenses.`,
      lender_impact: 'Borrower operates on tight margins with minimal safety buffer.',
      level: 'RED',
      point_delta: delta,
    });
  }

  // Days below ₹1,000
  const pctBelow1k = eodMetrics.pctDaysBelow1k || 0;
  if (pctBelow1k > 30) {
    const delta = -40;
    currentScore += delta;
    auditTrail.push({
      factor: 'Low Balance Vulnerability',
      finding: `Account balance remained under ₹1,000 for ${pctBelow1k}% of calendar days.`,
      lender_impact: 'Frequent near-zero balances elevate the risk of recurring payment failures.',
      level: pctBelow1k > 50 ? 'RED' : 'AMBER',
      point_delta: delta,
    });
  }

  // -------------------------------------------------------------
  // FACTOR 4: Circular Transaction Penalties
  // -------------------------------------------------------------
  const circularEvents = forensics.circularAndSelf?.circularEvents || [];
  const circularCount = circularEvents.length;

  if (circularCount > 0) {
    const delta = -Math.min(120, circularCount * 40);
    currentScore += delta;
    auditTrail.push({
      factor: 'Circular Transactions / Pass-Through',
      finding: `${circularCount} rapid round-trip fund cycling event(s) detected within 48 hours.`,
      lender_impact: 'Pass-through funds inflate apparent turnover and must be discounted from genuine income.',
      level: 'RED',
      point_delta: delta,
    });
  } else {
    const delta = 25;
    currentScore += delta;
    auditTrail.push({
      factor: 'Circular Transactions / Pass-Through',
      finding: 'No circular money movement or rapid round-tripping identified.',
      lender_impact: 'Clean banking velocity with organic end-use spending.',
      level: 'GREEN',
      point_delta: delta,
    });
  }

  // -------------------------------------------------------------
  // FACTOR 5: Fixed Obligation to Income Ratio (FOIR)
  // -------------------------------------------------------------
  const foir = summary.foir;
  const emiTotal = summary.totalMonthlyEmi || 0;

  if (foir === null) {
    if (emiTotal > 0) {
      const delta = -30;
      currentScore += delta;
      auditTrail.push({
        factor: 'Debt Leverage / FOIR',
        finding: `Detected ₹${emiTotal.toLocaleString('en-IN')} in monthly EMIs, but genuine income could not be verified.`,
        lender_impact: 'Uncertain repayment capacity relative to ongoing debt commitments.',
        level: 'AMBER',
        point_delta: delta,
      });
    }
  } else if (foir <= 40) {
    const delta = 50;
    currentScore += delta;
    auditTrail.push({
      factor: 'Debt Leverage / FOIR',
      finding: `Healthy debt servicing: FOIR is ${foir}% (well within the safe 40% cap).`,
      lender_impact: 'Significant headroom available to service new loan obligations.',
      level: 'GREEN',
      point_delta: delta,
    });
  } else if (foir <= 60) {
    auditTrail.push({
      factor: 'Debt Leverage / FOIR',
      finding: `Moderate debt burden: FOIR is ${foir}% (between 40% and 60%).`,
      lender_impact: 'Borrower is moderately leveraged; limits capacity for substantial new credit.',
      level: 'AMBER',
      point_delta: 0,
    });
  } else {
    const delta = -75;
    currentScore += delta;
    auditTrail.push({
      factor: 'Debt Leverage / FOIR',
      finding: `High debt burden: FOIR is ${foir}% (exceeds conservative 60% threshold).`,
      lender_impact: 'Overleveraged borrower; heightened susceptibility to default under income disruptions.',
      level: 'RED',
      point_delta: delta,
    });
  }

  // Clamp final score strictly between 0 and 1000
  const finalScore = Math.max(0, Math.min(1000, Math.round(currentScore)));

  // Determine Score Band
  let scoreBand = 'FAIR';
  let ratingLabel = 'CONDITIONAL APPROVAL';
  if (finalScore >= 800) {
    scoreBand = 'EXCELLENT';
    ratingLabel = 'PRE-APPROVED / LOW RISK';
  } else if (finalScore >= 700) {
    scoreBand = 'GOOD';
    ratingLabel = 'APPROVED / STANDARD RISK';
  } else if (finalScore >= 600) {
    scoreBand = 'FAIR';
    ratingLabel = 'CONDITIONAL / ELEVATED RISK';
  } else {
    scoreBand = 'POOR';
    ratingLabel = 'DECLINE / HIGH RISK';
  }

  return {
    score: finalScore,
    baselineScore: BASELINE_SCORE,
    scoreBand,
    ratingLabel,
    totalFactorsEvaluated: auditTrail.length,
    auditTrail,
  };
}

module.exports = {
  BASELINE_SCORE,
  evaluateRiskScorecard,
};

