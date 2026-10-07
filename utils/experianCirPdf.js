// Styled Experian credit-report PDF in the platform's reference visual
// language: logo line, yellow title band, teal rules, gray section bars,
// ruled tables, red score, 4-column account blocks
// (ACCOUNT | DATES | AMOUNTS | STATUS), DPD flow, centered footer note.
// Data source: IndiConnect Soft-Pull parsed result (CAIS/CAPS nodes).
const PDFDocumentKit = require("pdfkit");

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 34;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = 806;

const C = {
  black: "#000000",
  grayDark: "#404040",
  grayText: "#595959",
  grayBar: "#D9D9D9",
  grid: "#BFBFBF",
  sky: "#29ABE2",
  navy: "#002060",
  yellow: "#FFC000",
  teal: "#00A9CE",
  red: "#C00000",
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
const yyyymmdd = (v) => {
  // Accepts YYYYMMDD numbers (20260306), YYYY-MM-DD strings, ISO strings
  const t = s(v).trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (t.length >= 10) return t.slice(0, 10);
  return "";
};
const monthLabel = (year, month) => {
  const m = String(month).padStart(2, "0");
  return `${m}-${String(year).slice(-2)}`;
};
const blankDash = (v) => {
  const t = s(v).trim();
  return t === "" || t === "-1" ? "" : t;
};

// ---------- model ----------
function buildExperianModel(parsed, meta = {}) {
  if (!parsed) return null;
  const caisDetails = asArray(parsed.caisAccount?.CAIS_Account_DETAILS);
  const firstHolder = caisDetails[0]?.CAIS_Holder_Details?.[0] || {};

  const holderName =
    [
      firstHolder.Surname_Non_Normalized,
      firstHolder.First_Name_Non_Normalized,
      firstHolder.Middle_Name_1_Non_Normalized,
    ]
      .map((x) => s(x).trim())
      .filter(Boolean)
      .join(" ") || s(meta.name).toUpperCase();

  const cph = parsed.creditProfileHeader || {};
  const accounts = caisDetails.map((a) => {
    const hist = asArray(a.CAIS_Account_History)
      .map((h) => ({ y: h.Year, m: h.Month, dpd: h.Days_Past_Due ?? h.Days_Past_Due }))
      .filter((h) => h.y && h.m);
    hist.sort((x, y) => y.y - x.y || y.m - x.m);
    const curBal = num(a.Current_Balance);
    return {
      subscriber: s(a.Subscriber_Name) || s(a.Identification_Number),
      accountNumber: s(a.Account_Number),
      type: s(a.accountTypeDescription || a.Account_Type),
      ownership: s(a.accountholdertypecodeDescription || a.AccountHoldertypeCode),
      amountOverdue: s(a.Amount_Past_Due) === "" ? "" : s(a.Amount_Past_Due),
      interestRate: s(a.Rate_of_Interest),
      opened: yyyymmdd(a.Open_Date),
      reported: yyyymmdd(a.Date_Reported),
      closedRaw: yyyymmdd(a.Date_Closed),
      closed: s(a.Date_Closed) ? yyyymmdd(a.Date_Closed) : "NA",
      lastPayment: yyyymmdd(a.Date_of_Last_Payment),
      firstDelinquency: yyyymmdd(a.Date_of_First_Delinquency),
      creditLimit: blankDash(a.Credit_Limit_Amount),
      highCredit: blankDash(a.Highest_Credit_or_Original_Loan_Amount),
      currentBalance: blankDash(a.Current_Balance),
      emi: blankDash(a.Scheduled_Monthly_Payment_Amount),
      frequency: s(a.termsFrequencyDescription || a.Terms_Frequency),
      tenure: blankDash(a.Repayment_Tenure ?? a.Terms_Duration),
      collateralType: s(a.Type_of_Collateral),
      collateralValue: blankDash(a.Value_of_Collateral),
      facilityStatus: s(a.accountStatusDescription || a.Account_Status),
      suitFiled: s(a.suitfiledWillfuldefaultDescription || a.SuitFiled_WillfulDefault),
      writtenOffPrincipal: blankDash(a.Written_Off_Amt_Principal),
      writtenOffTotal: blankDash(a.Written_Off_Amt_Total),
      settlement: blankDash(a.Settlement_Amount),
      history: hist.slice(0, 36).map((h) => ({
        label: monthLabel(h.y, h.m),
        status: h.dpd === undefined || h.dpd === null || h.dpd === "" ? "?" : s(h.dpd),
      })),
      _pastDue: num(a.Amount_Past_Due) || 0,
      _curBal: curBal,
      _openedRaw: yyyymmdd(a.Open_Date),
    };
  });

  let zeroBal = 0;
  let overdueCount = 0;
  let currSum = 0;
  let odSum = 0;
  let recent = "";
  let oldest = "";
  for (const t of accounts) {
    if (t._pastDue > 0) {
      overdueCount += 1;
      odSum += t._pastDue;
    }
    if (t._curBal !== null && t._curBal === 0) zeroBal += 1;
    if (t._curBal !== null && t._curBal >= 0) currSum += t._curBal;
    if (t._openedRaw) {
      if (!recent || t._openedRaw > recent) recent = t._openedRaw;
      if (!oldest || t._openedRaw < oldest) oldest = t._openedRaw;
    }
  }

  const capsRows = asArray(parsed.caps?.CAPS_Application_Details);
  const nonCreditRows = asArray(parsed.nonCreditCaps?.CAPS_Application_Details);
  const enquiries = [...capsRows, ...nonCreditRows].map((q) => {
    const o = q && typeof q === "object" ? q : {};
    const pick = (keys) => {
      for (const k of keys) {
        if (o[k] !== undefined && o[k] !== null && o[k] !== "") return s(o[k]);
      }
      return "";
    };
    return {
      member: pick(["Subscriber_Name", "subscriberName", "Member", "member"]),
      date: yyyymmdd(pick(["Date_of_Request", "date", "Enquiry_Date", "enquiryDate"])) || pick(["Date_of_Request", "date"]),
      purpose: pick(["Enquiry_Reason", "purpose", "Purpose", "enquiryPurpose"]),
      amount: pick(["Amount", "amount", "Enquiry_Amount", "enquiryAmount"]),
    };
  });

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const pad2 = (n) => String(n).padStart(2, "0");
  let hh = now.getHours();
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;

  const holderPan =
    s(meta.pan) || s(firstHolder.Income_TAX_PAN);

  return {
    consumer: s(meta.name).toUpperCase() || holderName,
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(hh)}:${pad2(now.getMinutes())} ${ampm}`,
    controlNumber:
      cph.ReportNumber != null ? String(cph.ReportNumber) : parsed.txn_id || "",
    infoName: holderName,
    dob: yyyymmdd(firstHolder.Date_of_birth),
    gender: s(firstHolder.genderCodeDescription).toLowerCase(),
    pan: holderPan,
    mobile: s(meta.mobile),
    score: parsed.score != null ? s(parsed.score) : "",
    identifiers: holderPan
      ? [{ type: "INCOME TAX ID NUMBER (PAN)", number: holderPan }]
      : [],
    scoreConfidence: s(parsed.scoreConfidence),
    exactMatch: s(parsed.exactMatch),
    userMessage: s(parsed.userMessage?.UserMessageText),
    emails: [
      ...new Set(
        caisDetails
          .flatMap((a) => [
            a.CAIS_Holder_Phone_Details,
            a.CAIS_Holder_ID_Details,
          ])
          .flatMap((x) => asArray(x))
          .map((x) => s(x?.EMailId).trim())
          .filter((e) => e.includes("@")),
      ),
    ],
    telephones: caisDetails.flatMap((a) =>
      asArray(a.CAIS_Holder_Phone_Details).map((t) => ({
        number: s(t.Mobile_Telephone_Number || t.Telephone_Number),
        type:
          String(t.Telephone_Type) === "1" || t.Mobile_Telephone_Number
            ? "Mobile Phone"
            : "",
      })),
    ).filter((t) => t.number),
    addresses: [
      ...new Map(
        caisDetails
          .flatMap((a) => asArray(a.CAIS_Holder_Address_Details))
          .map((a) => {
            const line = [
              a.First_Line_Of_Address_non_normalized,
              a.Second_Line_Of_Address_non_normalized,
              a.Third_Line_Of_Address_non_normalized,
              a.City_non_normalized,
            ]
              .map((x) => s(x).trim())
              .filter(Boolean)
              .join(" ");
            const key = `${line}|${a.ZIP_Postal_Code_non_normalized}`;
            return [
              key,
              {
                line,
                city: "",
                region: s(a.State_non_normalized),
                postal: s(a.ZIP_Postal_Code_non_normalized),
              },
            ];
          }),
      ).values(),
    ],
    summary: {
      total: accounts.length,
      overdueCount,
      zeroBal,
      currSum: String(currSum),
      odSum: String(odSum),
      recent,
      oldest,
      enquiries: enquiries.length,
    },
    totalCaps: parsed.totalCaps || {},
    accounts,
    enquiries,
  };
}

// ---------- drawing primitives (reference visual language) ----------
function createKitDoc() {
  return new PDFDocumentKit({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: 36, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    info: { Title: "Experian Credit Report" },
  });
}
function ensureSpace(doc, need) {
  if (doc.y + need > BOTTOM_LIMIT) doc.addPage();
}
function bodyText(doc, str, size = 8, bold = false, color = C.black) {
  doc
    .fillColor(color)
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(size)
    .text(s(str), MARGIN, doc.y, { width: CONTENT_W, align: "left" });
}
function tealRule(doc, gapAbove = 4) {
  doc.moveDown(gapAbove / 12);
  ensureSpace(doc, 8);
  doc
    .strokeColor(C.teal)
    .lineWidth(1.2)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + CONTENT_W, doc.y)
    .stroke();
  doc.moveDown(0.35);
}
function sectionBar(doc, text) {
  ensureSpace(doc, 34);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(C.grayBar);
  doc
    .fillColor(C.black)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(text, MARGIN + 4, y + 3.5, { width: CONTENT_W - 8, align: "left" });
  doc.y = y + 18;
  tealRule(doc, 0);
}
function ruledTable(doc, headers, rows, opts = {}) {
  const { size = 7.5, headerSize = 7.5, gap = 6, minRowH = 12 } = opts;
  const n = headers.length;
  const avail = CONTENT_W - gap * (n - 1);
  const raw =
    opts.widths && opts.widths.length === n ? opts.widths : headers.map(() => 1);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const w = raw.map((x) => (x / total) * avail);
  const drawRow = (cols, isHeader) => {
    const fs = isHeader ? headerSize : size;
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
    const heights = cols.map((c, i) =>
      doc.heightOfString(s(c), { width: w[i] }),
    );
    const h = Math.max(minRowH, ...heights) + 4;
    ensureSpace(doc, h + 2);
    const y = doc.y;
    if (isHeader) doc.rect(MARGIN, y, CONTENT_W, h).fill(C.grayBar);
    let x = MARGIN;
    doc.fillColor(C.black);
    cols.forEach((c, i) => {
      doc.text(s(c), x + 2, y + 2, { width: w[i] - 4, align: "left" });
      x += w[i] + gap;
    });
    doc.strokeColor(C.grid).lineWidth(0.5);
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + CONTENT_W, y + h).stroke();
    let vx = MARGIN;
    for (let i = 0; i < n - 1; i++) {
      vx += w[i] + gap / 2;
      doc.moveTo(vx, y).lineTo(vx, y + h).stroke();
      vx += gap / 2;
    }
    doc.y = y + h + 1;
    doc.x = MARGIN;
  };
  drawRow(headers, true);
  rows.forEach((r) => drawRow(r, false));
}
function stackField(doc, x, y, w, label, value) {
  doc.fillColor(C.grayText).font("Helvetica").fontSize(6.2);
  const lh = doc.heightOfString(label, { width: w });
  doc.text(label, x, y, { width: w, align: "left" });
  doc.fillColor(C.black).font("Helvetica").fontSize(7.5);
  const vt = s(value);
  const vh = vt ? doc.heightOfString(vt, { width: w }) : 0;
  if (vt) doc.text(vt, x, y + lh + 1, { width: w, align: "left" });
  return lh + 1 + vh + 5;
}
const ACCT_COLS = [
  { title: "ACCOUNT", weight: 150 },
  { title: "DATES", weight: 125 },
  { title: "AMOUNTS", weight: 130 },
  { title: "STATUS", weight: 118 },
];
function accountBlock(doc, t) {
  const gap = 8;
  const avail = CONTENT_W - gap * 3;
  const totalW = ACCT_COLS.reduce((a, c) => a + c.weight, 0);
  const widths = ACCT_COLS.map((c) => (c.weight / totalW) * avail);
  const xs = [];
  let cx = MARGIN;
  widths.forEach((w) => {
    xs.push(cx);
    cx += w + gap;
  });
  const cols = [
    [
      ["SUBSCRIBER", t.subscriber],
      ["ACCOUNT NUMBER", t.accountNumber],
      ["TYPE", t.type],
      ["OWNERSHIP", t.ownership],
      ["AMOUNT PAST DUE", t.amountOverdue],
      ["RATE OF INTEREST", t.interestRate],
    ],
    [
      ["OPENED", t.opened],
      ["DATE REPORTED", t.reported],
      ["DATE CLOSED", t.closedRaw],
      ["LAST PAYMENT", t.lastPayment],
      ["FIRST DELINQUENCY", t.firstDelinquency],
    ],
    [
      ["CREDIT LIMIT", t.creditLimit],
      ["HIGHEST CREDIT", t.highCredit],
      ["CURRENT BALANCE", t.currentBalance],
      ["SCHEDULED PAYMENT", t.emi],
      ["PAYMENT FREQUENCY", t.frequency],
      ["REPAYMENT TENURE", t.tenure],
      ["COLLATERAL TYPE", t.collateralType],
      ["COLLATERAL VALUE", t.collateralValue],
    ],
    [
      ["ACCOUNT STATUS", t.facilityStatus],
      ["SUIT FILED STATUS", t.suitFiled],
      ["WRITTEN-OFF PRINCIPAL", t.writtenOffPrincipal],
      ["WRITTEN-OFF TOTAL", t.writtenOffTotal],
      ["SETTLEMENT AMOUNT", t.settlement],
    ],
  ];
  const measurer = createKitDoc();
  const colH = cols.map((fields, i) => {
    let h = 0;
    fields.forEach(([lb, v]) => {
      measurer.fillColor(C.grayText).font("Helvetica").fontSize(6.2);
      const lh = measurer.heightOfString(lb, { width: widths[i] });
      let vh = 0;
      if (s(v)) {
        measurer.fillColor(C.black).font("Helvetica").fontSize(7.5);
        vh = measurer.heightOfString(s(v), { width: widths[i] });
      }
      h += lh + 1 + vh + 5;
    });
    return h;
  });
  const gridH = t.history.length
    ? 16 + Math.ceil(t.history.length / 9) * 11 + 6
    : 0;
  const blockH = 20 + Math.max(...colH) + gridH + 8;
  ensureSpace(doc, Math.min(blockH, BOTTOM_LIMIT - MARGIN));
  const y0 = doc.y;
  doc.strokeColor(C.black).lineWidth(1.4);
  doc.moveTo(MARGIN, y0).lineTo(MARGIN + CONTENT_W, y0).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C.black);
  xs.forEach((x, i) => {
    doc.text(ACCT_COLS[i].title, x, y0 + 4, { width: widths[i], align: "left" });
  });
  doc.y = y0 + 18;
  const yCols = doc.y;
  cols.forEach((fields, i) => {
    let y = yCols;
    fields.forEach(([lb, v]) => {
      y += stackField(doc, xs[i], y, widths[i], lb, v);
    });
  });
  doc.y = yCols + Math.max(...colH);
  doc.x = MARGIN;
  if (t.history.length) {
    ensureSpace(doc, 30);
    bodyText(doc, "DAYS PAST DUE / ASSET CLASSIFICATION (UP TO 36 MONTHS)", 6.5, false, C.grayText);
    const pairs = t.history.map((mm) => `${mm.status} / ${mm.label}`);
    doc.fillColor(C.black).font("Helvetica").fontSize(7);
    doc.text(pairs.join("  "), MARGIN, doc.y, { width: CONTENT_W, align: "left" });
    doc.moveDown(0.4);
  }
}

// ---------- full render ----------
function renderModel(doc, m) {
  doc.font("Helvetica").fontSize(16);
  doc.fillColor(C.sky).text("Experian ", MARGIN, doc.y, {
    continued: true,
    width: CONTENT_W,
  });
  doc.fillColor(C.navy).font("Helvetica-Bold").text("Credit Report");
  doc.moveDown(0.3);

  ensureSpace(doc, 24);
  {
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 17).fill(C.yellow);
    doc
      .fillColor(C.black)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("CONSUMER CREDIT REPORT", MARGIN + 5, y + 3, { width: CONTENT_W - 10 });
    doc.y = y + 19;
  }

  {
    ensureSpace(doc, 30);
    const y = doc.y;
    const half = CONTENT_W / 2;
    doc.fillColor(C.black).font("Helvetica").fontSize(8);
    doc.text(`CONSUMER: ${m.consumer}`, MARGIN, y, { width: half - 4 });
    doc.text(`DATE: ${m.date}`, MARGIN + half, y, { width: half });
    const y2 = doc.y;
    doc.text(`MOBILE: ${m.mobile}`, MARGIN, y2, { width: half - 4 });
    doc.text(`CONTROL NUMBER: ${m.controlNumber}`, MARGIN + half, y2, { width: half });
    const y3 = doc.y;
    doc.text(`PAN: ${m.pan}`, MARGIN, y3, { width: half - 4 });
    doc.moveDown(0.2);
  }
  tealRule(doc, 0);

  sectionBar(doc, "CREDIT SCORE:");
  {
    const widths = [200, 90, CONTENT_W - 200 - 90 - 12];
    const n = 3;
    const avail = CONTENT_W - 6 * (n - 1);
    const total = widths.reduce((a, b) => a + b, 0);
    const w = widths.map((x) => (x / total) * avail);
    const headers = ["SCORE NAME", "SCORE", "DETAILS"];
    doc.font("Helvetica-Bold").fontSize(7.5);
    const hh = Math.max(...headers.map((c, i) => doc.heightOfString(c, { width: w[i] })));
    ensureSpace(doc, hh + 8);
    let y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, hh + 4).fill(C.grayBar);
    let x = MARGIN;
    doc.fillColor(C.black);
    headers.forEach((c, i) => {
      doc.text(c, x + 2, y + 2, { width: w[i] - 4 });
      x += w[i] + 6;
    });
    doc.y = y + hh + 6;
    const details = [
      m.scoreConfidence ? `Confidence: ${m.scoreConfidence}` : "",
      m.exactMatch ? `Exact match: ${m.exactMatch}` : "",
      m.userMessage ? m.userMessage : "",
    ].filter(Boolean);
    doc.font("Helvetica").fontSize(7.5);
    const c0h = doc.heightOfString("Experian/FCIREXScore", { width: w[0] });
    doc.font("Helvetica-Bold").fontSize(17).fillColor(C.red);
    const scoreH = doc.heightOfString(m.score || "-", { width: w[1] });
    doc.font("Helvetica").fontSize(7.5).fillColor(C.black);
    const c2h = doc.heightOfString(details.join("\n") || "-", { width: w[2] });
    const rh = Math.max(28, c0h, scoreH, c2h) + 6;
    ensureSpace(doc, rh + 2);
    y = doc.y;
    x = MARGIN;
    doc.fillColor(C.black).font("Helvetica").fontSize(7.5);
    doc.text("Experian/FCIREXScore", x + 2, y + 2, { width: w[0] - 4 });
    x += w[0] + 6;
    doc.fillColor(C.red).font("Helvetica-Bold").fontSize(17).text(m.score || "-", x, y, {
      width: w[1],
      align: "center",
    });
    x += w[1] + 6;
    doc.fillColor(C.black).font("Helvetica").fontSize(7.5);
    doc.text(details.join("\n") || "-", x + 2, y + 2, { width: w[2] - 4 });
    doc.y = y + rh + 2;
    doc.x = MARGIN;
  }

  sectionBar(doc, "PERSONAL INFORMATION:");
  ruledTable(
    doc,
    ["NAME", "DATE OF BIRTH", "GENDER"],
    [[m.infoName, m.dob, m.gender]],
    { widths: [3, 2, 2] },
  );
  if (m.pan) {
    ruledTable(doc, ["PAN", "MOBILE"], [[m.pan, m.mobile]], {
      widths: [1, 1],
    });
  }

  if (m.identifiers.length) {
    sectionBar(doc, "IDENTIFICATION(S):");
    ruledTable(
      doc,
      ["IDENTIFICATION TYPE", "IDENTIFICATION NUMBER"],
      m.identifiers.map((r) => [r.type, r.number]),
      { widths: [2, 3] },
    );
  }

  if (m.telephones.length) {
    sectionBar(doc, "TELEPHONE(S):");
    ruledTable(
      doc,
      ["TELEPHONE TYPE", "TELEPHONE NUMBER"],
      m.telephones.map((r) => [r.type, r.number]),
      { widths: [1, 1] },
    );
  }

  if (m.emails.length) {
    sectionBar(doc, "EMAIL CONTACT(S):");
    ruledTable(doc, ["EMAIL ADDRESS"], m.emails.map((e) => [e]), {
      widths: [1],
    });
  }

  if (m.addresses.length) {
    sectionBar(doc, "ADDRESS(ES):");
    m.addresses.forEach((a) => {
      ensureSpace(doc, 30);
      bodyText(doc, `ADDRESS : ${a.line}`, 7.5);
      const y = doc.y;
      const half = CONTENT_W / 2;
      doc.fillColor(C.black).font("Helvetica").fontSize(7.5);
      doc.text(`STATE: ${a.region}  PINCODE: ${a.postal}`, MARGIN, y, {
        width: half + 60,
      });
      doc.moveDown(0.35);
    });
  }

  sectionBar(doc, "SUMMARY:");
  bodyText(doc, "ACCOUNT(S)", 8, true);
  {
    const sm = m.summary;
    ruledTable(
      doc,
      ["ACCOUNT TYPE", "ACCOUNTS", "BALANCES", "DATE OPENED"],
      [
        ["All Accounts", `TOTAL: ${sm.total}`, `OUTSTANDING: ${sm.currSum}`, `RECENT: ${sm.recent}`],
        [`OVERDUE: ${sm.overdueCount}`, `OVERDUE AMT: ${sm.odSum}`, "", `OLDEST: ${sm.oldest}`],
        [`ZERO-BALANCE: ${sm.zeroBal}`, "", "", ""],
      ],
      { widths: [100, 140, 140, 143], size: 7, headerSize: 7 },
    );
  }
  doc.moveDown(0.3);
  bodyText(doc, "ENQUIRIES", 8, true);
  ruledTable(
    doc,
    ["TOTAL (7 DAYS)", "TOTAL (30 DAYS)", "TOTAL (90 DAYS)", "TOTAL (180 DAYS)"],
    [
      [
        s(m.totalCaps.TotalCAPSLast7Days ?? "-"),
        s(m.totalCaps.TotalCAPSLast30Days ?? "-"),
        s(m.totalCaps.TotalCAPSLast90Days ?? "-"),
        s(m.totalCaps.TotalCAPSLast180Days ?? "-"),
      ],
    ],
    { widths: [1, 1, 1, 1], size: 7, headerSize: 7 },
  );

  if (m.accounts.length) {
    sectionBar(doc, "ACCOUNT(S):");
    m.accounts.forEach((t) => accountBlock(doc, t));
  } else {
    sectionBar(doc, "ACCOUNT(S):");
    bodyText(doc, "No credit accounts found.", 8, false, C.grayText);
  }

  if (m.enquiries.length) {
    sectionBar(doc, "ENQUIRIES:");
    ruledTable(
      doc,
      ["MEMBER", "DATE", "PURPOSE", "AMOUNT"],
      m.enquiries.map((q) => [q.member, q.date, q.purpose, q.amount]),
      { widths: [170, 100, 160, 93] },
    );
  }

  doc.moveDown(0.8);
  [
    "This report is generated from Experian credit information received via IndiConnect based on the details provided by you.",
    "Prepared on request for credit assessment purposes. For discrepancies, contact the concerned lender or Experian directly.",
  ].forEach((line) => {
    ensureSpace(doc, 14);
    bodyText(doc, line, 7, false, C.grayText);
  });
  doc.moveDown(0.4);
  ensureSpace(doc, 14);
  doc.fillColor(C.grayText).font("Helvetica").fontSize(7);
  doc.text(`Generated on ${m.date} ${m.time} (IST). Report No: ${m.controlNumber}`, MARGIN, doc.y, {
    width: CONTENT_W,
    align: "center",
  });
}

async function generateExperianPdf(parsed, meta = {}) {
  const model = buildExperianModel(parsed, meta);
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
  buildExperianModel,
  generateExperianPdf,
};
