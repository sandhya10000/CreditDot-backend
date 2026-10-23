// Styled CRIF (High Mark / CCR) credit-report PDF, generated locally from the
// bureau JSON when the bureau does not return a PDF link.
// Data source: bureauData.credit_report (IndiConnect CRIF response). Sections used:
//   HEADER, REQUEST, PERSONAL-INFO-VARIATION, ACCOUNTS-SUMMARY, RESPONSES,
//   INQUIRY-HISTORY, TRENDS, SCORES.
// Every section is rendered inside its own try/catch, so an unexpected shape
// in one section never stops the PDF from being produced.
const PDFDocumentKit = require("pdfkit");

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = 780;

const C = {
  ink: "#16233F",
  navy: "#1E3A8A",
  label: "#7C8AA5",
  rule: "#D8E0EC",
  head: "#F1F5F9",
  red: "#C81E1E",
  green: "#15803D",
};

// Coerce the bureau's shapes (single object, array, numeric-keyed object,
// quoted strings like "\"746\"") into plain values.
const asArray = (v) => {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return Object.values(v);
  return [v];
};
const txt = (v) => {
  if (v == null) return "";
  const s = String(v).replace(/^"+|"+$/g, "").trim();
  return s;
};
const money = (v) => {
  const n = Number(txt(v).replace(/,/g, ""));
  return Number.isFinite(n) && txt(v) !== "" ? `Rs. ${n.toLocaleString("en-IN")}` : txt(v) || "-";
};
const maskAccount = (v) => {
  const s = txt(v);
  return s.length > 4 ? `${"X".repeat(s.length - 4)}${s.slice(-4)}` : s || "-";
};

// Build plain data from the raw CRIF report. Missing fields become "-".
function buildCrifModel(rawReport, meta = {}) {
  const cr = rawReport || {};
  const header = cr.HEADER || {};
  const request = cr.REQUEST || {};
  // SCORE is one object, or an array when the bureau returns several scores
  const scoreRaw = cr.SCORES?.SCORE;
  const scoreNode = (Array.isArray(scoreRaw) ? scoreRaw[0] : scoreRaw) || {};
  const trendDates = txt(cr.TRENDS?.DATES).split("|").filter(Boolean);
  const trendValues = txt(cr.TRENDS?.VALUES).split("|");

  const accounts = asArray(cr.RESPONSES?.RESPONSE)
    .map((r) => r?.["LOAN-DETAILS"] || r)
    .filter(Boolean);

  const inquiries = asArray(cr["INQUIRY-HISTORY"]?.HISTORY).filter(Boolean);

  return {
    title: "CRIF Credit Information Report",
    meta: {
      name: meta.name || txt(request.NAME) || "-",
      mobile: meta.mobile || txt(request["PHONE-1"]) || "-",
      pan: meta.pan || txt(request.PAN) || "-",
      txnId: meta.txnId || "-",
      reportId: txt(header["REPORT-ID"]) || "-",
      issued: txt(header["DATE-OF-ISSUE"]) || "-",
      status: txt(header.STATUS) || "-",
    },
    score: txt(scoreNode["SCORE-VALUE"]) || "-",
    scoreType: txt(scoreNode["SCORE-TYPE"]) || "-",
    scoreFactors: txt(scoreNode["SCORE-FACTORS"]).split("|").filter(Boolean),
    derived: cr["ACCOUNTS-SUMMARY"]?.["DERIVED-ATTRIBUTES"] || {},
    accounts,
    inquiries,
    trend: trendDates.map((d, i) => ({ date: d, value: trendValues[i] || "" })),
  };
}

function createDoc() {
  return new PDFDocumentKit({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: 40, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: { Title: "CRIF Credit Information Report" },
  });
}

// Start a new page when the next block would run past the bottom limit.
function ensureSpace(doc, need) {
  if (doc.y + need > BOTTOM_LIMIT) doc.addPage();
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 30);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.navy).text(text, MARGIN, doc.y);
  doc.moveTo(MARGIN, doc.y + 2).lineTo(PAGE_W - MARGIN, doc.y + 2).strokeColor(C.rule).stroke();
  doc.y += 8;
}

function keyValueRows(doc, rows) {
  for (const [label, value] of rows) {
    ensureSpace(doc, 16);
    const y = doc.y;
    doc.font("Helvetica").fontSize(8).fillColor(C.label).text(label, MARGIN, y, { width: 160 });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.ink).text(String(value || "-"), MARGIN + 165, y, {
      width: CONTENT_W - 165,
    });
    doc.y = Math.max(doc.y, y + 14);
  }
}

