// Styled CIBIL credit-report PDF rendered from Digi cibilData JSON
// (Digi v7 returns bureau JSON, not a PDF link — same pattern as
// experianCirPdf.generateExperianPdf). pdfkit-based, A4.
const PDFDocumentKit = require("pdfkit");

const PAGE_W = 595;
const MARGIN = 34;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = 806;

const C = {
  black: "#000000",
  grayDark: "#404040",
  grayText: "#595959",
  grayBar: "#D9D9D9",
  grid: "#BFBFBF",
  navy: "#002060",
  yellow: "#FFC000",
  teal: "#00A9CE",
  red: "#C00000",
  green: "#1E7E34",
};

// ---------- helpers ----------
const s = (v) => (v === undefined || v === null ? "" : String(v));
const asArray = (v) => {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const inr = (v) => {
  const n = num(v);
  if (n === null) return "";
  return `Rs ${n.toLocaleString("en-IN")}`;
};
const pick = (obj, keys) => {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
};

// TrueLink root (liberal casings, Digi v7 shape first)
const getTrueLink = (cibilData) => {
  if (!cibilData || typeof cibilData !== "object") return null;
  return (
    cibilData?.GetCustomerAssetsResponse?.GetCustomerAssetsSuccess?.Asset
      ?.TrueLinkCreditReport ||
    cibilData?.get_customer_assets_response?.get_customer_assets_success?.asset
      ?.true_link_credit_report ||
    cibilData?.TrueLinkCreditReport ||
    cibilData?.true_link_credit_report ||
    null
  );
};

// ---------- model ----------
function buildDigiCibilModel(parsed, meta = {}) {
  const cibilData = parsed?.cibilData || parsed || null;
  const tl = getTrueLink(cibilData);
  if (!tl) return null;
  const borrower = tl.Borrower || tl.borrower || {};

  const name =
    [
      pick(borrower, ["First_Name", "FirstName", "first_name"]),
      pick(borrower, ["Middle_Name", "MiddleName", "middle_name"]),
      pick(borrower, ["Last_Name", "Surname", "last_name", "surname"]),
    ]
      .map((x) => s(x).trim())
      .filter(Boolean)
      .join(" ") || s(meta.name).toUpperCase();

  const dob = s(pick(borrower, ["DateOfBirth", "DOB", "date_of_birth", "dob"]));
  const gender = s(pick(borrower, ["Gender", "gender"]));
  const pan =
    s(pick(borrower, ["PAN", "Pan", "pan"])) || s(meta.pan).toUpperCase();
  const mobile = s(meta.mobile);
  const addresses = asArray(
    borrower.Addresses?.Address || borrower.addresses || borrower.address,
  ).map((a) => {
    if (typeof a === "string") return a;
    return (
      [
        pick(a, ["Line1", "line1", "AddressLine1"]),
        pick(a, ["Line2", "line2", "AddressLine2"]),
        pick(a, ["City", "city"]),
        pick(a, ["State", "state"]),
        pick(a, ["PINCode", "Pincode", "pincode", "PostalCode"]),
      ]
        .map((x) => s(x).trim())
        .filter(Boolean)
        .join(", ") || JSON.stringify(a)
    );
  });
  const phones = asArray(
    borrower.Phones?.Phone || borrower.phones || borrower.phone,
  ).map((p) =>
    typeof p === "string" ? p : s(pick(p, ["Number", "number", "PhoneNumber"])),
  );

  const cs = borrower.CreditScore || borrower.credit_score || {};
  const score =
    num(pick(cs, ["riskScore", "risk_score"])) ??
    num(pick(tl, ["credit_score", "riskScore", "score"]));

  const tradePartition =
    tl.TradeLinePartition || tl.trade_line_partition || null;
  const accounts = asArray(
    tradePartition?.Tradeline || tradePartition?.tradeline,
  ).map((t) => ({
    subscriber: s(pick(t, ["Subscriber_Name", "subscriber_name", "SubscriberName"])),
    accountNumber: s(pick(t, ["Account_Number", "account_number", "AccountNumber"])),
    type: s(pick(t, ["Account_Type", "account_type", "accountTypeDescription"])),
    opened: s(pick(t, ["Date_Opened", "date_opened", "Open_Date"])),
    balance: pick(t, ["Current_Balance", "current_balance", "Balance"]),
    overdue: pick(t, ["Amount_Overdue", "amount_overdue", "Amount_Past_Due", "Overdue_Amount"]),
    status: s(pick(t, ["Account_Status", "account_status", "Status"])),
  }));

  const inquiryPartition =
    tl.InquiryPartition || tl.inquiry_partition || null;
  const inquiries = asArray(
    inquiryPartition?.Inquiry || inquiryPartition?.inquiry,
  ).map((q) => ({
    subscriber: s(pick(q, ["Subscriber_Name", "subscriber_name", "Institution"])),
    date: s(pick(q, ["Date", "date", "Inquiry_Date"])),
    purpose: s(pick(q, ["Purpose", "purpose", "Request_Purpose"])),
    amount: pick(q, ["Amount", "amount", "Loan_Amount"]),
  }));

  const now = new Date();
  return {
    name,
    dob,
    gender,
    pan,
    mobile,
    addresses,
    phones,
    score,
    accounts,
    inquiries,
    date: now.toLocaleDateString("en-IN"),
    time: now.toLocaleTimeString("en-IN", { hour12: false }),
  };
}

// ---------- render ----------
const createKitDoc = () => new PDFDocumentKit({ size: "A4", margin: MARGIN });

const ensureSpace = (doc, h) => {
  if (doc.y + h > BOTTOM_LIMIT) doc.addPage();
};

const sectionBar = (doc, title) => {
  ensureSpace(doc, 30);
  doc.fillColor(C.grayBar).rect(MARGIN, doc.y, CONTENT_W, 18).fill();
  doc.fillColor(C.black).font("Helvetica-Bold").fontSize(9);
  doc.text(title, MARGIN + 6, doc.y + 4);
  doc.moveDown(1.2);
};

const kv = (doc, label, value) => {
  doc.fillColor(C.grayText).font("Helvetica").fontSize(8);
  doc.text(`${label}: `, { continued: true });
  doc.fillColor(C.black).font("Helvetica-Bold");
  doc.text(s(value) || "-");
};

function renderModel(doc, m) {
  // Title band
  doc.fillColor(C.yellow).rect(MARGIN, doc.y, CONTENT_W, 26).fill();
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(14);
  doc.text("CIBIL Credit Report", MARGIN, doc.y + 6, {
    width: CONTENT_W,
    align: "center",
  });
  doc.moveDown(1.4);

  // Score strip
  doc.fillColor(C.teal).rect(MARGIN, doc.y, CONTENT_W, 2).fill();
  doc.moveDown(0.4);
  doc.fillColor(C.grayDark).font("Helvetica").fontSize(9);
  const scoreText =
    m.score !== null && m.score !== undefined
      ? `Credit Score: ${m.score}`
      : "Credit Score: Not available";
  doc.fillColor(m.score !== null && m.score >= 750 ? C.green : C.red)
    .font("Helvetica-Bold")
    .fontSize(16);
  doc.text(scoreText, MARGIN, doc.y, { width: CONTENT_W, align: "center" });
  doc.moveDown(0.8);

  // Borrower
  sectionBar(doc, "Borrower Details");
  kv(doc, "Name", m.name);
  kv(doc, "PAN", m.pan);
  kv(doc, "Mobile", m.mobile);
  kv(doc, "Date of Birth", m.dob);
  kv(doc, "Gender", m.gender);
  if (m.phones.length) kv(doc, "Phone(s)", m.phones.join(", "));
  if (m.addresses.length) {
    doc.fillColor(C.grayText).font("Helvetica").fontSize(8);
    doc.text("Address(es):");
    m.addresses.forEach((a) => {
      doc.fillColor(C.black).font("Helvetica").fontSize(8);
      doc.text(`  - ${a}`);
    });
  }
  doc.moveDown(0.4);

  // Accounts
  sectionBar(doc, `Credit Accounts (${m.accounts.length})`);
  if (!m.accounts.length) {
    doc.fillColor(C.grayText).font("Helvetica").fontSize(8);
    doc.text("No trade lines reported.");
  }
  m.accounts.forEach((a, i) => {
    ensureSpace(doc, 46);
    doc.fillColor(C.black).font("Helvetica-Bold").fontSize(8);
    doc.text(`${i + 1}. ${a.subscriber || "Lender"} (${a.type || "—"})`);
    doc.font("Helvetica").fontSize(7.5);
    doc.fillColor(C.grayDark);
    doc.text(
      `A/c: ${a.accountNumber || "—"}   Opened: ${a.opened || "—"}   Status: ${a.status || "—"}`,
    );
    const bal = a.balance !== "" && a.balance !== null ? inr(a.balance) : "—";
    const od = a.overdue !== "" && a.overdue !== null ? inr(a.overdue) : "—";
    doc.text(`Balance: ${bal}   Overdue: ${od}`);
    doc.moveDown(0.3);
  });

  // Inquiries
  sectionBar(doc, `Enquiries (${m.inquiries.length})`);
  if (!m.inquiries.length) {
    doc.fillColor(C.grayText).font("Helvetica").fontSize(8);
    doc.text("No enquiries reported.");
  }
  m.inquiries.forEach((q, i) => {
    ensureSpace(doc, 28);
    doc.fillColor(C.black).font("Helvetica").fontSize(7.5);
    const amt = q.amount ? `  Amount: ${inr(q.amount)}` : "";
    doc.text(
      `${i + 1}. ${q.subscriber || "—"}  |  ${q.date || "—"}  |  ${q.purpose || "—"}${amt}`,
    );
  });

  doc.moveDown(0.6);
  ensureSpace(doc, 14);
  doc.fillColor(C.grayText).font("Helvetica").fontSize(7);
  doc.text(
    `Generated on ${m.date} ${m.time} (IST) via Credit Dost. For information only.`,
    MARGIN,
    doc.y,
    { width: CONTENT_W, align: "center" },
  );
}

async function generateDigiCibilPdf(parsed, meta = {}) {
  const model = buildDigiCibilModel(parsed, meta);
  if (!model) return null;
  const kitDoc = createKitDoc();
  const chunks = [];
  kitDoc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    kitDoc.on("end", resolve);
    kitDoc.on("error", reject);
  });
  renderModel(kitDoc, model);
  kitDoc.end();
  await done;
  return { buffer: Buffer.concat(chunks), model };
}

module.exports = {
  buildDigiCibilModel,
  generateDigiCibilPdf,
};
