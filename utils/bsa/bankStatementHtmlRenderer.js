/**
 * utils/bankStatementHtmlRenderer.js
 *
 * Professional Credit Intelligence Report Renderer for CreditDost BSA.
 * Structured into 18 standardized sections + Appendix matching the reference layout.
 * Print-safe for A4 PDF export via Puppeteer.
 */

const fs = require('fs');
const path = require('path');

// Cache Base64 Logo for inline rendering in PDF
let cachedLogoBase64 = null;
function getLogoBase64() {
  if (cachedLogoBase64 === null) {
    try {
      const logoPath = path.join(__dirname, '..', 'LOGO_1.png');
      if (fs.existsSync(logoPath)) {
        cachedLogoBase64 = fs.readFileSync(logoPath).toString('base64');
      } else {
        cachedLogoBase64 = '';
      }
    } catch (e) {
      cachedLogoBase64 = '';
    }
  }
  return cachedLogoBase64;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInr(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return 'N/A';
  const val = Number(n);
  const absFormatted = Math.abs(val).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return val < 0 ? `-₹${absFormatted}` : `₹${absFormatted}`;
}

/**
 * Supports both calling conventions:
 * 1) renderBankStatementReportHtml({ extractedData, analytics, narrative, classifiedTransactions, reportMetadata })
 * 2) renderBankStatementReportHtml(analytics, narrative, meta)
 */
function renderBankStatementReportHtml(arg1, arg2, arg3 = {}) {
  let analytics = arg1;
  let narrative = arg2;
  let meta = arg3;
  let extractedData = null;
  let classifiedTxsOverride = null;

  if (arg1 && typeof arg1 === 'object' && arg1.analytics) {
    analytics = arg1.analytics;
    narrative = arg1.narrative;
    extractedData = arg1.extractedData || null;
    classifiedTxsOverride = arg1.classifiedTransactions || null;
    meta = arg1.reportMetadata || arg3 || {};
  }

  const acc = analytics.account || analytics.accountInfo || {};
  const k = analytics.kpis || {};

  // Synchronized Scorecard and Verdict
  const scorecard = Array.isArray(analytics.scorecard)
    ? analytics.scorecard
    : analytics.scorecard?.rows || [];

  const redCount = analytics.redCount ?? analytics.scorecard?.redCount ?? scorecard.filter((r) => r.level === 'RED' || r.status === 'RED').length;
  const amberCount = analytics.amberCount ?? analytics.scorecard?.amberCount ?? scorecard.filter((r) => r.level === 'AMBER' || r.status === 'AMBER').length;
  const greenCount = analytics.greenCount ?? analytics.scorecard?.greenCount ?? scorecard.filter((r) => r.level === 'GREEN' || r.status === 'GREEN').length;
  const neutralCount = analytics.neutralCount ?? analytics.scorecard?.neutralCount ?? scorecard.filter((r) => r.level === 'NEUTRAL' || r.status === 'NEUTRAL').length;

  const verdict = analytics.verdict || {
    status: redCount >= 1 ? 'RED' : (amberCount >= 2 || k.insufficientHistory ? 'AMBER' : 'GREEN'),
    label: k.verdict || (redCount >= 1 ? 'CAUTION — ENHANCED DUE DILIGENCE' : (amberCount >= 2 || k.insufficientHistory ? 'CONDITIONAL APPROVAL' : 'LOW RISK / APPROVED')),
    reasons: [k.verdictReason || ''],
  };

  const monthly = analytics.monthlySummary || analytics.monthlyCashFlow || [];
  const debitCats = analytics.categories?.debits || [];
  const creditCats = analytics.categories?.credits || [];
  const obligations = analytics.obligations || analytics.recurringObligations || [];
  const oneTimeObligations = analytics.otherLoanInsurancePayments || [];
  const circularEvents = analytics.circularEvents || analytics.flaggedCircularEvents || [];
  const creditCardRotations = analytics.creditCardRotations || [];
  const bounceEvents = analytics.bounceEvents || [];
  const cashPassThroughEvents = analytics.cashPassThroughEvents || [];
  const internalMovements = Array.isArray(analytics.internalMovements)
    ? {
        count: analytics.internalMovements.length,
        totalCredits: k.totalInternalCredits || 0,
        totalDebits: k.totalInternalDebits || 0,
        items: analytics.internalMovements,
      }
    : analytics.internalMovements || { count: 0, totalCredits: 0, totalDebits: 0, items: [] };
  const salaryCheck = analytics.salaryCheckEvidence || {};
  const relatedParties = analytics.relatedParties || [];
  const topCredits = analytics.topTransactions?.credits || [];
  const topDebits = analytics.topTransactions?.debits || [];
  const aml = analytics.amlIndicators || {};
  const txs = classifiedTxsOverride || analytics.transactions || extractedData?.transactions || [];

  const topInflowModes = analytics.topInflowModes || [];
  const topOutflowModes = analytics.topOutflowModes || [];
  const topIncomeSources = analytics.topIncomeSources || [];
  const topOutflowDestinations = analytics.topOutflowDestinations || [];
  const excludedBuckets = analytics.excludedCreditBuckets || k.excludedCreditBuckets || [];

  const verdictColor =
    verdict.status === 'GREEN'
      ? { bg: '#ecfdf5', border: '#10b981', text: '#065f46', badge: '#059669' }
      : verdict.status === 'RED'
      ? { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', badge: '#dc2626' }
      : { bg: '#fffbeb', border: '#f59e0b', text: '#92400e', badge: '#d97706' };

  const statusPill = (status) => {
    const map = {
      GREEN: { bg: '#d1fae5', text: '#065f46', label: 'GREEN' },
      AMBER: { bg: '#fef3c7', text: '#92400e', label: 'AMBER' },
      RED: { bg: '#fee2e2', text: '#991b1b', label: 'RED' },
      NEUTRAL: { bg: '#e2e8f0', text: '#334155', label: 'NEUTRAL' },
    };
    const s = map[status] || map.AMBER;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${s.bg};color:${s.text};">${s.label}</span>`;
  };

  const printedPeriodStr =
    acc.printedPeriod && acc.printedPeriod !== 'Not printed on statement'
      ? escapeHtml(acc.printedPeriod)
      : acc.printedPeriodFrom || acc.printedPeriodTo
      ? `${escapeHtml(acc.printedPeriodFrom || 'N/A')} to ${escapeHtml(acc.printedPeriodTo || 'N/A')}`
      : 'Not printed on statement';

  const txPeriodStr =
    acc.transactionsPeriod && acc.transactionsPeriod !== 'N/A'
      ? escapeHtml(acc.transactionsPeriod)
      : acc.transactionsFrom || acc.transactionsTo
      ? `${escapeHtml(acc.transactionsFrom || 'N/A')} to ${escapeHtml(acc.transactionsTo || 'N/A')}`
      : `${escapeHtml(acc.periodFrom || 'N/A')} to ${escapeHtml(acc.periodTo || 'N/A')}`;

  const foirDisplay =
    k.foirNumeric !== null && k.foirNumeric !== undefined ? `${k.foirNumeric}%` : 'N/A (Insufficient history / no loans)';
  const maxEmiDisplay =
    k.foirCap !== null && k.foirCap !== undefined && k.estimatedMonthlyIncome > 0
      ? `${formatInr(k.maxEmiCapacity)} (${Math.round(k.foirCap * 100)}% FOIR cap)`
      : 'N/A';

  const hasNegativeBalances = (k.negativeBalanceDays || 0) > 0 || (k.minBalance || 0) < 0;

  // Monthly SVG chart (Credits vs Debits vs Avg EOD)
  const maxMonthVal = Math.max(
    1,
    ...monthly.map((m) => Math.max(m.credits || 0, m.debits || 0, Math.abs(m.avgEod || 0)))
  );
  const chartBarsHtml = monthly
    .map((m) => {
      const cHeight = Math.round(((m.credits || 0) / maxMonthVal) * 90);
      const dHeight = Math.round(((m.debits || 0) / maxMonthVal) * 90);
      const eHeight = Math.round((Math.abs(m.avgEod || 0) / maxMonthVal) * 90);
      const eColor = (m.avgEod || 0) < 0 ? '#dc2626' : '#3b82f6';
      return `
        <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:60px;">
          <div style="height:95px;display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid #cbd5e1;width:100%;justify-content:center;padding-bottom:2px;">
            <div title="Credits: ${formatInr(m.credits)}" style="width:12px;height:${Math.max(2, cHeight)}px;background:#10b981;border-radius:2px 2px 0 0;"></div>
            <div title="Debits: ${formatInr(m.debits)}" style="width:12px;height:${Math.max(2, dHeight)}px;background:#ef4444;border-radius:2px 2px 0 0;"></div>
            <div title="Avg EOD: ${formatInr(m.avgEod)}" style="width:12px;height:${Math.max(2, eHeight)}px;background:${eColor};border-radius:2px 2px 0 0;"></div>
          </div>
          <div style="font-size:10px;font-weight:600;color:#334155;margin-top:4px;">${escapeHtml(m.month)}</div>
          <div style="font-size:9px;color:#64748b;">${m.isFullMonth ? 'Full' : `${m.daysCovered || ''}d`}</div>
        </div>
      `;
    })
    .join('');

  // Spending DNA Insight text
  const topDebitCat = debitCats[0] || null;
  const spendingInsight = topDebitCat
    ? `Discretionary and primary outflows are concentrated in <strong>${escapeHtml(topDebitCat.category)}</strong> (${topDebitCat.pct}% of total debits, ${formatInr(topDebitCat.total)} across ${topDebitCat.count} transactions).`
    : 'Outflows are distributed across everyday transactions with no dominant single category.';

  // SECTION 1: HEADER
  const logoBase64 = getLogoBase64();
  const logoImgHtml = logoBase64
    ? `<img src="data:image/png;base64,${logoBase64}" alt="CreditDost" style="height:48px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-size:24px;font-weight:800;color:#2563eb;letter-spacing:-0.5px;">CreditDost</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CreditDost Credit Intelligence Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      line-height: 1.45;
      color: #1e293b;
      background: #ffffff;
      padding: 16px 20px;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 14px;
      margin-bottom: 12px;
      border-bottom: 2px solid #0f172a;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header-brand-divider {
      width: 1.5px;
      height: 42px;
      background: #cbd5e1;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.3px;
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.2;
    }
    .brand-sub { font-size: 10.5px; color: #64748b; margin-top: 4px; font-weight: 500; }
    .meta-right { text-align: right; font-size: 10px; color: #475569; }
    .type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      background: #e2e8f0;
      color: #1e293b;
      margin-left: 6px;
      vertical-align: middle;
    }
    .nav-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 14px;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
    }
    .nav-chip {
      font-size: 9.5px;
      font-weight: 600;
      color: #2563eb;
      text-decoration: none;
      padding: 2px 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
    }
    .section-title {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #0f172a;
      border-left: 3px solid #2563eb;
      padding-left: 8px;
      margin: 16px 0 8px 0;
    }
    .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }
    .card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #f8fafc;
    }
    .card-label { font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .card-val { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .card-sub { font-size: 9px; color: #475569; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
    th {
      background: #f1f5f9;
      color: #334155;
      text-align: left;
      padding: 5px 7px;
      font-weight: 700;
      border-bottom: 1px solid #cbd5e1;
      font-size: 9px;
      text-transform: uppercase;
    }
    td {
      padding: 5px 7px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #fafafa; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .verdict-box {
      border: 1.5px solid ${verdictColor.border};
      background: ${verdictColor.bg};
      color: ${verdictColor.text};
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .verdict-badge {
      background: ${verdictColor.badge};
      color: #fff;
      font-weight: 800;
      font-size: 11.5px;
      padding: 4px 12px;
      border-radius: 6px;
    }
    .alert-box {
      border: 1px solid #f87171;
      background: #fef2f2;
      color: #991b1b;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 10px;
      font-size: 10.5px;
    }
    .info-box {
      border: 1px solid #93c5fd;
      background: #eff6ff;
      color: #1e40af;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 10px;
      font-size: 10.5px;
    }
    .page-break { page-break-before: always; }
    .bullet-list { padding-left: 16px; margin-top: 4px; }
    .bullet-list li { margin-bottom: 3px; }
    .progress-bar-bg {
      background: #e2e8f0;
      border-radius: 4px;
      height: 8px;
      width: 100%;
      overflow: hidden;
      margin-top: 3px;
    }
    .progress-bar-fill {
      background: #2563eb;
      height: 100%;
      border-radius: 4px;
    }
    .insufficient-box {
      padding: 10px 14px;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      background: #f8fafc;
      color: #64748b;
      font-size: 10.5px;
      font-style: italic;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>

  <!-- SECTION 1: HEADER -->
  <div id="section-1" class="header-bar">
    <div class="header-left">
      ${logoImgHtml}
      <div class="header-brand-divider"></div>
      <div>
        <div class="brand-title">
          <span>CREDIT INTELLIGENCE REPORT</span>
          <span class="type-badge">${escapeHtml(acc.accountType || 'Savings / Current')}</span>
        </div>
        <div class="brand-sub">Bank Statement Financial Underwriting &amp; Cash-Flow Analysis</div>
      </div>
    </div>
    <div class="meta-right">
      <div><strong>Report ID:</strong> ${escapeHtml(meta.fileName || meta.documentId || 'BSA-REPORT')}</div>
      <div><strong>Generated:</strong> ${escapeHtml(meta.generatedAt || new Date().toISOString().slice(0, 10))}</div>
      <div style="margin-top:3px;">
        <span class="verdict-badge" style="padding:2px 8px;font-size:10px;">${escapeHtml(verdict.label)}</span>
      </div>
    </div>
  </div>

  <!-- QUICK NAVIGATION CHIPS -->
  <div class="nav-bar">
    <a class="nav-chip" href="#section-1">1. Borrower Profile</a>
    <a class="nav-chip" href="#section-2">2. Account Summary</a>
    <a class="nav-chip" href="#section-3">3. Income Reality</a>
    <a class="nav-chip" href="#section-4">4. Spending DNA</a>
    <a class="nav-chip" href="#section-5">5. Money Flow</a>
    <a class="nav-chip" href="#section-6">6. EOD Balances</a>
    <a class="nav-chip" href="#section-7">7. Suspicious Txns</a>
    <a class="nav-chip" href="#section-8">8. Circular Money</a>
    <a class="nav-chip" href="#section-9">9. Red Flags</a>
    <a class="nav-chip" href="#section-10">10. AML Signals</a>
    <a class="nav-chip" href="#section-11">11. Liquidity</a>
    <a class="nav-chip" href="#section-12">12. Monthly Trend</a>
    <a class="nav-chip" href="#section-13">13. Risk Scorecard</a>
    <a class="nav-chip" href="#section-14">14. Recommendations</a>
    <a class="nav-chip" href="#section-15">15. Closing Verdict</a>
    <a class="nav-chip" href="#section-appendix">Appendix</a>
  </div>

  <!-- SECTION 1: BORROWER PROFILE & 5 KPI CARDS -->
  <div id="section-1" class="section-title">1. Borrower Profile</div>
  <div class="grid-4" style="margin-bottom:6px;">
    <div class="card">
      <div class="card-label">Borrower Name</div>
      <div class="card-val" style="font-size:12px;">${escapeHtml(acc.accountHolderName || 'Not Specified')}</div>
      <div class="card-sub">Occupation: ${escapeHtml(acc.occupation || 'Not verified')}</div>
    </div>
    <div class="card">
      <div class="card-label">Account Number (Masked)</div>
      <div class="card-val" style="font-size:12px;">${escapeHtml(acc.accountNumberMasked || acc.accountNumber || 'N/A')}</div>
      <div class="card-sub">${escapeHtml(acc.bankName || 'Bank')} | IFSC: ${escapeHtml(acc.ifsc || 'N/A')}</div>
    </div>
    <div class="card">
      <div class="card-label">Printed Statement Period</div>
      <div class="card-val" style="font-size:11px;">${printedPeriodStr}</div>
      <div class="card-sub">Txns Period: ${txPeriodStr}</div>
    </div>
    <div class="card">
      <div class="card-label">Overall Cash Flow</div>
      <div class="card-val" style="font-size:11.5px;color:${(k.netCashFlow || 0) >= 0 ? '#059669' : '#dc2626'};">${formatInr(k.netCashFlow)}</div>
      <div class="card-sub">Cr: ${formatInr(k.totalCredits)} | Dr: ${formatInr(k.totalDebits)}</div>
    </div>
  </div>

  <!-- 5 KPI CARDS -->
  <div class="grid-5">
    <div class="card">
      <div class="card-label">Genuine Income / Mo</div>
      <div class="card-val" style="color:#059669;font-size:12.5px;">${escapeHtml(k.medianMonthlyIncomeDisplay || formatInr(k.estimatedMonthlyIncome))}</div>
      <div class="card-sub">${k.hasSufficientHistory ? 'Median across full mo' : 'Observed monthly avg'}</div>
    </div>
    <div class="card">
      <div class="card-label">FOIR</div>
      <div class="card-val" style="font-size:12.5px;">${escapeHtml(foirDisplay)}</div>
      <div class="card-sub">Obligation: ${formatInr(k.monthlyObligation)}/m</div>
    </div>
    <div class="card">
      <div class="card-label">Self-Transfers In %</div>
      <div class="card-val" style="font-size:12.5px;">${k.selfTransferInPct ?? 0}%</div>
      <div class="card-sub">${formatInr(k.totalOwnAccountCredits || 0)} total</div>
    </div>
    <div class="card">
      <div class="card-label">Average EOD (ABB)</div>
      <div class="card-val" style="font-size:12.5px;color:${(k.avgEod || 0) < 0 ? '#dc2626' : '#0f172a'};">${formatInr(k.avgEod)}</div>
      <div class="card-sub">Median: ${formatInr(k.medianEodBalance)}</div>
    </div>
    <div class="card">
      <div class="card-label">Bounces / Dishonours</div>
      <div class="card-val" style="font-size:12.5px;color:${(k.emiBounces || 0) > 0 ? '#dc2626' : '#059669'};">${k.emiBounces || 0}</div>
      <div class="card-sub">Charges: ${formatInr(k.returnChargesTotal || 0)}</div>
    </div>
  </div>

  <!-- SECTION 2: ACCOUNT SUMMARY -->
  <div id="section-2" class="section-title">2. Account Summary</div>
  <div class="grid-4">
    <div class="card">
      <div class="card-label">Opening &rarr; Closing Balance</div>
      <div class="card-val" style="font-size:12px;">${formatInr(k.openingBalance)} &rarr; ${formatInr(k.closingBalance)}</div>
      <div class="card-sub">Opening ${k.openingBalanceDerived ? 'derived from chain' : 'printed on header'}</div>
    </div>
    <div class="card">
      <div class="card-label">Net Cash Flow</div>
      <div class="card-val" style="font-size:12px;color:${(k.netCashFlow || 0) >= 0 ? '#059669' : '#dc2626'};">${formatInr(k.netCashFlow)}</div>
      <div class="card-sub">Retention ratio: ${k.netFlowRatioPct ?? 0}%</div>
    </div>
    <div class="card">
      <div class="card-label">Transaction Count</div>
      <div class="card-val" style="font-size:12px;">${k.totalTransactions || 0} Txns</div>
      <div class="card-sub">${k.creditCount || 0} Credits | ${k.debitCount || 0} Debits</div>
    </div>
    <div class="card">
      <div class="card-label">Min / Max Balance</div>
      <div class="card-val" style="font-size:12px;">${formatInr(k.minBalance)} / ${formatInr(k.maxBalance)}</div>
      <div class="card-sub">Tracked across ${k.distinctCalendarDays || 0} days</div>
    </div>
  </div>

  <!-- SECTION 3: INCOME REALITY CHECK -->
  <div id="section-3" class="section-title">3. Income Reality Check</div>
  <div class="grid-5" style="margin-bottom:8px;">
    <div class="card">
      <div class="card-label">Gross Monthly Credit</div>
      <div class="card-val" style="font-size:12px;">${formatInr(k.grossMonthlyCredit ?? k.observedInflowPerMonth ?? 0)}</div>
      <div class="card-sub">Total Cr: ${formatInr(k.totalCredits)}</div>
    </div>
    <div class="card">
      <div class="card-label">Self-Transfers In</div>
      <div class="card-val" style="color:#dc2626;font-size:12px;">-${formatInr(k.totalOwnAccountCredits || 0)}</div>
      <div class="card-sub">${k.selfTransferInPct ?? 0}% of gross credits</div>
    </div>
    <div class="card">
      <div class="card-label">Possible Loan Disbursals In</div>
      <div class="card-val" style="color:#dc2626;font-size:12px;">-${formatInr(k.totalLoanCredits || 0)}</div>
      <div class="card-sub">Lender &amp; disbursal inflows</div>
    </div>
    <div class="card">
      <div class="card-label">Genuine Income / Mo</div>
      <div class="card-val" style="color:#059669;font-size:12px;">${escapeHtml(k.medianMonthlyIncomeDisplay || formatInr(k.medianMonthlyIncome ?? k.estimatedMonthlyIncome))}</div>
      <div class="card-sub">Net of non-income exclusions</div>
    </div>
    <div class="card">
      <div class="card-label">Income Stability (CV)</div>
      <div class="card-val" style="font-size:12px;">${escapeHtml(String(k.incomeCvDisplay || 'Insufficient history'))}</div>
      <div class="card-sub">${k.hasSufficientHistory ? (k.incomeCvNumeric <= 35 ? 'Stable' : 'Volatile') : 'Limited history'}</div>
    </div>
  </div>

  <div style="font-weight:700;margin:6px 0 4px 0;font-size:10px;">Top Income Sources</div>
  ${
    topIncomeSources.length === 0
      ? `<div class="card">No credit transactions recorded in statement.</div>`
      : `<table>
          <thead>
            <tr>
              <th style="width:5%;">#</th>
              <th>Counterparty / Payer</th>
              <th class="num">Txns</th>
              <th class="num">Amount</th>
              <th class="num">Share</th>
              <th style="width:14%;">Source Type</th>
            </tr>
          </thead>
          <tbody>
            ${topIncomeSources
              .map(
                (s, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><strong>${escapeHtml(s.counterparty)}</strong></td>
                <td class="num">${s.txns}</td>
                <td class="num" style="color:#059669;font-weight:600;">${formatInr(s.amount)}</td>
                <td class="num">${s.pct}%</td>
                <td><span style="font-weight:700;font-size:9.5px;color:${s.type === 'SELF' ? '#6366f1' : '#0f172a'};">${escapeHtml(s.type)}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>`
  }

  <!-- SECTION 4: SPENDING DNA -->
  <div id="section-4" class="section-title">4. Spending DNA</div>
  <div class="card" style="margin-bottom:8px;">
    <div style="font-size:10.5px;color:#334155;margin-bottom:6px;">
      ${spendingInsight}
    </div>
    <div class="grid-2">
      ${debitCats
        .slice(0, 8)
        .map(
          (c) => `
        <div style="margin-bottom:5px;">
          <div style="display:flex;justify-content:space-between;font-size:9.5px;margin-bottom:1px;">
            <span><strong>${escapeHtml(c.category)}</strong> (${c.count} txns)</span>
            <span><strong>${formatInr(c.total)}</strong> (${c.pct}%)</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${Math.min(100, Math.max(3, c.pct))}%;"></div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  </div>

  <!-- SECTION 5: MONEY FLOW -->
  <div id="section-5" class="section-title">5. Money Flow</div>
  <div class="grid-2">
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">Top Inflow Modes</div>
      ${
        topInflowModes.length === 0
          ? `<div class="card">No credit inflow modes recorded.</div>`
          : `<table>
              <thead>
                <tr>
                  <th>Mode / Channel</th>
                  <th class="num">Txns</th>
                  <th class="num">Amount</th>
                  <th class="num">Share</th>
                </tr>
              </thead>
              <tbody>
                ${topInflowModes
                  .map(
                    (m) => `
                  <tr>
                    <td><strong>${escapeHtml(m.mode)}</strong></td>
                    <td class="num">${m.txns}</td>
                    <td class="num" style="color:#059669;font-weight:600;">${formatInr(m.amount)}</td>
                    <td class="num">${m.pct}%</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">Top Outflow Modes</div>
      ${
        topOutflowModes.length === 0
          ? `<div class="card">No debit outflow modes recorded.</div>`
          : `<table>
              <thead>
                <tr>
                  <th>Mode / Channel</th>
                  <th class="num">Txns</th>
                  <th class="num">Amount</th>
                  <th class="num">Share</th>
                </tr>
              </thead>
              <tbody>
                ${topOutflowModes
                  .map(
                    (m) => `
                  <tr>
                    <td><strong>${escapeHtml(m.mode)}</strong></td>
                    <td class="num">${m.txns}</td>
                    <td class="num" style="color:#dc2626;font-weight:600;">${formatInr(m.amount)}</td>
                    <td class="num">${m.pct}%</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
  </div>

  <div style="font-weight:700;margin:6px 0 4px 0;font-size:10px;">Top Outflow Destinations</div>
  ${
    topOutflowDestinations.length === 0
      ? `<div class="card">No debit transactions recorded.</div>`
      : `<table>
          <thead>
            <tr>
              <th style="width:5%;">#</th>
              <th>Destination / Payee</th>
              <th class="num">Txns</th>
              <th class="num">Amount</th>
              <th class="num">Share</th>
              <th style="width:14%;">Destination Type</th>
            </tr>
          </thead>
          <tbody>
            ${topOutflowDestinations
              .map(
                (d, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><strong>${escapeHtml(d.destination)}</strong></td>
                <td class="num">${d.txns}</td>
                <td class="num" style="color:#dc2626;font-weight:600;">${formatInr(d.amount)}</td>
                <td class="num">${d.pct}%</td>
                <td><span style="font-weight:700;font-size:9.5px;color:${d.type === 'SELF' ? '#6366f1' : '#0f172a'};">${escapeHtml(d.type)}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>`
  }

  <!-- SECTION 6: EOD BALANCES SUMMARY -->
  <div id="section-6" class="section-title">6. EOD Balances Summary</div>
  <div class="grid-3">
    <div class="card">
      <div class="card-label">Calendar Days Tracked</div>
      <div class="card-val">${k.calendarDaysTracked || k.distinctCalendarDays || 0} Days</div>
      <div class="card-sub">Active transaction days: ${k.activeTxnDays || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Average EOD Balance</div>
      <div class="card-val" style="color:${(k.avgEod || 0) < 0 ? '#dc2626' : '#0f172a'};">${formatInr(k.avgEod)}</div>
      <div class="card-sub">Median daily EOD: ${formatInr(k.medianEodBalance)}</div>
    </div>
    <div class="card">
      <div class="card-label">Minimum / Maximum Balance</div>
      <div class="card-val" style="color:${(k.minBalance || 0) < 0 ? '#dc2626' : '#0f172a'};">${formatInr(k.minBalance)} / ${formatInr(k.maxBalance)}</div>
      <div class="card-sub">Overdrawn days: ${k.negativeBalanceDays || 0}</div>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-label">Days Below ₹1,000</div>
      <div class="card-val" style="color:${(k.calendarDaysBelow1k || 0) > 0 ? '#dc2626' : '#059669'};">${k.calendarDaysBelow1k || 0} Days (${parseFloat(k.calendarDaysBelow1kPct || 0)}%)</div>
      <div class="card-sub">Low balance cushion strain threshold</div>
    </div>
    <div class="card">
      <div class="card-label">Days Below ₹10,000</div>
      <div class="card-val" style="color:${(k.calendarDaysBelow10k || 0) > 0 ? '#d97706' : '#059669'};">${k.calendarDaysBelow10k || 0} Days (${parseFloat(k.calendarDaysBelow10kPct || 0)}%)</div>
      <div class="card-sub">Intermediate operating liquidity buffer</div>
    </div>
  </div>

  <!-- SECTION 7: SUSPICIOUS TRANSACTIONS SUMMARY -->
  <div id="section-7" class="section-title">7. Suspicious Transactions Summary</div>
  ${
    circularEvents.length === 0 && creditCardRotations.length === 0 && cashPassThroughEvents.length === 0 && (aml.structuringCashCount || 0) === 0
      ? `<div class="card">No suspicious transaction bursts, pass-through conduits, cash structuring, or credit-card rotation patterns identified.</div>`
      : `<div class="grid-3" style="margin-bottom:6px;">
          <div class="card">
            <div class="card-label">Pass-Through Flow</div>
            <div class="card-val" style="color:${circularEvents.length > 0 ? '#d97706' : '#059669'};">${circularEvents.length} Event(s)</div>
            <div class="card-sub">${formatInr(k.circularCreditTotal || 0)} flagged</div>
          </div>
          <div class="card">
            <div class="card-label">Card Rotation Events</div>
            <div class="card-val" style="color:${creditCardRotations.length > 0 ? '#dc2626' : '#059669'};">${creditCardRotations.length} Event(s)</div>
            <div class="card-sub">${formatInr(k.creditCardRotationTotal || 0)} cycled</div>
          </div>
          <div class="card">
            <div class="card-label">Cash Structuring Signs</div>
            <div class="card-val" style="color:${(aml.structuringCashCount || 0) > 0 ? '#dc2626' : '#059669'};">${aml.structuringCashCount || 0} Txns</div>
            <div class="card-sub">Multiples just under ₹50,000</div>
          </div>
        </div>`
  }

  <!-- SECTION 8: CIRCULAR MONEY AND SELF-TRANSFER ANALYSIS -->
  <div id="section-8" class="section-title">8. Circular Money &amp; Self-Transfer Analysis</div>
  <div class="grid-3" style="margin-bottom:8px;">
    <div class="card">
      <div class="card-label">Self-Transfers In / Out</div>
      <div class="card-val" style="font-size:12px;">In: ${formatInr(k.totalOwnAccountCredits || 0)} | Out: ${formatInr(k.totalInternalDebits || 0)}</div>
      <div class="card-sub">In share: ${k.selfTransferInPct ?? 0}% | Out share: ${k.selfTransferOutPct ?? 0}%</div>
    </div>
    <div class="card">
      <div class="card-label">Circular Inflow Velocity</div>
      <div class="card-val" style="font-size:12px;color:${circularEvents.length > 0 ? '#d97706' : '#059669'};">${circularEvents.length > 0 ? `Possible Circular Flow (${circularEvents.length} events)` : 'No Circular Flow Detected'}</div>
      <div class="card-sub">${circularEvents.length > 0 ? `${k.circularPctOfCredits}% of total credit volume` : 'Clean counterparty velocity'}</div>
    </div>
    <div class="card">
      <div class="card-label">Confidence Assessment</div>
      <div class="card-val" style="font-size:12px;">${circularEvents.length >= 3 ? 'High Confidence' : (circularEvents.length > 0 ? 'Moderate (Indicates rapid turnover)' : 'High Confidence (Clean)')}</div>
      <div class="card-sub">Underwriting rule: Rule 1f &amp; 1g</div>
    </div>
  </div>

  ${
    circularEvents.length === 0
      ? `<div class="card">No circular rotation or pass-through conduit transactions flagged in statement.</div>`
      : `<table>
          <thead>
            <tr>
              <th>Date(s)</th>
              <th>Pattern / Counterparty</th>
              <th class="num">Inflow</th>
              <th class="num">Outflow</th>
              <th class="num">% Moved</th>
            </tr>
          </thead>
          <tbody>
            ${circularEvents
              .slice(0, 10)
              .map(
                (ce) => `
              <tr>
                <td>${escapeHtml(ce.creditDate)}${ce.debitDate && ce.debitDate !== ce.creditDate ? ` &rarr; ${escapeHtml(ce.debitDate)}` : ''}</td>
                <td><strong>${escapeHtml(ce.rule || ce.ruleId)}</strong> &bull; ${escapeHtml(ce.counterparty || 'External')}</td>
                <td class="num">${formatInr(ce.creditAmount)}</td>
                <td class="num">${formatInr(ce.debitAmount ?? ce.outWithin48h)}</td>
                <td class="num" style="color:#d97706;font-weight:600;">${ce.pctOut ?? ce.percentMoved ?? 100}%</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>`
  }

  <!-- SECTION 9: RED FLAGS -->
  <div id="section-9" class="section-title">9. Red Flags Summary</div>
  <div class="grid-3">
    <div class="card">
      <div class="card-label">EMI &amp; Mandate Bounces</div>
      <div class="card-val" style="color:${(k.emiBounces || 0) > 0 ? '#dc2626' : '#059669'};">${k.emiBounces || 0} Event(s)</div>
      <div class="card-sub">${(k.emiBounces || 0) > 0 ? `${k.returnChargesCount || 0} charge event(s) (${formatInr(k.returnChargesTotal || 0)})` : 'Clean debit repayment discipline'}</div>
    </div>
    <div class="card">
      <div class="card-label">Overdraft / Negative Balance</div>
      <div class="card-val" style="color:${hasNegativeBalances ? '#dc2626' : '#059669'};">${k.totalDaysOverdrawn ?? k.negativeBalanceDays ?? 0} Day(s)</div>
      <div class="card-sub">${hasNegativeBalances ? `Minimum balance reached: ${formatInr(k.minBalance)}` : 'Maintained positive balance'}</div>
    </div>
    <div class="card">
      <div class="card-label">Gambling / High-Risk Betting</div>
      <div class="card-val" style="color:#64748b;">Not evaluated</div>
      <div class="card-sub">No dedicated gaming/betting data feed</div>
    </div>
  </div>

  <!-- SECTION 10: AML SIGNALS & BEHAVIOURAL FLAGS -->
  <div id="section-10" class="section-title">10. AML Signals &amp; Behavioural Indicators</div>
  <table>
    <thead>
      <tr>
        <th style="width:10%;">Signal ID</th>
        <th style="width:30%;">Indicator Name</th>
        <th style="width:45%;">Trigger Condition / Finding</th>
        <th style="width:15%;">Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>AML-01</td>
        <td><strong>Rapid Fund Turnover</strong></td>
        <td>${aml.rapidMovementCount || 0} pass-through event(s) where &ge;80% of funds routed out within 48 hours</td>
        <td>${(aml.rapidMovementCount || 0) > 0 ? statusPill('AMBER') : statusPill('GREEN')}</td>
      </tr>
      <tr>
        <td>AML-02</td>
        <td><strong>Cash Structuring</strong></td>
        <td>${aml.structuringCashCount || 0} cash deposit transaction(s) between ₹40,000 and ₹49,999 (${formatInr(aml.structuringCashTotal || 0)})</td>
        <td>${(aml.structuringCashCount || 0) > 0 ? statusPill('RED') : statusPill('GREEN')}</td>
      </tr>
      <tr>
        <td>AML-03</td>
        <td><strong>Large Round-Figure Spikes</strong></td>
        <td>${aml.roundFigureSpikeCount || 0} transaction(s) &ge; ₹50,000 in exact multiples of ₹10,000 (${formatInr(aml.roundFigureSpikeTotal || 0)})</td>
        <td>${(aml.roundFigureSpikeCount || 0) > 0 ? statusPill('AMBER') : statusPill('GREEN')}</td>
      </tr>
      <tr>
        <td>AML-04</td>
        <td><strong>Credit Card Rotation</strong></td>
        <td>${creditCardRotations.length} cycle(s) where card returns were followed within 48h by card bill debits &ge;80%</td>
        <td>${creditCardRotations.length > 0 ? statusPill('AMBER') : statusPill('GREEN')}</td>
      </tr>
      <tr>
        <td>AML-05</td>
        <td><strong>Blacklisted Entity Match</strong></td>
        <td>Entity matching against statutory negative list</td>
        <td>${statusPill('NEUTRAL')}</td>
      </tr>
    </tbody>
  </table>

  <!-- SECTION 11: ACCOUNT LIQUIDITY WITH ALERT BOX -->
  <div id="section-11" class="section-title">11. Account Liquidity &amp; Cushion Assessment</div>
  ${
    hasNegativeBalances
      ? `<div class="alert-box">
          <strong>Alert &mdash; Negative Running Balance / Overdraft Usage:</strong> The account operated with a negative balance on <strong>${k.negativeBalanceDays || 0}</strong> calendar day(s) (${escapeHtml(String(k.negativeBalanceDaysPct || '0%'))} of the statement window), dropping to a minimum balance of <strong>${formatInr(k.minBalance)}</strong>. Review overdraft / cash credit facility terms or underlying lien/FD linkages.
        </div>`
      : (parseFloat(k.calendarDaysBelow1kPct || 0) > 20
        ? `<div class="alert-box">
            <strong>Liquidity Warning:</strong> The account running balance dipped below ₹1,000 on <strong>${k.calendarDaysBelow1k || 0}</strong> calendar day(s) (<strong>${parseFloat(k.calendarDaysBelow1kPct || 0)}%</strong> of the window). Average operating buffer is narrow.
          </div>`
        : `<div class="info-box">
            <strong>Satisfactory Liquidity:</strong> Account maintained a positive cash cushion with an Average Bank Balance (ABB) of <strong>${formatInr(k.abb)}</strong> and zero negative-balance days.
          </div>`)
  }

  <div class="grid-4">
    <div class="card">
      <div class="card-label">Average Bank Balance (ABB)</div>
      <div class="card-val" style="color:${(k.abb || 0) < 0 ? '#dc2626' : '#0f172a'};">${formatInr(k.abb)}</div>
      <div class="card-sub">Mean daily closing balance</div>
    </div>
    <div class="card">
      <div class="card-label">Median Daily EOD</div>
      <div class="card-val">${formatInr(k.medianEodBalance)}</div>
      <div class="card-sub">50th percentile cash cushion</div>
    </div>
    <div class="card">
      <div class="card-label">Low Balance Days (&lt;₹1k)</div>
      <div class="card-val" style="color:${(k.calendarDaysBelow1k || 0) > 0 ? '#dc2626' : '#059669'};">${k.calendarDaysBelow1k || 0} Days</div>
      <div class="card-sub">${parseFloat(k.calendarDaysBelow1kPct || 0)}% of calendar window</div>
    </div>
    <div class="card">
      <div class="card-label">ABB to Monthly EMI Ratio</div>
      <div class="card-val">${k.abbToEmiRatio !== null ? `${k.abbToEmiRatio}x` : 'N/A'}</div>
      <div class="card-sub">${k.abbToEmiRatio !== null && k.abbToEmiRatio >= 1.5 ? 'Comfortable buffer' : 'Monitor EMI coverage'}</div>
    </div>
  </div>

  <!-- SECTION 12: MONTHLY CREDIT / DEBIT / AVERAGE BALANCE CHART -->
  <div id="section-12" class="section-title">12. Monthly Inflow, Outflow &amp; Balance Trend</div>
  ${
    monthly.length > 0
      ? `<div class="card" style="margin-bottom:8px;padding:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:10px;font-weight:700;color:#475569;">Monthly Movement (Credits vs Debits vs Average Daily Balance)</span>
            <span style="font-size:9.5px;color:#64748b;">
              <span style="color:#10b981;">&#9632;</span> Total Credits &nbsp;
              <span style="color:#ef4444;">&#9632;</span> Total Debits &nbsp;
              <span style="color:#3b82f6;">&#9632;</span> Average EOD
            </span>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end;overflow-x:auto;">
            ${chartBarsHtml}
          </div>
        </div>`
      : `<div class="insufficient-box">Insufficient transaction history to render monthly trend chart.</div>`
  }

  <!-- SECTION 13: FINAL RISK SCORECARD -->
  <div id="section-13" class="section-title">13. Final Risk Scorecard</div>
  <table>
    <thead>
      <tr>
        <th style="width:20%;">Risk Factor</th>
        <th style="width:32%;">Measured Finding</th>
        <th style="width:36%;">Lender Impact / Benchmark</th>
        <th style="width:12%;">Risk Level</th>
      </tr>
    </thead>
    <tbody>
      ${scorecard
        .map(
          (row) => `
        <tr>
          <td><strong>${escapeHtml(row.factor || row.parameter)}</strong></td>
          <td>${escapeHtml(row.value)}</td>
          <td>${escapeHtml(row.note || row.benchmark)}</td>
          <td>${statusPill(row.level || row.status)}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <!-- SECTION 14: LENDER RECOMMENDATIONS -->
  <div id="section-14" class="section-title">14. Lender Recommendations</div>
  <div class="card" style="margin-bottom:12px;">
    <p style="font-size:10.5px;margin-bottom:6px;">
      ${escapeHtml(narrative?.recommendation_note || (verdict.reasons || [])[0] || k.verdictReason || 'Review findings against lender credit policy.')}
    </p>
    <ul class="bullet-list" style="font-size:10.5px;">
      ${
        k.hasSufficientHistory && k.estimatedMonthlyIncome > 0
          ? `<li><strong>EMI Ceiling:</strong> Based on a 50% FOIR cap on verified monthly genuine income of ${formatInr(k.estimatedMonthlyIncome)}, maximum serviceable monthly obligation is <strong>${formatInr(k.maxEmiCapacity)}</strong> (available headroom: <strong>${formatInr(k.availableEmiCapacity)}</strong>).</li>`
          : `<li><strong>History Requirement:</strong> Statement covers ${k.fullMonthsCount || 0} full calendar month(s); require supplementary banking or salary slips for formal FOIR calculation.</li>`
      }
      ${
        (k.emiBounces || 0) > 0
          ? `<li><strong>Dishonour Verification:</strong> ${k.emiBounces} bounce/dishonour event(s) detected. Obtain loan account statements (SOA) to confirm regularization.</li>`
          : `<li><strong>Repayment Record:</strong> Zero bounce events recorded across observed debit obligations.</li>`
      }
      ${
        hasNegativeBalances
          ? `<li><strong>Facility Sanction Check:</strong> Overdrawn/negative balances observed on ${k.negativeBalanceDays || 0} days (min ${formatInr(k.minBalance)}). Verify OD/CC sanction terms.</li>`
          : ''
      }
      ${
        (k.selfTransferInPct || 0) > 20
          ? `<li><strong>Source of Funds:</strong> Significant self-transfer inflows (${k.selfTransferInPct}% of credits). Confirm origin of incoming funds.</li>`
          : ''
      }
    </ul>
  </div>

  <!-- SECTION 15: CLOSING VERDICT BOX -->
  <div id="section-15" class="verdict-box">
    <div>
      <div style="font-size:14px;font-weight:800;letter-spacing:-0.2px;">
        CLOSING VERDICT: ${escapeHtml(verdict.label)} &bull; ${escapeHtml(verdict.status)}
      </div>
      <div style="font-size:10.5px;margin-top:4px;">
        Scorecard Distribution: 
        <strong style="color:#991b1b;">High Risk (RED): ${redCount}</strong> &bull; 
        <strong style="color:#92400e;">Medium Risk (AMBER): ${amberCount}</strong> &bull; 
        <strong style="color:#065f46;">Low Risk (GREEN): ${greenCount}</strong>
        ${neutralCount > 0 ? ` &bull; <strong style="color:#475569;">Neutral: ${neutralCount}</strong>` : ''}
      </div>
      <div style="font-size:10px;margin-top:3px;opacity:0.95;">
        ${(verdict.reasons || [verdict.reason || '']).filter(Boolean).map((r) => escapeHtml(r)).join(' &bull; ')}
      </div>
    </div>
    <div class="verdict-badge" style="font-size:13px;padding:6px 14px;">${escapeHtml(verdict.status)}</div>
  </div>

  <!-- FOOTER -->
  <div style="margin-top:14px;padding-top:8px;border-top:1px solid #cbd5e1;display:flex;justify-content:space-between;font-size:9.5px;color:#64748b;">
    <div>
      <strong>CreditDost Credit Intelligence Engine</strong> &bull; Strictly Confidential &bull; For Authorized Financial Institution Underwriting Use Only.
    </div>
    <div>
      Report Hash: ${escapeHtml(meta.fileName || meta.documentId || 'BSA-HASH')} &bull; End of Executive Report
    </div>
  </div>

  <!-- APPENDIX -->
  <div id="section-appendix" class="page-break"></div>
  <div class="section-title">Appendix A. Executive Narrative &amp; Category Breakdown</div>

  <!-- Executive Narrative -->
  <div class="card" style="margin-bottom:10px;">
    <div style="font-weight:700;font-size:11px;margin-bottom:4px;color:#0f172a;">Executive Synthesis</div>
    <p style="font-size:10.5px;margin-bottom:6px;">${escapeHtml(narrative?.executive_summary || '')}</p>
    <div class="grid-2">
      <div>
        <div style="font-weight:700;color:#065f46;font-size:10px;">Key Strengths</div>
        <ul class="bullet-list" style="font-size:10px;">
          ${(narrative?.key_strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>
      <div>
        <div style="font-weight:700;color:#991b1b;font-size:10px;">Key Concerns</div>
        <ul class="bullet-list" style="font-size:10px;">
          ${(narrative?.key_concerns || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>
    </div>
  </div>

  <!-- Genuine Inflow & Excluded Credit Buckets -->
  <div style="font-weight:700;margin:6px 0 4px 0;font-size:10.5px;">Genuine Inflow &amp; Excluded Credit Buckets</div>
  <div class="card" style="margin-bottom:10px;">
    <table>
      <thead>
        <tr>
          <th>Credit Component / Exclusion Bucket</th>
          <th class="num">Count</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Total Credits</strong></td>
          <td class="num">${k.creditCount || 0}</td>
          <td class="num"><strong>${formatInr(k.totalCredits)}</strong></td>
        </tr>
        ${excludedBuckets
          .map(
            (b) => `
          <tr>
            <td>Less: ${escapeHtml(b.label)}</td>
            <td class="num">${b.count ?? 0}</td>
            <td class="num" style="color:#dc2626;">-${formatInr(b.amount || 0)}</td>
          </tr>
        `
          )
          .join('')}
        <tr style="background:#f8fafc;font-weight:700;">
          <td><strong>Net Genuine Inflow</strong></td>
          <td class="num">&mdash;</td>
          <td class="num" style="color:#059669;"><strong>${formatInr(k.genuineCreditTotal)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Category Breakdown Tables -->
  <div class="grid-2">
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">Credit Categories (${creditCats.length})</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th class="num">Txns</th>
            <th class="num">Amount</th>
            <th class="num">Share</th>
          </tr>
        </thead>
        <tbody>
          ${creditCats
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.category)}</td>
              <td class="num">${c.count}</td>
              <td class="num">${formatInr(c.total)}</td>
              <td class="num">${c.pct}%</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">Debit Categories (${debitCats.length})</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th class="num">Txns</th>
            <th class="num">Amount</th>
            <th class="num">Share</th>
          </tr>
        </thead>
        <tbody>
          ${debitCats
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.category)}</td>
              <td class="num">${c.count}</td>
              <td class="num">${formatInr(c.total)}</td>
              <td class="num">${c.pct}%</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- APPENDIX B: OBLIGATIONS & INTERNAL MOVEMENTS -->
  <div class="page-break"></div>
  <div class="section-title">Appendix B. Obligations &amp; Internal Movements</div>

  <div class="grid-2">
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">Monthly Recurring Obligations (${obligations.length})</div>
      ${
        obligations.length === 0
          ? `<div class="card">No monthly recurring obligations observed.</div>`
          : `<table>
              <thead>
                <tr>
                  <th>Counterparty</th>
                  <th>Frequency</th>
                  <th class="num">Txns</th>
                  <th class="num">Est. Monthly</th>
                </tr>
              </thead>
              <tbody>
                ${obligations
                  .map(
                    (o) => `
                  <tr>
                    <td>${escapeHtml(o.counterparty || o.payee)}</td>
                    <td>${escapeHtml(o.frequency || 'Monthly')}</td>
                    <td class="num">${o.count ?? o.txnCount}</td>
                    <td class="num">${formatInr(o.monthlyAmount ?? o.amount)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
    <div>
      <div style="font-weight:700;margin-bottom:4px;font-size:10px;">One-Time Loan / Annual Insurance (${oneTimeObligations.length})</div>
      ${
        oneTimeObligations.length === 0
          ? `<div class="card">No one-time loan or annual insurance debits detected.</div>`
          : `<table>
              <thead>
                <tr>
                  <th>Payee</th>
                  <th>Rule</th>
                  <th class="num">Txns</th>
                  <th class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                ${oneTimeObligations
                  .map(
                    (o) => `
                  <tr>
                    <td>${escapeHtml(o.counterparty || o.payee)}</td>
                    <td>${escapeHtml(o.rule)}</td>
                    <td class="num">${o.count ?? o.txnCount}</td>
                    <td class="num">${formatInr(o.totalAmount ?? o.totalPaid)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    </div>
  </div>

  <div style="font-weight:700;margin:6px 0 4px 0;font-size:10px;">Own-Money &amp; Internal Movements (${internalMovements.count || 0})</div>
  ${
    !internalMovements.items || internalMovements.items.length === 0
      ? `<div class="card">No internal movements recorded.</div>`
      : `<table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Movement Kind</th>
              <th>Narration</th>
              <th class="num">Debit</th>
              <th class="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            ${internalMovements.items
              .slice(0, 20)
              .map(
                (im) => `
              <tr>
                <td>${escapeHtml(im.date)}</td>
                <td><strong>${escapeHtml(im.kind)}</strong></td>
                <td>${escapeHtml(im.narration || im.counterparty || '')}</td>
                <td class="num">${(im.debit || (im.type === 'DEBIT' ? im.amount : 0)) > 0 ? formatInr(im.debit || im.amount) : '-'}</td>
                <td class="num">${(im.credit || (im.type === 'CREDIT' ? im.amount : 0)) > 0 ? formatInr(im.credit || im.amount) : '-'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>`
  }

</body>
</html>`;
}

module.exports = {
  renderBankStatementReportHtml,
  escapeHtml,
  formatInr,
};
