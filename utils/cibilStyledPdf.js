// Styled CIBIL credit-report PDF matching the reference design:
// navy gradient banner + generated strip, card grids, navy score card,
// status/summary mini-cards, light tables, per-account cards with
// DEC->JAN payment-history grid, enquiries table, disclaimer box,
// centered "Page i of N" footers.
// Data source: IndiConnect parsed result (__indiconnect with cibilData
// TrueLink JSON). Live shapes (verified 2026-10-14):
//   TrueLinkCreditReport = {
//     Borrower: { BorrowerName.Name.{Forename,Surname}, Birth.date,
//       Gender, CreditScore.{riskScore,scoreName,CreditScoreModel.symbol,
//       populationRank}, BorrowerAddress[].{CreditAddress.{StreetAddress,
//       City,PostalCode,Region},dateReported,Origin.symbol},
//       BorrowerTelephone[].PhoneNumber.Number, EmailAddress[].Email,
//       IdentifierPartition.Identifier[].ID.{Id,IdentifierName},
//       Employer.{name,dateReported} },
//     SafetyCheckPassed, Frozen, DeceasedIndicator, FraudIndicator,
//     TradeLinePartition: [ { accountTypeSymbol, Tradeline: {
//       creditorName, accountNumber, dateOpened, dateReported,
//       currentBalance, highBalance, GrantedTrade.{interestRate,
//       EMIAmount, CashLimit, CreditLimit, amountPastDue, termMonths,
//       dateLastPayment, PayStatusHistory.{MonthlyPayStatus[].{date,status}} },
//       settlementAmount, writtenOffPrincipal, OpenClosed.symbol } } ],
//     InquiryPartition: [ { Inquiry: { subscriberName, inquiryDate,
//       inquiryType, amount, enqControlNum } } ]   // array when >1,
//     // or { Inquiry } single object, or numeric-keyed object }
// NOTE: bureau string values arrive wrapped in literal quotes ("\"746\"").
const PDFDocumentKit = require("pdfkit");
const fs = require("fs");

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = 772; // content must stop here; footer stamped at FOOTER_Y
const FOOTER_Y = 792; // inside writable area (<=802): never triggers auto-add
const TITLE_Y = 18; // tiny running title above content top

const C = {
  ink: "#16233F",
  navy: "#1E3A8A",
  accent: "#2563EB",
  label: "#7C8AA5",
  rule: "#D8E0EC",
  line: "#D9E2EF",
  div: "#E5EAF1",
  headFill: "#F1F5F9",
  scoreBg: "#EAF1FF",
  boxBg: "#F8FAFC",
  green: "#15803D",
  red: "#C81E1E",
  gray: "#64748B",
  white: "#FFFFFF",
};

// ---------- rupee-capable font (Helvetica has no U+20B9 glyph) ----------
const RUPEE_CANDIDATES = [
  process.env.RUPEE_FONT,
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\Nirmala.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
].filter(Boolean);
const RUPEE_BOLD_CANDIDATES = [
  process.env.RUPEE_BOLD_FONT,
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
].filter(Boolean);
const RUPEE_REG = RUPEE_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
const RUPEE_BLD = RUPEE_BOLD_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || RUPEE_REG;
// Money values render in Arial (metrically identical to Helvetica) so ₹ prints.
const mfont = (doc, bold) => {
  if (RUPEE_REG) doc.font(bold && RUPEE_BLD ? "Rupee-Bold" : "Rupee");
  else doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  return doc;
};

