'use strict';

const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

/**
 * Generate responsive inline SVG bar chart for Monthly Inflow vs Outflow vs EOD Balance
 */
function generateMonthlyChartSvg(monthlyBreakdown = []) {
  if (!Array.isArray(monthlyBreakdown) || monthlyBreakdown.length === 0) {
    return '<div style="font-size: 10px; color: #94a3b8; text-align: center; padding: 20px;">No monthly data available</div>';
  }

  const width = 720;
  const height = 140;
  const margin = { top: 15, right: 20, bottom: 25, left: 50 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const maxVal = Math.max(
    ...monthlyBreakdown.map((m) => Math.max(m.grossCredits || 0, m.debits || 0, m.genuineIncome || 0)),
    1000
  );

  const numMonths = monthlyBreakdown.length;
  const colW = chartW / numMonths;
  const barW = Math.max(8, Math.min(22, (colW - 20) / 2));

  let barsSvg = '';
  let labelsSvg = '';

  for (let i = 0; i < numMonths; i++) {
    const m = monthlyBreakdown[i];
    const xCenter = margin.left + i * colW + colW / 2;

    const crH = ((m.grossCredits || 0) / maxVal) * chartH;
    const drH = ((m.debits || 0) / maxVal) * chartH;

    const crX = xCenter - barW - 2;
    const drX = xCenter + 2;

    const crY = margin.top + (chartH - crH);
    const drY = margin.top + (chartH - drH);

    // Inflow bar (Green)
    barsSvg += `<rect x="${crX.toFixed(1)}" y="${crY.toFixed(1)}" width="${barW}" height="${crH.toFixed(1)}" fill="#16a34a" rx="2" />`;
    // Outflow bar (Red/Rose)
    barsSvg += `<rect x="${drX.toFixed(1)}" y="${drY.toFixed(1)}" width="${barW}" height="${drH.toFixed(1)}" fill="#ef4444" rx="2" />`;

    // Month label
    labelsSvg += `<text x="${xCenter.toFixed(1)}" y="${height - 6}" font-size="9" fill="#64748b" text-anchor="middle" font-family="-apple-system, sans-serif">${m.month}</text>`;
  }

  // Y-axis gridlines & labels
  let gridSvg = '';
  const yTicks = [0, 0.5 * maxVal, maxVal];
  for (const tVal of yTicks) {
    const yPos = margin.top + chartH - (tVal / maxVal) * chartH;
    gridSvg += `<line x1="${margin.left}" y1="${yPos.toFixed(1)}" x2="${width - margin.right}" y2="${yPos.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" />`;
    gridSvg += `<text x="${margin.left - 6}" y="${(yPos + 3).toFixed(1)}" font-size="8" fill="#94a3b8" text-anchor="end" font-family="-apple-system, sans-serif">₹${Math.round(tVal / 1000)}k</text>`;
  }

  // Legend
  const legendSvg = `
    <g transform="translate(${width - 240}, 6)">
      <rect x="0" y="0" width="10" height="8" fill="#16a34a" rx="1" />
      <text x="14" y="8" font-size="8.5" fill="#475569" font-family="-apple-system, sans-serif">Inflow (Credits)</text>
      <rect x="90" y="0" width="10" height="8" fill="#ef4444" rx="1" />
      <text x="104" y="8" font-size="8.5" fill="#475569" font-family="-apple-system, sans-serif">Outflow (Debits)</text>
    </g>
  `;

  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridSvg}
      ${barsSvg}
      ${labelsSvg}
      ${legendSvg}
    </svg>
  `;
}

/**
 * Render HTML Credit Intelligence Report using bsaCreditReport.ejs
 */
async function renderReportHtml(reportData = {}) {
  const templatePath = path.join(__dirname, '..', '..', 'views', 'bsaCreditReport.ejs');
  const template = fs.readFileSync(templatePath, 'utf8');

  const monthlyBreakdown = reportData.analytics?.monthlyBreakdown || [];
  const monthlyChartSvg = generateMonthlyChartSvg(monthlyBreakdown);

  const ejsData = {
    reportDate: reportData.reportDate || new Date().toISOString().slice(0, 10),
    reportId: reportData.reportId || `BSA_${Date.now()}`,
    account: reportData.account || {},
    statementPeriod: reportData.statementPeriod || {},
    summary: reportData.analytics?.summary || {},
    eod: reportData.analytics?.eodMetrics || {},
    scorecard: reportData.scorecard || { score: 700, scoreBand: 'GOOD', ratingLabel: 'APPROVED', auditTrail: [] },
    narrative: reportData.narrative || {
      executiveUnderwritingSummary: '',
      borrowerBehavioralPersona: '',
      amlObservations: '',
      keyLenderConditions: [],
    },
    obligations: reportData.analytics?.forensics?.loansAndEmis?.detectedEmis || [],
    circularEvents: reportData.analytics?.forensics?.circularAndSelf?.circularEvents || [],
    bounces: reportData.analytics?.forensics?.reversalsAndBounces?.bounceEvents || [],
    monthlyChartSvg,
  };

  return ejs.render(template, ejsData);
}

function findSystemChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }
  return null;
}

/**
 * Compile HTML to pixel-perfect A4 PDF using Puppeteer
 */
async function renderReportPdf(htmlContent) {
  let browser = null;
  try {
    const systemChrome = findSystemChrome();
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };
    if (systemChrome) {
      launchOptions.executablePath = systemChrome;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width: 100%; font-size: 8px; font-family: -apple-system, sans-serif; color: #94a3b8; padding: 0 10mm; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 4px;">
          <span>© CreditDost Credit Intelligence Engine · Bank Statement Analyzer (Confidential)</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
      margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });

    return pdfBuffer;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

module.exports = {
  generateMonthlyChartSvg,
  renderReportHtml,
  renderReportPdf,
};