// Simple grid table: headers + rows, column widths as fractions of the page width.
function table(doc, headers, rows, fractions) {
  const widths = fractions.map((f) => Math.floor(CONTENT_W * f));
  const drawHeader = () => {
    ensureSpace(doc, 18);
    let x = MARGIN;
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 16).fill(C.head);
    headers.forEach((h, i) => {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.ink).text(h, x + 3, y + 4, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.y = y + 18;
  };
  drawHeader();
  for (const row of rows) {
    const cellHeights = row.map((cell, i) =>
      doc.heightOfString(String(cell ?? "-"), { width: widths[i] - 6, fontSize: 7.5 }),
    );
    const rowH = Math.max(12, ...cellHeights) + 6;
    if (doc.y + rowH > BOTTOM_LIMIT) {
      doc.addPage();
      drawHeader();
    }
    let x = MARGIN;
    const y = doc.y;
    row.forEach((cell, i) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(C.ink).text(String(cell ?? "-"), x + 3, y + 3, {
        width: widths[i] - 6,
      });
      x += widths[i];
    });
    doc.moveTo(MARGIN, y + rowH).lineTo(PAGE_W - MARGIN, y + rowH).strokeColor(C.rule).lineWidth(0.5).stroke();
    doc.y = y + rowH + 2;
  }
}

function renderHeader(doc, m) {
  doc.rect(0, 0, PAGE_W, 70).fill(C.navy);
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#FFFFFF").text(m.title, MARGIN, 22);
  doc.font("Helvetica").fontSize(8).fillColor("#DCE6FF").text(
    `Report ID ${m.meta.reportId}   |   Issued ${m.meta.issued}   |   Status ${m.meta.status}`,
    MARGIN,
    44,
  );
  doc.y = 84;
}

function renderCustomer(doc, m) {
  sectionTitle(doc, "Customer details");
  keyValueRows(doc, [
    ["Name", m.meta.name],
    ["Mobile", m.meta.mobile],
    ["PAN", m.meta.pan],
    ["Transaction ID", m.meta.txnId],
  ]);
}

function renderScore(doc, m) {
  sectionTitle(doc, "Credit score");
  const y = doc.y;
  doc.roundedRect(MARGIN, y, 170, 60, 6).fill("#EAF1FF");
  doc.font("Helvetica").fontSize(8).fillColor(C.label).text("SCORE", MARGIN + 12, y + 10);
  doc.font("Helvetica-Bold").fontSize(26).fillColor(C.navy).text(m.score, MARGIN + 12, y + 22);
  doc.font("Helvetica").fontSize(7.5).fillColor(C.label).text(m.scoreType, MARGIN + 12, y + 50, { width: 150 });
  doc.y = y;
  doc.x = MARGIN + 185;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.ink).text("Score factors", MARGIN + 185, y + 4);
  doc.font("Helvetica").fontSize(8).fillColor(C.ink).text(
    m.scoreFactors.length ? m.scoreFactors.join(", ") : "-",
    MARGIN + 185,
    y + 18,
    { width: CONTENT_W - 185 },
  );
  doc.y = y + 68;
  doc.x = MARGIN;
}

function renderSummary(doc, m) {
  sectionTitle(doc, "Account summary");
  const d = m.derived;
  keyValueRows(doc, [
    ["Enquiries in last 6 months", d["INQURIES-IN-LAST-SIX-MONTHS"]],
    ["New accounts in last 6 months", d["NEW-ACCOUNTS-IN-LAST-SIX-MONTHS"]],
    ["New delinquent accounts (6 months)", d["NEW-DELINQ-ACCOUNT-IN-LAST-SIX-MONTHS"]],
    ["Length of credit history", `${d["LENGTH-OF-CREDIT-HISTORY-YEAR"] ?? "-"} yr ${d["LENGTH-OF-CREDIT-HISTORY-MONTH"] ?? "-"} mo`],
    ["Average account age", `${d["AVERAGE-ACCOUNT-AGE-YEAR"] ?? "-"} yr ${d["AVERAGE-ACCOUNT-AGE-MONTH"] ?? "-"} mo`],
    ["Total accounts", m.accounts.length],
  ]);
}