// ---------- generic helpers ----------
// Strip the literal wrapping quotes the bureau puts around string values.
const unq = (v) => {
  let t = v === undefined || v === null ? "" : String(v).trim();
  while (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1).trim();
  }
  return t;
};
const s = (v) => unq(v);
const asArray = (v) => {
  if (v === undefined || v === null || v === "") return [];
  return Array.isArray(v) ? v : [v];
};
// Partition nodes arrive as array, single object, or numeric-keyed object.
const asPartitionList = (v) => {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") {
    const ks = Object.keys(v);
    if (ks.length && ks.every((k) => /^\d+$/.test(k))) {
      return ks.sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
    }
    return [v];
  }
  return [v];
};
const num = (v) => {
  const t = s(v);
  if (t === "") return null;
  const n = Number(t.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
// case-insensitive key pick: returns first matching key's value
const pick = (obj, keys) => {
  if (!obj || typeof obj !== "object") return undefined;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const k of keys) {
    const v = lower[String(k).toLowerCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const pickObj = (obj, keys) => {
  const v = pick(obj, keys);
  return v && typeof v === "object" ? v : null;
};
const sym = (v) => {
  // {symbol, description, ...} code objects -> symbol; else scalar
  if (v && typeof v === "object") {
    const p = pick(v, ["symbol", "value", "code"]);
    return s(p !== undefined ? p : "");
  }
  return s(v);
};
const fmtDate = (v) => {
  const t = s(v);
  if (!t) return "";
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) return t;
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  if (/^\d{8}$/.test(t)) return `${t.slice(6, 8)}-${t.slice(4, 6)}-${t.slice(0, 4)}`;
  const m2 = t.match(/^(\d{2})[\/](\d{2})[\/](\d{4})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return t.length <= 12 ? t : t.slice(0, 10);
};
const fmtMoney = (v) => {
  const n = num(v);
  if (n === null) {
    const t = s(v);
    return t === "" ? "-" : t;
  }
  return (RUPEE_REG ? "\u20B9 " : "Rs. ") + n.toLocaleString("en-IN");
};
const disp = (v) => {
  const t = s(v);
  if (t === "" || t === "-1" || t === "-1.00") return "-";
  return t;
};
// Money for display: "-1"/empty (not reported) -> "-"
const money = (v) => {
  const t = s(v);
  if (t === "" || t === "-1" || t === "-1.00") return "-";
  return fmtMoney(t);
};
const stripLeadingZeroMobile = (v) => {
  const t = s(v).replace(/\D/g, "");
  if (t.length === 11 && t.startsWith("0")) return t.slice(1);
  return t;
};

// Unwrap TrueLink report from the many envelope casings seen live.
function getTrueLink(cibilData) {
  if (!cibilData || typeof cibilData !== "object") return null;
  const asset =
    cibilData?.GetCustomerAssetsResponse?.GetCustomerAssetsSuccess?.Asset ||
    cibilData?.get_customer_assets_response?.get_customer_assets_success?.asset ||
    pickObj(cibilData, ["asset"]) ||
    null;
  const fromAsset =
    asset?.TrueLinkCreditReport ||
    asset?.true_link_credit_report ||
    pickObj(asset || {}, ["truelinkcreditreport", "true_link_credit_report"]) ||
    null;
  if (fromAsset) return fromAsset;
  const direct =
    cibilData?.TrueLinkCreditReport ||
    cibilData?.true_link_credit_report ||
    pickObj(cibilData, ["truelinkcreditreport", "true_link_credit_report"]);
  if (direct) return direct;
  if (pick(cibilData, ["borrower"])) return cibilData;
  return null;
}

// ---------- model (live TrueLink keys) ----------
function buildCibilModel(parsed, meta = {}) {
  const cibilData = parsed?.cibilData || parsed || null;
  const tl = getTrueLink(cibilData) || {};
  const B = pickObj(tl, ["borrower"]) || {};

  // ---- name: BorrowerName.Name.{Forename, Surname} (Forename usually full)
  const nameNode = pickObj(pickObj(B, ["borrowerName", "borrower_name"]) || {}, ["name"]) || {};
  const forename = s(pick(nameNode, ["forename", "firstName", "first_name"]));
  const surname = s(pick(nameNode, ["surname", "lastName", "last_name"]));
  let fullName =
    s(pick(B, ["fullName", "full_name"])) ||
    (forename && surname && !forename.toUpperCase().includes(surname.toUpperCase())
      ? `${forename} ${surname}`
      : forename || surname) ||
    "";
  if (!fullName) fullName = s(meta.name).toUpperCase();

  // ---- birth / gender
  const birthNode = pickObj(B, ["birth"]) || {};
  const dob =
    fmtDate(pick(birthNode, ["date"]) || pick(B, ["dateOfBirth", "date_of_birth", "dob", "birthDate"])) ||
    fmtDate(meta.dob);
  const gender = s(pick(B, ["gender", "sex"])) || s(meta.gender);

  // ---- score
  const scoreNode = pickObj(B, ["creditScore", "credit_score", "score"]) || {};
  const scoreModel =
    s(pick(pickObj(scoreNode, ["creditScoreModel", "scoreModel"]) || {}, ["symbol"])) ||
    s(pick(scoreNode, ["scoreModel", "score_model"])) || "CIBILTUSC3";
  const score =
    s(pick(scoreNode, ["riskScore", "risk_score", "score"])) || s(parsed?.score) || "";
  const scoreName = s(pick(scoreNode, ["scoreName", "score_name"])) || "CIBILTransUnionScore3";
  const populationRank = s(pick(scoreNode, ["populationRank", "rank"])) || "";

  // ---- report-level flags
  const safetyRaw = pick(tl, ["safetyCheckPassed", "safetyCheck", "safety"]);
  const safetyPassed = safetyRaw === true || s(safetyRaw).toLowerCase() === "true" ? "Yes" : s(safetyRaw) || "Yes";
  const fileFrozen = s(pick(tl, ["frozen", "fileFrozen"])) || "Not reported";
  const deceasedRaw = pick(tl, ["deceasedIndicator", "deceased"]);
  const deceased = deceasedRaw === true || s(deceasedRaw).toLowerCase() === "true" ? "Yes" : "No";
  const fraudRaw = pick(tl, ["fraudIndicator", "fraud"]);
  const fraud = fraudRaw === true || s(fraudRaw).toLowerCase() === "true" ? "Yes" : "No";

  // ---- mobiles (variants like 91-prefixed dupes collapse by last 10 digits)
  const mobiles = [];
  const seen10 = new Set();
  const pushMobile = (raw) => {
    const digits = s(raw).replace(/\D/g, "");
    if (!digits) return;
    const key = digits.length > 10 ? digits.slice(-10) : digits;
    if (key.length < 10 || seen10.has(key)) return;
    seen10.add(key);
    mobiles.push(key);
  };
  for (const t of asArray(pick(B, ["borrowerTelephone", "telephones", "phone", "phones", "mobile"]))) {
    let raw = t;
    if (t && typeof t === "object") {
      const pn = pickObj(t, ["phoneNumber", "phone", "number"]);
      raw = (pn && pick(pn, ["number", "mobile", "phone"])) ?? pick(t, ["number", "mobile", "phone"]);
    }
    pushMobile(raw);
  }
  pushMobile(meta.mobile);
  if (!mobiles.length && meta.mobile) mobiles.push(stripLeadingZeroMobile(meta.mobile));

  // ---- emails: EmailAddress[].Email
  const emails = [];
  for (const e of asArray(pick(B, ["emailAddress", "emails", "email"]))) {
    const v = e && typeof e === "object" ? s(pick(e, ["email", "id", "address"])) : s(e);
    if (v && v.includes("@") && !emails.includes(v)) emails.push(v);
  }

  // ---- addresses
  const addresses = asArray(pick(B, ["borrowerAddress", "addresses", "address"])).map((a, i) => {
    if (typeof a === "string") return { idx: i + 1, line: a, city: "", state: "", pin: "", date: "", source: "" };
    const ca = pickObj(a, ["creditAddress", "address"]) || {};
    const origin = pickObj(a, ["origin"]) || {};
    return {
      idx: i + 1,
      line: s(pick(ca, ["streetAddress", "line", "fullAddress"])) || "-",
      city: s(pick(ca, ["city"])) || "-",
      state: s(pick(ca, ["region", "state"])) || "-",
      pin: s(pick(ca, ["postalCode", "pin", "pincode", "zip"])) || "-",
      date: fmtDate(pick(a, ["dateReported", "reportedDate", "date"])),
      source: sym(pick(a, ["origin"])) || s(pick(origin, ["symbol"])) || s(pick(a, ["source", "subscriber"])),
    };
  });

  // ---- identifiers + meta PAN
  const idPartition = pickObj(B, ["identifierPartition"]) || {};
  const identifiers = asArray(pick(idPartition, ["identifier", "identifiers", "ids"])).map((x) => {
    const id = pickObj(x, ["id"]) || x;
    if (typeof id === "string") return { type: "-", value: id };
    return {
      type: s(pick(id, ["identifierName", "type", "idType"])) || "-",
      value: s(pick(id, ["id", "number", "value"])) || "-",
    };
  });
  const pan = s(meta.pan) || (identifiers.find((r) => /pan|income.?tax/i.test(r.type)) || {}).value || "";
  if (pan && !identifiers.some((r) => r.value === pan)) {
    identifiers.unshift({ type: "PAN", value: pan });
  }

  // ---- employment: Employer (single object)
  const empRaw = pick(B, ["employer", "employment", "employments"]);
  const employments = asArray(empRaw).map((e) => {
    if (typeof e === "string") return { employer: e, occupation: "-", date: "" };
    return {
      employer: s(pick(e, ["name", "employer", "employerName", "company"])) || "-",
      occupation: s(pick(e, ["occupation", "designation"])) || "-",
      date: fmtDate(pick(e, ["dateReported", "reportedDate", "date"])),
    };
  });

  // ---- accounts: TradeLinePartition[] -> { Tradeline }
  const tpRaw = pick(tl, ["tradeLinePartition", "tradelinepartition", "accounts", "account"]);
  const accounts = asPartitionList(tpRaw).map((item, i) => {
    const t = (item && typeof item === "object" && (pickObj(item, ["tradeline"]) || null)) || item || {};
    if (!t || typeof t !== "object") return null;
    const gt = pickObj(t, ["grantedTrade", "granted_trade"]) || {};
    const acctTypeSym =
      sym(pick(gt, ["accountType", "creditType"])) ||
      s(pick(item, ["accountTypeSymbol", "accountType"])) ||
      "-";
    const histNode = pickObj(gt, ["payStatusHistory", "pay_status_history"]) || {};
    const monthly = asArray(pick(histNode, ["monthlyPayStatus", "monthly_pay_status"]));
    const history = monthly.map((h) => {
      const d = s(pick(h, ["date"]));
      const dm = d.match(/^(\d{4})-(\d{2})/);
      return {
        y: dm ? dm[1] : "",
        m: dm ? dm[2] : d.slice(0, 7),
        v: s(pick(h, ["status", "dpd", "value"])) || "-",
      };
    }).filter((h) => h.m);
    const ocSym = sym(pick(t, ["openClosed", "open_closed"])).toUpperCase();
    const hasClosedDate = !!s(pick(t, ["dateClosed", "closed", "closeDate"]));
    const closed = hasClosedDate || ocSym === "C" || ocSym === "CLOSED";
    return {
      idx: i + 1,
      subscriber: s(pick(t, ["creditorName", "subscriber", "subscriberName", "lender", "thirdPartyName"])) || `LENDER ${i + 1}`,
      accountNumber: s(pick(t, ["accountNumber", "account_number", "acctNo"])) || "-",
      accountType: acctTypeSym,
      opened: fmtDate(pick(t, ["dateOpened", "opened", "openDate"])),
      closed: hasClosedDate ? fmtDate(pick(t, ["dateClosed", "closed", "closeDate"])) : (closed ? "Closed" : "-"),
      _isClosed: closed,
      reported: fmtDate(pick(t, ["dateReported", "reported", "dateAccountStatus"])),
      currentBalance: s(pick(t, ["currentBalance", "current_balance"])) || "0",
      highBalance: s(pick(t, ["highBalance", "high_balance"])) || "-",
      creditLimit: s(pick(gt, ["creditLimit", "credit_limit"])) || "-",
      cashLimit: s(pick(gt, ["cashLimit", "cash_limit"])) || "-",
      pastDue: s(pick(gt, ["amountPastDue", "pastDue", "overdue"])) || "0",
      interestRate: s(pick(gt, ["interestRate", "rate"])) || "",
      emi: s(pick(gt, ["emiAmount", "emi", "scheduledPayment", "actualPaymentAmount"])) || "-",
      tenure: s(pick(gt, ["termMonths", "tenure", "term"])) || "-",
      lastPayment: fmtDate(pick(gt, ["dateLastPayment", "lastPayment", "last_paid"])),
      writtenOff: s(pick(t, ["writtenOffPrincipal", "written_off", "writeOff"])) || "-",
      settlement: s(pick(t, ["settlementAmount", "settlement"])) || "-",
      history,
    };
  }).filter(Boolean);

  // ---- summary from accounts ("-1" = not reported, excluded from totals)
  let active = 0;
  let closedCount = 0;
  let curSum = 0;
  let highSum = 0;
  let odSum = 0;
  for (const t of accounts) {
    if (t._isClosed) closedCount += 1;
    else active += 1;
    const cb = num(t.currentBalance);
    if (cb !== null && cb > 0) curSum += cb;
    const hb = num(t.highBalance);
    if (hb !== null && hb > 0) highSum += hb;
    const od = num(t.pastDue);
    if (od !== null && od > 0) odSum += od;
  }
  const summary = {
    total: String(accounts.length),
    active: String(active),
    closed: String(closedCount),
    currentBalance: String(curSum),
    highBalance: String(highSum),
    pastDue: String(odSum),
  };

  // ---- enquiries: InquiryPartition is usually an ARRAY of {Inquiry:{...}}
  const inqPartitionRaw = pick(tl, ["inquiryPartition", "enquiryPartition", "enquiries", "inquiries"]);
  const enquiries = asPartitionList(inqPartitionRaw).map((q) => {
    const node = (q && typeof q === "object" && (pickObj(q, ["inquiry", "enquiry"]) || null)) || q;
    if (typeof node === "string") return { member: node, date: "", type: "-", amount: "-", control: "-" };
    return {
      member: s(pick(node, ["subscriberName", "subscriber", "member", "lender"])) || "-",
      date: fmtDate(pick(node, ["inquiryDate", "enquiryDate", "date", "requestedOn"])),
      type: s(pick(node, ["inquiryType", "enquiryType", "type", "purpose"])) || "-",
      amount: s(pick(node, ["amount", "enquiryAmount", "loanAmount"])) || "-",
      control: s(pick(node, ["enqControlNum", "controlNumber", "control", "refNo"])) || "-",
    };
  });

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const pad2 = (n) => String(n).padStart(2, "0");
  let hh = now.getHours();
  const ampm = hh >= 12 ? "pm" : "am";
  hh = hh % 12 || 12;
  const generatedOn =
    `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}, ` +
    `${pad2(hh)}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} ${ampm}`;

  return {
    controlNumber:
      s(pick(tl, ["referenceKey", "controlNumber", "controlNo", "reportNumber"])) ||
      s(parsed?.txn_id) || s(meta.txnId) || "-",
    reportVersion: s(pick(tl, ["currentversion", "version", "reportVersion"])) || "5.0",
    generatedOn,
    consumer: fullName,
    dob: dob || "",
    gender,
    mobiles,
    emails,
    score,
    scoreModel,
    scoreName,
    populationRank,
    safetyPassed,
    fileFrozen,
    deceased,
    fraud,
    pan,
    summary,
    addresses,
    identifiers,
    employments,
    accounts,
    enquiries,
  };
}

// ---------- drawing ----------
// Pagination model: pdfkit auto-creates a page whenever text is drawn past
// (pageHeight - bottomMargin) = 842 - 40 = 802. So ALL drawing stays at
// y <= ~780, and footers + running titles are stamped once at the end over
// buffered pages (correct "Page i of N", never blank spill pages).
function createKitDoc() {
  const doc = new PDFDocumentKit({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: 40, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: true,
    info: { Title: "CIBIL Credit Information Report" },
  });
  if (RUPEE_REG) {
    try { doc.registerFont("Rupee", RUPEE_REG); } catch { /* fallback to Rs. */ }
    try { if (RUPEE_BLD) doc.registerFont("Rupee-Bold", RUPEE_BLD); } catch { /* ignore */ }
  }
  return doc;
}
function stampChrome(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(C.gray).font("Helvetica").fontSize(7)
      .text("CIBIL Credit Information Report", MARGIN, TITLE_Y, { width: CONTENT_W, align: "left", lineBreak: false });
    doc.fillColor(C.gray).font("Helvetica").fontSize(7.5)
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "center", lineBreak: false });
  }
}
function ensureSpace(doc, need) {
  if (doc.y + need > BOTTOM_LIMIT) doc.addPage();
}
function gap(doc, pts = 10) {
  doc.y += pts;
  doc.x = MARGIN;
}

// section heading: blue bar vertically centered on the title + optional right note + rule
function sectionTitle(doc, text, rightText = "") {
  ensureSpace(doc, 30);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(11.5);
  const th = doc.heightOfString(text, { width: CONTENT_W - 11 });
  const barH = 15;
  const barY = y + Math.max(0, (th - barH) / 2);
  doc.fillColor(C.accent).rect(MARGIN, barY, 4, barH).fill();
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(11.5)
    .text(text, MARGIN + 11, y, { width: CONTENT_W - 11, lineBreak: false });
  if (rightText) {
    doc.fillColor(C.gray).font("Helvetica").fontSize(7.5)
      .text(rightText, MARGIN, y + 3, { width: CONTENT_W, align: "right", lineBreak: false });
  }
  const ry = y + 20;
  doc.strokeColor(C.rule).lineWidth(1).moveTo(MARGIN, ry).lineTo(MARGIN + CONTENT_W, ry).stroke();
  doc.y = ry + 8;
  doc.x = MARGIN;
}
// smaller blue-bar sub heading (Mobile Number, Email ID, Payment History)
function subHead(doc, text) {
  ensureSpace(doc, 22);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(10);
  const th = doc.heightOfString(text, { width: CONTENT_W - 9 });
  const barH = 12;
  doc.fillColor(C.accent).rect(MARGIN, y + Math.max(0, (th - barH) / 2), 3, barH).fill();
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(10)
    .text(text, MARGIN + 9, y, { width: CONTENT_W - 9, align: "left" });
  doc.y = y + 19;
  doc.x = MARGIN;
}

// column widths from weights
function colWidths(cells) {
  const weights = cells.map((c) => c.weight || 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * CONTENT_W);
}
function cellHeight(doc, cell, w, labelSize = 7, valSize = 8.5) {
  doc.font("Helvetica").fontSize(labelSize);
  const lh = doc.heightOfString(cell.label || "", { width: w });
  const vf = cell.money ? (RUPEE_REG ? "Rupee" : "Helvetica") : "Helvetica";
  doc.font(vf).fontSize(valSize);
  const vh = Math.max(doc.heightOfString(cell.value || "-", { width: w }), valSize + 2);
  return lh + 3 + vh;
}
function drawCell(doc, cell, x, y, w, labelSize = 7, valSize = 8.5) {
  // Padding cells (empty label + empty value) stay blank like the reference.
  if ((cell.value === "" || cell.value === undefined) && !cell.label) return;
  doc.fillColor(C.label).font("Helvetica").fontSize(labelSize)
    .text(cell.label || "", x, y, { width: w, align: "left" });
  const vy = y + doc.heightOfString(cell.label || "", { width: w }) + 3;
  if (cell.money && RUPEE_REG) mfont(doc, false);
  else doc.font("Helvetica");
  doc.fontSize(valSize).fillColor(cell.color || C.ink)
    .text(cell.value || "-", x, vy, { width: w, align: "left" });
}
// rounded grid box; rows = [{cells:[{label,value,color,money,weight}]}]
function gridBox(doc, rows, opts = {}) {
  const padX = 12, padT = 8, padB = 9;
  const labelSize = opts.labelSize || 7, valSize = opts.valSize || 8.5;
  const rowHs = rows.map((r) => {
    const ws = colWidths(r.cells);
    let mh = 0;
    r.cells.forEach((c, i) => { mh = Math.max(mh, cellHeight(doc, c, ws[i] - padX * 2, labelSize, valSize)); });
    return mh + padT + padB;
  });
  const totalH = rowHs.reduce((a, b) => a + b, 0);
  ensureSpace(doc, totalH);
  const y0 = doc.y;
  doc.strokeColor(C.line).lineWidth(0.9).roundedRect(MARGIN, y0, CONTENT_W, totalH, 8).stroke();
  let y = y0;
  rows.forEach((r, ri) => {
    const ws = colWidths(r.cells);
    let x = MARGIN;
    r.cells.forEach((c, i) => {
      drawCell(doc, c, x + padX, y + padT, ws[i] - padX * 2, labelSize, valSize);
      if (i < r.cells.length - 1) {
        const dx = x + ws[i];
        doc.strokeColor(C.div).lineWidth(0.6).moveTo(dx, y + 7).lineTo(dx, y + rowHs[ri] - 7).stroke();
      }
      x += ws[i];
    });
    y += rowHs[ri];
    if (ri < rows.length - 1) {
      doc.strokeColor(C.div).lineWidth(0.6).moveTo(MARGIN + 8, y).lineTo(MARGIN + CONTENT_W - 8, y).stroke();
    }
  });
  doc.y = y0 + totalH + (opts.after ?? 10);
  doc.x = MARGIN;
}
// row of mini cards; card = {label, value, color, money, accent}
function miniCards(doc, cards, perRow, opts = {}) {
  const cardH = opts.h || 62;
  const valueSize = opts.valueSize || 13;
  const gapX = 10, gapY = 10;
  const cardW = (CONTENT_W - gapX * (perRow - 1)) / perRow;
  const rows = [];
  for (let i = 0; i < cards.length; i += perRow) rows.push(cards.slice(i, i + perRow));
  const totalH = rows.length * cardH + (rows.length - 1) * gapY;
  ensureSpace(doc, totalH);
  let y = doc.y;
  rows.forEach((row) => {
    let x = MARGIN;
    row.forEach((c) => {
      doc.strokeColor(C.line).lineWidth(0.9).roundedRect(x, y, cardW, cardH, 8).stroke();
      if (c.accent) {
        doc.strokeColor(C.accent).lineWidth(3)
          .moveTo(x + 6, y + 10).lineTo(x + 6, y + cardH - 10).stroke();
      }
      doc.fillColor(C.label).font("Helvetica").fontSize(6.8)
        .text(c.label || "", x + (c.accent ? 14 : 10), y + 9, { width: cardW - 20, align: "left", lineBreak: false });
      if (c.money && RUPEE_REG) mfont(doc, true);
      else doc.font("Helvetica-Bold");
      doc.fontSize(valueSize).fillColor(c.color || C.ink)
        .text(c.value || "-", x + (c.accent ? 14 : 10), y + 24, { width: cardW - 24, align: "left" });
      x += cardW + gapX;
    });
    y += cardH + gapY;
  });
  doc.y = y - gapY + 10;
  doc.x = MARGIN;
}
// light table: gray header, thin grid, rounded outer border
function lightTable(doc, headers, rows, opts = {}) {
  const size = opts.size || 7.5;
  const headerSize = opts.headerSize || 7;
  const gapX = 0;
  const padX = 5, padT = 4, padB = 4;
  const n = headers.length;
  const raw = opts.widths && opts.widths.length === n ? opts.widths : headers.map(() => 1);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const w = raw.map((x) => (x / total) * CONTENT_W);
  const drawRow = (cols, isHeader, moneyCols) => {
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(isHeader ? headerSize : size);
    const heights = cols.map((c, i) => doc.heightOfString(s(c), { width: w[i] - padX * 2 }));
    const h = Math.max(opts.minRowH || 13, ...heights) + padT + padB;
    ensureSpace(doc, h);
    const y = doc.y;
    if (isHeader) {
      doc.fillColor(C.headFill).rect(MARGIN, y, CONTENT_W, h).fill();
    }
    let x = MARGIN;
    cols.forEach((c, i) => {
      const useMoney = !isHeader && moneyCols && moneyCols.has(i) && RUPEE_REG;
      if (useMoney) mfont(doc, false);
      else doc.font(isHeader ? "Helvetica-Bold" : "Helvetica");
      doc.fontSize(isHeader ? headerSize : size)
        .fillColor(isHeader ? C.gray : C.ink)
        .text(s(c), x + padX, y + padT, { width: w[i] - padX * 2, align: "left" });
      x += w[i] + gapX;
    });
    doc.strokeColor(C.line).lineWidth(0.6);
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + CONTENT_W, y + h).stroke();
    let vx = MARGIN;
    for (let i = 0; i < n - 1; i++) {
      vx += w[i];
      doc.moveTo(vx, y + (isHeader ? 0 : 0)).lineTo(vx, y + h).stroke();
    }
    doc.y = y + h;
    doc.x = MARGIN;
  };
  const y0 = doc.y;
  drawRow(headers, true);
  rows.forEach((r) => drawRow(r, false, opts.moneyCols));
  const y1 = doc.y;
  doc.strokeColor(C.line).lineWidth(0.9).roundedRect(MARGIN, y0, CONTENT_W, y1 - y0, 6).stroke();
  doc.y = y1 + 10;
  doc.x = MARGIN;
}

// ---------- sections ----------
function banner(doc, m) {
  ensureSpace(doc, 140);
  const y0 = doc.y;
  const H = 92;
  let fill = "#1A3263";
  try {
    const grad = doc.linearGradient(MARGIN, 0, MARGIN + CONTENT_W, 0);
    grad.stop(0, "#15295C");
    grad.stop(1, "#2456A6");
    fill = grad;
  } catch { fill = "#1A3263"; }
  doc.roundedRect(MARGIN, y0, CONTENT_W, H, 10).fill(fill);
  const titleW = (MARGIN + CONTENT_W - 196) - (MARGIN + 22) - 10; // stop before the divider
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(17)
    .text("CREDIT INFORMATION REPORT", MARGIN + 22, y0 + 20, { width: titleW, lineBreak: false });
  doc.fillColor("#C9D6F2").font("Helvetica").fontSize(9.5)
    .text("CIBIL Credit Report", MARGIN + 22, y0 + 45, { width: titleW, lineBreak: false });
  const dx = MARGIN + CONTENT_W - 196; // 18pt inner padding: control no. never touches the rounded edge
  doc.strokeColor("#5B7BC0").lineWidth(1).moveTo(dx, y0 + 16).lineTo(dx, y0 + H - 16).stroke();
  const rx = dx + 14, rw = 164; // right edge sits 18pt inside the banner
  doc.fillColor("#9FB3D9").font("Helvetica").fontSize(7)
    .text("CONTROL NUMBER", rx, y0 + 18, { width: rw, align: "right", lineBreak: false });
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(10.5)
    .text(m.controlNumber, rx, y0 + 29, { width: rw, align: "right", lineBreak: false });
  doc.fillColor("#9FB3D9").font("Helvetica").fontSize(7)
    .text("REPORT VERSION", rx, y0 + 47, { width: rw, align: "right", lineBreak: false });
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(10.5)
    .text(m.reportVersion, rx, y0 + 58, { width: rw, align: "right", lineBreak: false });
  doc.y = y0 + H + 8;
  // generated strip
  const sy = doc.y;
  doc.fillColor(C.headFill).roundedRect(MARGIN, sy, CONTENT_W, 26, 6).fill();
  doc.fillColor(C.gray).font("Helvetica").fontSize(8)
    .text("Generated On", MARGIN + 12, sy + 8, { width: 200, lineBreak: false });
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(8.5)
    .text(m.generatedOn, MARGIN, sy + 8, { width: CONTENT_W - 12, align: "right", lineBreak: false });
  doc.y = sy + 26 + 12;
  doc.x = MARGIN;
}