function renderAccounts(doc, m) {
  sectionTitle(doc, `Accounts (${m.accounts.length})`);
  if (!m.accounts.length) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C.ink).text("No account records found.", MARGIN, doc.y);
    doc.moveDown(0.5);
    return;
  }
  table(
    doc,
    ["Lender", "Type", "Account", "Status", "Disbursed", "Current bal.", "Overdue", "EMI", "Reported"],
    m.accounts.map((a) => [
      txt(a["CREDIT-GUARANTOR"]),
      txt(a["ACCT-TYPE"]),
      maskAccount(a["ACCT-NUMBER"]),
      txt(a["ACCOUNT-STATUS"]) || "-",
      money(a["DISBURSED-AMT"]),
      money(a["CURRENT-BAL"]),
      money(a["OVERDUE-AMT"]),
      money(a["INSTALLMENT-AMT"]),
      txt(a["DATE-REPORTED"]),
    ]),
    [0.2, 0.12, 0.12, 0.09, 0.1, 0.11, 0.09, 0.08, 0.09],
  );
  doc.moveDown(0.5);
}

function renderPaymentHistory(doc, m) {
  const withHistory = m.accounts.filter((a) => txt(a["COMBINED-PAYMENT-HISTORY"]));
  if (!withHistory.length) return;
  sectionTitle(doc, "Payment history (latest first)");
  for (const a of withHistory) {
    ensureSpace(doc, 28);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.ink).text(
      `${txt(a["CREDIT-GUARANTOR"]) || "-"} (${maskAccount(a["ACCT-NUMBER"])})`,
      MARGIN,
      doc.y,
    );
    doc.font("Helvetica").fontSize(7.5).fillColor(C.ink).text(txt(a["COMBINED-PAYMENT-HISTORY"]), MARGIN, doc.y, {
      width: CONTENT_W,
    });
    doc.moveDown(0.4);
  }
}

function renderInquiries(doc, m) {
  sectionTitle(doc, `Enquiries (${m.inquiries.length})`);
  if (!m.inquiries.length) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C.ink).text("No enquiries found.", MARGIN, doc.y);
    doc.moveDown(0.5);
    return;
  }
  table(
    doc,
    ["Date", "Enquired by", "Purpose", "Amount"],
    m.inquiries.map((i) => [
      txt(i["DATE-OF-INQUIRY"] || i["INQUIRY-DATE"]),
      txt(i["INQUIRY-BY"] || i["SUBSCRIBER-NAME"]),
      txt(i["INQUIRY-PURPOSE"] || i["PURPOSE"]),
      money(i["AMOUNT"]),
    ]),
    [0.2, 0.4, 0.25, 0.15],
  );
  doc.moveDown(0.5);
}

function renderTrend(doc, m) {
  if (!m.trend.length) return;
  sectionTitle(doc, "Score history");
  table(
    doc,
    ["Date", "Score"],
    m.trend.map((t) => [t.date, t.value || "-"]),
    [0.5, 0.5],
  );
}

function renderDisclaimer(doc) {
  sectionTitle(doc, "Disclaimer");
  doc.font("Helvetica").fontSize(7.5).fillColor(C.label).text(
    "This report was generated from the bureau response for the details supplied. Verify with the bureau before taking a lending decision.",
    MARGIN,
    doc.y,
    { width: CONTENT_W },
  );
}

function stampFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7.5).fillColor(C.label).text(
      `Page ${i + 1} of ${range.count}`,
      MARGIN,
      PAGE_H - 26,
      { width: CONTENT_W, align: "center", lineBreak: false },
    );
  }
}

// Render one section, logging instead of throwing so the PDF is still produced.
function safe(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[CRIF PDF] section "${name}" failed:`, err.message);
  }
}

// rawReport: bureauData.credit_report from the CRIF response
// meta: { name, mobile, pan, txnId } from the request (used when the report omits them)
async function generateCrifPdf(rawReport, meta = {}) {
  const model = buildCrifModel(rawReport, meta);
  const doc = createDoc();
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  safe("header", () => renderHeader(doc, model));
  safe("customer", () => renderCustomer(doc, model));
  safe("score", () => renderScore(doc, model));
  safe("summary", () => renderSummary(doc, model));
  safe("accounts", () => renderAccounts(doc, model));
  safe("payment-history", () => renderPaymentHistory(doc, model));
  safe("inquiries", () => renderInquiries(doc, model));
  safe("trend", () => renderTrend(doc, model));
  safe("disclaimer", () => renderDisclaimer(doc));
  safe("footers", () => stampFooters(doc));

  doc.end();
  await done;
  return { buffer: Buffer.concat(chunks), model };
}

module.exports = { buildCrifModel, generateCrifPdf };