function accountCard(doc, t) {
  ensureSpace(doc, 60);
  const y0 = doc.y;
  const HH = 40;
  doc.fillColor(C.scoreBg).roundedRect(MARGIN, y0, CONTENT_W, HH, 8).fill();
  doc.fillColor(C.label).font("Helvetica").fontSize(7)
    .text(`ACCOUNT ${t.idx}`, MARGIN + 12, y0 + 7, { width: 200, lineBreak: false });
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(11)
    .text(t.subscriber + (t._isClosed ? "  (Closed)" : ""), MARGIN + 12, y0 + 19, { width: CONTENT_W - 60, lineBreak: false });
  doc.strokeColor("#9DB6DD").lineWidth(1).circle(MARGIN + CONTENT_W - 24, y0 + HH / 2, 9).stroke();
  doc.strokeColor("#9DB6DD").lineWidth(1.2)
    .moveTo(MARGIN + CONTENT_W - 28, y0 + HH / 2).lineTo(MARGIN + CONTENT_W - 20, y0 + HH / 2).stroke();
  doc.y = y0 + HH + 8;
  doc.x = MARGIN;

  const interest = s(t.interestRate) === "" ? "-" : s(t.interestRate);
  gridBox(doc, [
    { cells: [
      { label: "ACCOUNT NUMBER", value: t.accountNumber },
      { label: "ACCOUNT TYPE", value: t.accountType },
      { label: "ACCOUNT TYPE CODE", value: t.accountType },
      { label: "DATE OPENED", value: t.opened || "-" },
    ] },
    { cells: [
      { label: "DATE CLOSED", value: t.closed || "-" },
      { label: "DATE REPORTED", value: t.reported || "-" },
      { label: "CURRENT BALANCE", value: money(t.currentBalance), money: true },
      { label: "HIGH BALANCE", value: money(t.highBalance), money: true },
    ] },
    { cells: [
      { label: "CREDIT LIMIT", value: money(t.creditLimit), money: true },
      { label: "CASH LIMIT", value: money(t.cashLimit), money: true },
      { label: "AMOUNT PAST DUE", value: money(t.pastDue), money: true },
      { label: "INTEREST RATE", value: interest },
    ] },
    { cells: [
      { label: "EMI AMOUNT", value: disp(t.emi) === "-" ? "-" : money(t.emi), money: disp(t.emi) !== "-" },
      { label: "TENURE", value: disp(t.tenure) },
      { label: "LAST PAYMENT DATE", value: t.lastPayment || "-" },
      { label: "WRITTEN OFF AMOUNT", value: disp(t.writtenOff) },
    ] },
    { cells: [
      { label: "SETTLEMENT AMOUNT", value: disp(t.settlement) },
      { label: "", value: "" },
      { label: "", value: "" },
      { label: "", value: "" },
    ] },
  ], { after: 8 });

  // payment history (DEC -> JAN like the reference)
  subHead(doc, "Payment History");
  const MONTHS = [
    ["12", "DECEMBER"], ["11", "NOVEMBER"], ["10", "OCTOBER"], ["09", "SEPTEMBER"],
    ["08", "AUGUST"], ["07", "JULY"], ["06", "JUNE"], ["05", "MAY"],
    ["04", "APRIL"], ["03", "MARCH"], ["02", "FEBRUARY"], ["01", "JANUARY"],
  ];
  const byYear = {};
  for (const h of t.history) {
    if (!h.y) continue;
    if (!byYear[h.y]) byYear[h.y] = {};
    byYear[h.y][h.m] = h.v;
  }
  const years = Object.keys(byYear).sort().reverse();
  ensureSpace(doc, 40);
  doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(7.5)
    .text("Payment History/Asset Classification:", MARGIN, doc.y, { width: CONTENT_W, align: "left" });
  doc.y += 15;
  if (years.length) {
    lightTable(doc,
      ["YEAR", ...MONTHS.map((x) => x[1])],
      years.map((y) => [y, ...MONTHS.map(([mm]) => (byYear[y] && byYear[y][mm]) || "-")]),
      { widths: [40, ...MONTHS.map(() => 34)], size: 7, headerSize: 6.5, minRowH: 11 });
  } else {
    doc.fillColor(C.gray).font("Helvetica").fontSize(7.5)
      .text("-", MARGIN, doc.y, { width: CONTENT_W, align: "left" });
    doc.y += 16;
  }
  ensureSpace(doc, 30);
  const ny = doc.y;
  doc.fillColor(C.boxBg).roundedRect(MARGIN, ny, CONTENT_W, 24, 5).fill();
  doc.fillColor(C.gray).font("Helvetica").fontSize(6.5)
    .text("Payment status is displayed based on the bureau response. Values such as 000/STD, XXX, SUB, DBT, LSS, etc. are displayed as received wherever available.",
      MARGIN + 8, ny + 5, { width: CONTENT_W - 16, align: "left" });
  doc.y = ny + 24 + 12;
  doc.x = MARGIN;
}

// ---------- full render (reference order) ----------
function renderModel(doc, m) {
  banner(doc, m);

  sectionTitle(doc, "Personal Information");
  gridBox(doc, [{ cells: [
    { label: "FULL NAME", value: m.consumer || "-" },
    { label: "DATE OF BIRTH", value: m.dob || "-" },
    { label: "GENDER", value: m.gender || "-" },
  ] }]);

  subHead(doc, "Mobile Number");
  {
    const boxes = m.mobiles.length ? m.mobiles : ["-"];
    const rows = [];
    for (let i = 0; i < boxes.length; i += 2) rows.push(boxes.slice(i, i + 2));
    gridBox(doc, rows.map((r) => ({ cells: r.map((v, k) => ({
      label: v === "-" ? "MOBILE" : `MOBILE ${rows.indexOf(r) * 2 + k + 1}`, value: v, weight: 1,
    })) })), { after: 4 });
  }

  subHead(doc, "Email ID");
  {
    const boxes = m.emails.length ? m.emails : ["-"];
    const rows = [];
    for (let i = 0; i < boxes.length; i += 2) rows.push(boxes.slice(i, i + 2));
    // pad single-cell rows so the box keeps half width like the reference
    gridBox(doc, rows.map((r) => {
      const cells = r.map((v, k) => ({
        label: v === "-" ? "EMAIL" : `EMAIL ${rows.indexOf(r) * 2 + k + 1}`, value: v, weight: 1,
      }));
      if (cells.length === 1) cells.push({ label: "", value: "", weight: 1 });
      return { cells };
    }), { after: 4 });
  }

  sectionTitle(doc, "CIBIL Score");
  {
    // score card + 3 info cells side by side
    const scoreW = 150, gapX = 10;
    const infoW = CONTENT_W - scoreW - gapX;
    const labelSize = 7, valSize = 8.5;
    const infoCells = [
      { label: "SCORE MODEL", value: m.scoreModel },
      { label: "SCORE NAME", value: m.scoreName },
      { label: "POPULATION RANK", value: m.populationRank || "-" },
    ];
    const ws = [infoW / 3, infoW / 3, infoW / 3];
    let infoH = 0;
    infoCells.forEach((c, i) => { infoH = Math.max(infoH, cellHeight(doc, c, ws[i] - 24, labelSize, valSize)); });
    infoH += 17;
    const scoreH = 8 + 7 + 3 + 30 + 9;
    const H = Math.max(infoH, scoreH, 76);
    ensureSpace(doc, H);
    const y0 = doc.y;
    doc.fillColor(C.scoreBg).roundedRect(MARGIN, y0, scoreW, H, 8).fill();
    doc.strokeColor(C.line).lineWidth(0.9).roundedRect(MARGIN, y0, scoreW, H, 8).stroke();
    doc.fillColor(C.accent).rect(MARGIN, y0, scoreW, 4).fill();
    doc.fillColor(C.label).font("Helvetica").fontSize(7)
      .text("CIBIL SCORE", MARGIN, y0 + 12, { width: scoreW, align: "center", lineBreak: false });
    doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(30)
      .text(m.score || "-", MARGIN, y0 + 26, { width: scoreW, align: "center", lineBreak: false });
    const ix = MARGIN + scoreW + gapX;
    doc.strokeColor(C.line).lineWidth(0.9).roundedRect(ix, y0, infoW, H, 8).stroke();
    let x = ix;
    infoCells.forEach((c, i) => {
      drawCell(doc, c, x + 12, y0 + 8, ws[i] - 24, labelSize, valSize);
      if (i < 2) {
        doc.strokeColor(C.div).lineWidth(0.6).moveTo(x + ws[i], y0 + 8).lineTo(x + ws[i], y0 + H - 8).stroke();
      }
      x += ws[i];
    });
    doc.y = y0 + H + 10;
    doc.x = MARGIN;
  }

  sectionTitle(doc, "Bureau File Status", "As reported by the bureau");
  {
    const colorFor = (v) => {
      const t = s(v).toLowerCase();
      if (t === "yes") return C.red;
      if (t === "no") return C.green;
      return C.ink;
    };
    miniCards(doc, [
      { label: "SAFETY CHECK PASSED", value: m.safetyPassed, color: colorFor(m.safetyPassed) },
      { label: "FILE FROZEN", value: m.fileFrozen, color: colorFor(m.fileFrozen) },
      { label: "DECEASED INDICATOR", value: m.deceased, color: colorFor(m.deceased) },
      { label: "FRAUD INDICATOR", value: m.fraud, color: colorFor(m.fraud) },
    ], 4, { h: 56, valueSize: 10.5 });
  }

  sectionTitle(doc, "Account Summary");
  miniCards(doc, [
    { label: "TOTAL ACCOUNTS", value: m.summary.total, accent: true },
    { label: "ACTIVE ACCOUNTS", value: m.summary.active, accent: true },
    { label: "CLOSED ACCOUNTS", value: m.summary.closed, accent: true },
    { label: "TOTAL CURRENT BALANCE", value: money(m.summary.currentBalance), money: true, accent: true },
    { label: "TOTAL HIGH BALANCE", value: money(m.summary.highBalance), money: true, accent: true },
    { label: "TOTAL AMOUNT PAST DUE", value: money(m.summary.pastDue), money: true, accent: true },
  ], 3, { h: 64, valueSize: 13 });

  sectionTitle(doc, "Address Information");
  if (m.addresses.length) {
    lightTable(doc, ["#", "ADDRESS", "CITY", "STATE", "PIN CODE", "REPORTED DATE", "SOURCE"],
      m.addresses.map((a) => [String(a.idx), a.line, a.city, a.state, a.pin, a.date || "-", a.source || "-"]),
      { widths: [24, 205, 70, 52, 55, 70, 79], size: 7, headerSize: 6.5 });
  } else {
    doc.fillColor(C.gray).font("Helvetica").fontSize(8).text("No addresses found.", MARGIN, doc.y, { width: CONTENT_W });
    gap(doc, 18);
  }

  sectionTitle(doc, "Identifiers");
  if (m.identifiers.length) {
    lightTable(doc, ["#", "IDENTIFIER TYPE", "VALUE"],
      m.identifiers.map((r, i) => [String(i + 1), r.type, r.value]),
      { widths: [40, 247, 240], size: 7.5, headerSize: 7 });
  } else {
    doc.fillColor(C.gray).font("Helvetica").fontSize(8).text("No identifiers found.", MARGIN, doc.y, { width: CONTENT_W });
    gap(doc, 18);
  }

  sectionTitle(doc, "Employment Information");
  if (m.employments.length) {
    gridBox(doc, m.employments.map((e) => ({ cells: [
      { label: "EMPLOYER", value: e.employer },
      { label: "OCCUPATION", value: e.occupation },
      { label: "DATE REPORTED", value: e.date || "-" },
    ] })));
  } else {
    gridBox(doc, [{ cells: [
      { label: "EMPLOYER", value: "-" },
      { label: "OCCUPATION", value: "-" },
      { label: "DATE REPORTED", value: "-" },
    ] }]);
  }

  sectionTitle(doc, "Credit Accounts", `${m.accounts.length} account(s) found`);
  if (!m.accounts.length) {
    doc.fillColor(C.gray).font("Helvetica").fontSize(8).text("No credit accounts found.", MARGIN, doc.y, { width: CONTENT_W });
    gap(doc, 18);
  }
  m.accounts.forEach((t) => accountCard(doc, t));

  sectionTitle(doc, "Credit Enquiries",
    `${m.enquiries.length} ${m.enquiries.length === 1 ? "enquiry" : "enquiries"}`);
  if (m.enquiries.length) {
    lightTable(doc, ["#", "SUBSCRIBER", "INQUIRY DATE", "INQUIRY TYPE", "AMOUNT", "CONTROL NUMBER"],
      m.enquiries.map((q, i) => [String(i + 1), q.member, q.date || "-", q.type, money(q.amount), q.control || "-"]),
      { widths: [26, 150, 75, 70, 90, 116], size: 7, headerSize: 6.5, moneyCols: new Set([4]) });
  } else {
    doc.fillColor(C.gray).font("Helvetica").fontSize(8).text("No enquiries found.", MARGIN, doc.y, { width: CONTENT_W });
    gap(doc, 18);
  }

  ensureSpace(doc, 44);
  const dy = doc.y;
  doc.fillColor(C.boxBg).roundedRect(MARGIN, dy, CONTENT_W, 34, 6).fill();
  doc.fillColor(C.gray).font("Helvetica").fontSize(7)
    .text("This document is generated from the bureau response received by the application. Bureau-provided values are displayed as received wherever applicable. This generated document is not itself an official bureau certificate unless separately authorized.",
      MARGIN + 10, dy + 6, { width: CONTENT_W - 20, align: "left" });
  doc.y = dy + 34 + 6;
  doc.x = MARGIN;
}

async function generateCibilPdf(parsed, meta = {}) {
  const model = buildCibilModel(parsed, meta);
  const kitDoc = createKitDoc();
  const chunks = [];
  kitDoc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    kitDoc.on("end", resolve);
    kitDoc.on("error", reject);
  });
  renderModel(kitDoc, model);
  stampChrome(kitDoc);
  kitDoc.end();
  await done;
  return { buffer: Buffer.concat(chunks), model };
}

module.exports = { buildCibilModel, generateCibilPdf, getTrueLink };
