const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const {
  generateCibilPdf: buildCibilReportHtml,
} = require("../templates/cibilReport.template");

// ============================================================
// GET TRUE LINK CREDIT REPORT
// ============================================================

const getTrueLinkCreditReport = (apiResponse) => {
  return (
    apiResponse?.data?.cibilData?.GetCustomerAssetsResponse
      ?.GetCustomerAssetsSuccess?.Asset?.TrueLinkCreditReport || null
  );
};

// ============================================================
// SHAPE COERCION
// The bureau returns collections in three different shapes:
//   1. a real array                      -> [ {..}, {..} ]
//   2. an index-keyed map                -> { "1": {..}, "2": {..} }
//   3. a singleton object where docs
//      show an array (single account /
//      address / phone / enquiry)        -> { Tradeline: {..} }
// Coercing here prevents whole sections from silently rendering empty.
// ============================================================

// An index-keyed map has only numeric keys ("1", "2", ...). A singleton
// record object has descriptive keys ("Tradeline", "ID", ...), so the two
// can be told apart reliably.
const isIndexedMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value);

  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
};

const asArray = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;

  if (isIndexedMap(value)) {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key]);
  }

  return [value];
};

// Returns true when the raw value was present but NOT an array, so the
// caller can record a data-quality warning.
const wasSingleton = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return false;

  return !isIndexedMap(value);
};

// ============================================================
// NORMALIZE EMPTY VALUES
// ============================================================

const cleanValue = (value, fallback = "-") => {
  if (value === null || value === undefined || value === "" || value === "-1") {
    return fallback;
  }

  return value;
};

// ============================================================
// DATE
// Bureau dates may carry timezone suffixes ("1994-12-18+05:30") or
// datetime separators ("2026-09-01T18:22:10.250+05:30"). Strip those so
// the PDF shows a clean date instead of raw bureau artifacts.
// ============================================================

const normalizeDate = (value) => {
  if (!value) return "-";

  let text = String(value).trim();

  // Drop time portion of ISO datetimes, keep the date part.
  const tIndex = text.indexOf("T");
  if (tIndex > 0 && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    text = text.slice(0, tIndex);
  }

  // Drop trailing timezone suffixes ("+05:30", "-04:00", "Z").
  text = text.replace(/([+-]\d{2}:?\d{2}|Z)$/, "");

  return text || "-";
};
// ============================================================
// FORMAT REPORT TIME
// ============================================================

const formatTime = (value) => {
  if (!value) return "-";

  const raw = String(value).trim();

  // Example: 2026-10-27 13:15:08.123521
  const match = raw.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2}):(\d{2})/);

  if (!match) return raw;

  const hours = Number(match[1]);
  const minutes = match[2];
  const seconds = match[3];

  const period = hours >= 12 ? "PM" : "AM";
  const formattedHours = String(hours % 12 || 12).padStart(2, "0");

  return `${formattedHours}:${minutes}:${seconds} ${period}`;
};

// ============================================================
// MASK ACCOUNT NUMBER
// ============================================================

const maskAccountNumber = (value) => {
  if (!value || value === "-1") {
    return "-";
  }

  return String(value);
};

// ============================================================
// NUMBER
// ============================================================

const toNumber = (value) => {
  if (value === null || value === undefined || value === "" || value === "-1") {
    return 0;
  }

  const number = Number(value);

  return Number.isNaN(number) ? 0 : number;
};

// ============================================================
// PAYMENT HISTORY
// ============================================================

const normalizePaymentHistory = (history) => {
  if (!history) {
    return [];
  }

  // Primary bureau key first, known alternates after — never render an
  // empty grid while usable history exists under another key.
  const raw =
    history.MonthlyPayStatus ||
    history.monthlyPayStatus ||
    history.PaymentHistory ||
    history.payStatusHistory ||
    history.History ||
    null;

  const entries = asArray(raw);

  if (!entries.length) {
    return [];
  }

  return entries.map((item) => {
    if (typeof item === "string") {
      return { date: "-", status: item };
    }

    return {
      date:
        item?.date ||
        item?.paymentDate ||
        item?.month ||
        item?.reportDate ||
        item?.Date ||
        "-",
      status:
        item?.status ??
        item?.payStatus ??
        item?.assetClassification ??
        item?.AssetClassification ??
        item?.classification ??
        "-",
    };
  });
};

// ============================================================
// EXTRACT BORROWER NAME
// ============================================================

const extractBorrowerName = (borrower) => {
  const name = borrower?.BorrowerName?.Name || {};

  const firstName = name.Forename || name.FirstName || "-";

  const lastName = name.Surname || name.LastName || "-";

  const middleName = name.MiddleName || "";

  const fullName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    firstName,
    middleName,
    lastName,
    fullName: fullName || "-",
  };
};

// ============================================================
// EMAILS
// ============================================================

const extractEmails = (borrower) => {
  const entries = asArray(borrower?.EmailAddress);

  if (!entries.length) {
    return [];
  }

  return [
    ...new Set(
      entries
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          return item?.Email || item?.email || item?.EmailAddress || null;
        })
        .filter(Boolean),
    ),
  ];
};

// ============================================================
// PHONES
// ============================================================

const extractPhones = (borrower) => {
  const entries = asArray(borrower?.BorrowerTelephone);

  if (!entries.length) {
    return [];
  }

  return [
    ...new Set(
      entries
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          return (
            item?.PhoneNumber?.Number ||
            item?.PhoneNumber ||
            item?.Number ||
            item?.telephone ||
            null
          );
        })
        .filter(Boolean),
    ),
  ];
};

// ============================================================
// ADDRESSES
// ============================================================

const extractAddresses = (borrower) => {
  const entries = asArray(borrower?.BorrowerAddress);

  if (!entries.length) {
    return [];
  }

  return entries.map((item) => {
    if (typeof item === "string") {
      return {
        address: item,
        city: "-",
        state: "-",
        pincode: "-",
        reportedDate: "-",
        origin: "-",
      };
    }

    const address = item?.CreditAddress || item || {};

    return {
      address:
        address.StreetAddress ||
        address.AddressLine ||
        address.addressLine1 ||
        address.Street ||
        address.street ||
        address.Address ||
        address.address ||
        address.Line1 ||
        "-",

      city: address.City || address.city || address.CityName || "-",

      state: address.Region || stateFallback(address) || "-",

      pincode:
        address.PostalCode ||
        address.Pincode ||
        address.pincode ||
        address.PIN ||
        address.pin ||
        address.ZipCode ||
        "-",

      reportedDate: normalizeDate(item?.dateReported),

      origin:
        item?.Origin?.symbol ||
        item?.Origin?.description ||
        (typeof item?.Origin === "string" ? item.Origin : null) ||
        item?.origin ||
        item?.source ||
        item?.Source ||
        "-",
    };
  });
};

// Some payloads use StateCode/State instead of Region.
const stateFallback = (address) => {
  return address?.StateCode || address?.State || address?.state || null;
};

// ============================================================
// IDENTIFIERS
// ============================================================

const extractIdentifiers = (borrower) => {
  const identifierPartition = borrower?.IdentifierPartition;

  if (!identifierPartition) {
    return [];
  }

  const identifiers = asArray(identifierPartition.Identifier);

  if (!identifiers.length) {
    return [];
  }

  return identifiers.map((item) => {
    if (typeof item === "string") {
      return { type: "-", value: item };
    }

    const rawType = item?.IdentifierType;
    const typeFromObject =
      rawType && typeof rawType === "object"
        ? rawType.description ||
          rawType.symbol ||
          rawType.value ||
          rawType.code ||
          rawType.name ||
          null
        : null;

    return {
      type:
        typeFromObject ||
        (typeof rawType === "string" ? rawType : null) ||
        item?.ID?.IdentifierName ||
        item?.idType ||
        item?.IDType ||
        item?.typeCode ||
        item?.Type ||
        item?.code ||
        item?.description ||
        item?.type ||
        item?.symbol ||
        "-",

      value:
        item?.IdentifierValue ||
        item?.identifierValue ||
        item?.IdentifierNumber ||
        item?.number ||
        item?.idNumber ||
        item?.IDNumber ||
        item?.IdValue ||
        item?.IDValue ||
        item?.ID?.Id ||
        item?.identifierNumber ||
        item?.documentNumber ||
        item?.value ||
        item?.id ||
        "-",
    };
  });
};

// ============================================================
// EMPLOYMENT
// ============================================================

const normalizeSingleEmployment = (employer) => {
  const source =
    typeof employer === "string" ? { name: employer } : employer || {};
  const rawOccupation = source?.OccupationCode;

  return {
    employer:
      source?.name ||
      source?.EmployerName ||
      source?.employerName ||
      source?.CompanyName ||
      source?.Company ||
      source?.company ||
      source?.organization ||
      source?.Organization ||
      source?.employer ||
      "-",

    occupation:
      (rawOccupation && typeof rawOccupation === "object"
        ? rawOccupation.description || rawOccupation.symbol
        : rawOccupation) ||
      source?.occupation ||
      source?.Occupation ||
      source?.designation ||
      source?.Designation ||
      "-",

    dateReported: normalizeDate(source?.dateReported),
  };
};

const extractEmployment = (borrower) => {
  const raw =
    borrower?.Employer ||
    borrower?.Employment ||
    borrower?.Employments ||
    borrower?.employments ||
    null;
  const entries = asArray(raw).filter(Boolean);

  const all = entries.map(normalizeSingleEmployment);

  // Backward-compatible primary shape for the existing template section,
  // plus the full list so multiple employments are no longer collapsed.
  const primary = all[0] || {
    employer: "-",
    occupation: "-",
    dateReported: "-",
  };

  return {
    ...primary,
    all,
  };
};

// ============================================================
// ACCOUNT TYPE
// ============================================================

const getAccountType = (partition, grantedTrade) => {
  return (
    partition?.accountTypeDescription ||
    grantedTrade?.AccountType?.description ||
    partition?.accountTypeSymbol ||
    grantedTrade?.AccountType?.symbol ||
    "-"
  );
};

// ============================================================
// ACCOUNT STATUS
// The provider frequently ships OpenClosed / AccountCondition with
// empty description + symbol. When that happens the status is
// derived from the closure date instead of rendering "-".
// ============================================================

const getAccountStatus = (tradeline) => {
  const bureauStatus =
    tradeline?.OpenClosed?.description ||
    tradeline?.OpenClosed?.symbol ||
    tradeline?.AccountCondition?.description ||
    tradeline?.AccountCondition?.symbol ||
    "";

  if (bureauStatus) {
    return bureauStatus;
  }

  const closedDate = normalizeDate(tradeline?.dateClosed);

  if (closedDate && closedDate !== "-") {
    return "Closed";
  }

  if (normalizeDate(tradeline?.dateOpened) !== "-") {
    return "Open";
  }

  return "-";
};

// ============================================================
// EXTRACT ACCOUNTS
// ============================================================

const extractAccounts = (report) => {
  const partitions = asArray(report?.TradeLinePartition);

  const accounts = [];

  partitions.forEach((partition) => {
    const tradeline = partition?.Tradeline;

    if (!tradeline) {
      return;
    }

    const grantedTrade = tradeline?.GrantedTrade || {};

    accounts.push({
      // --------------------------------------------------------
      // BASIC ACCOUNT DETAILS
      // --------------------------------------------------------

      creditorName: tradeline?.creditorName || "-",

      accountNumber: maskAccountNumber(tradeline?.accountNumber),

      rawAccountNumber: tradeline?.accountNumber || "-",

      accountType: getAccountType(partition, grantedTrade),

      accountTypeCode:
        partition?.accountTypeSymbol ||
        grantedTrade?.AccountType?.symbol ||
        "-",

      // --------------------------------------------------------
      // DATES
      // --------------------------------------------------------

      dateOpened: normalizeDate(tradeline?.dateOpened),

      dateClosed: normalizeDate(tradeline?.dateClosed),

      dateReported: normalizeDate(tradeline?.dateReported),

      dateAccountStatus: normalizeDate(tradeline?.dateAccountStatus),

      // --------------------------------------------------------
      // AMOUNTS
      // --------------------------------------------------------

      currentBalance: cleanValue(tradeline?.currentBalance),

      highBalance: cleanValue(tradeline?.highBalance),

      amountPastDue: cleanValue(grantedTrade?.amountPastDue),

      creditLimit: cleanValue(grantedTrade?.CreditLimit),

      cashLimit: cleanValue(grantedTrade?.CashLimit),

      interestRate: cleanValue(grantedTrade?.interestRate),

      emi: cleanValue(grantedTrade?.EMIAmount),

      repaymentTenure: cleanValue(grantedTrade?.termMonths),

      dateLastPayment: normalizeDate(grantedTrade?.dateLastPayment),

      // --------------------------------------------------------
      // WRITE OFF / SETTLEMENT
      // --------------------------------------------------------

      writtenOff: cleanValue(tradeline?.writtenOffAmtTotal),

      writtenOffPrincipal: cleanValue(tradeline?.writtenOffPrincipal),

      settlementAmount: cleanValue(tradeline?.settlementAmount),

      // --------------------------------------------------------
      // PAYMENT / COLLATERAL
      // --------------------------------------------------------

      actualPaymentAmount: cleanValue(grantedTrade?.actualPaymentAmount),

      collateral: cleanValue(grantedTrade?.collateral),

      collateralType:
        grantedTrade?.CollateralType?.description ||
        grantedTrade?.CollateralType?.symbol ||
        "-",

      paymentFrequency:
        grantedTrade?.PaymentFrequency?.description ||
        grantedTrade?.PaymentFrequency?.symbol ||
        "-",

      creditType:
        grantedTrade?.CreditType?.description ||
        grantedTrade?.CreditType?.symbol ||
        "-",

      // --------------------------------------------------------
      // STATUS
      // --------------------------------------------------------

      status: getAccountStatus(tradeline),

      // --------------------------------------------------------
      // PAYMENT HISTORY
      // --------------------------------------------------------

      paymentHistory: normalizePaymentHistory(grantedTrade?.PayStatusHistory),
    });
  });

  return accounts;
};

// ============================================================
// EXTRACT INQUIRIES
// ============================================================

const extractInquiries = (report) => {
  const partitions = asArray(report?.InquiryPartition);

  const inquiries = [];

  partitions.forEach((partition) => {
    const inquiry = partition?.Inquiry;

    if (!inquiry) {
      return;
    }

    inquiries.push({
      subscriberName:
        inquiry?.subscriberName ||
        inquiry?.memberName ||
        inquiry?.MemberName ||
        "-",

      inquiryDate: normalizeDate(inquiry?.inquiryDate || inquiry?.date),

      inquiryType: inquiry?.inquiryType || "-",

      amount: cleanValue(inquiry?.amount),

      controlNumber: inquiry?.enqControlNum || "-",

      description: inquiry?.description || "-",

      subscriberNumber: inquiry?.subscriberNumber || "-",
    });
  });

  return inquiries;
};

// ============================================================
// ACCOUNT SUMMARY
// ============================================================

const calculateSummary = (accounts) => {
  let totalCurrentBalance = 0;
  let totalHighBalance = 0;
  let totalPastDue = 0;

  let activeAccounts = 0;
  let closedAccounts = 0;

  accounts.forEach((account) => {
    totalCurrentBalance += toNumber(account.currentBalance);

    totalHighBalance += toNumber(account.highBalance);

    totalPastDue += toNumber(account.amountPastDue);

    const closed =
      account.dateClosed &&
      account.dateClosed !== "-" &&
      account.dateClosed !== "";

    if (closed) {
      closedAccounts++;
    } else {
      activeAccounts++;
    }
  });

  return {
    totalAccounts: accounts.length,

    activeAccounts,

    closedAccounts,

    totalCurrentBalance,

    totalHighBalance,

    totalPastDue,
  };
};

// ============================================================
// PREPARE PDF DATA
// ============================================================

// ============================================================
// GET CUSTOMER ASSETS SUCCESS NODE
// Holds bureau-level aggregates (CreditSummaryData) alongside the
// TrueLink report. Returned as {} when absent — never throws.
// ============================================================

const getCustomerAssetsSuccess = (apiResponse) => {
  return (
    apiResponse?.data?.cibilData?.GetCustomerAssetsResponse
      ?.GetCustomerAssetsSuccess || {}
  );
};

// ============================================================
// BUREAU CREDIT SUMMARY (as-reported aggregates)
// Displayed verbatim from the bureau — never recomputed locally.
// ============================================================

const extractCreditSummary = (successNode) => {
  const summary = successNode?.CreditSummaryData || null;

  if (!summary) {
    return null;
  }

  return {
    oldestCreditAccountPeriod: summary?.OldestCreditAccountPeriod ?? "-",
    inquiries: summary?.Inquires ?? summary?.Inquiries ?? "-",
    onTimePaymentHistory: summary?.OnTimePaymentHistory ?? "-",
    creditCardUtilization: summary?.CreditCardUtilization ?? "-",
    creditMix: summary?.CreditMix ?? "-",
  };
};

const prepareCibilPdfData = (apiResponse, creditReportId) => {
  const report = getTrueLinkCreditReport(apiResponse);

  if (!report) {
    throw new Error("TrueLinkCreditReport not found in CIBIL API response");
  }

  const parseWarnings = [];
  const successNode = getCustomerAssetsSuccess(apiResponse);
  const borrower = report?.Borrower || {};

  // ----------------------------------------------------------
  // SINGLETON COERCIONS (data present under an unexpected shape)
  // ----------------------------------------------------------

  if (wasSingleton(report?.TradeLinePartition)) {
    parseWarnings.push(
      "TradeLinePartition arrived as a single object; coerced to a one-account list.",
    );
  }
  if (isIndexedMap(report?.TradeLinePartition)) {
    parseWarnings.push(
      "TradeLinePartition arrived as an index-keyed map; coerced to a list.",
    );
  }
  if (wasSingleton(report?.InquiryPartition)) {
    parseWarnings.push(
      "InquiryPartition arrived as a single object; coerced to a one-enquiry list.",
    );
  }
  if (wasSingleton(borrower?.BorrowerAddress)) {
    parseWarnings.push(
      "BorrowerAddress arrived as a single object; coerced to a one-address list.",
    );
  }
  if (wasSingleton(borrower?.BorrowerTelephone)) {
    parseWarnings.push(
      "BorrowerTelephone arrived as a single object; coerced to a one-phone list.",
    );
  }
  if (wasSingleton(borrower?.EmailAddress)) {
    parseWarnings.push(
      "EmailAddress arrived as a single object; coerced to a one-email list.",
    );
  }

  const name = extractBorrowerName(borrower);

  const emails = extractEmails(borrower);

  const phones = extractPhones(borrower);

  const addresses = extractAddresses(borrower);

  const identifiers = extractIdentifiers(borrower);

  const employment = extractEmployment(borrower);

  const accounts = extractAccounts(report);

  const inquiries = extractInquiries(report);

  const creditSummary = extractCreditSummary(successNode);

  const score = borrower?.CreditScore || {};
  const scoreAvailable =
    score?.riskScore !== null &&
    score?.riskScore !== undefined &&
    score?.riskScore !== "" &&
    score?.riskScore !== "-";

  // ----------------------------------------------------------
  // EMPTY-SECTION DIAGNOSTICS (raw present but nothing extracted)
  // ----------------------------------------------------------

  if (!accounts.length && report?.TradeLinePartition) {
    parseWarnings.push(
      "TradeLinePartition was present but no accounts could be extracted.",
    );
  }
  if (!inquiries.length && report?.InquiryPartition) {
    parseWarnings.push(
      "InquiryPartition was present but no enquiries could be extracted.",
    );
  }
  if (!scoreAvailable) {
    parseWarnings.push("Bureau did not return a credit score.");
  }

  // ----------------------------------------------------------
  // GENDER
  // ----------------------------------------------------------

  let gender = "-";

  if (typeof borrower?.Gender === "string") {
    gender = borrower.Gender;
  } else if (borrower?.Gender?.description) {
    gender = borrower.Gender.description;
  } else if (borrower?.Gender?.symbol) {
    gender = borrower.Gender.symbol;
  }

  // ----------------------------------------------------------
  // RETURN NORMALIZED DATA
  // ----------------------------------------------------------

  return {
    creditReportId,

    referenceKey: report?.ReferenceKey || "-",

    reportVersion: report?.currentversion || "-",

    generatedAt: (() => {
      const apiDateTime = apiResponse?.data?.verify?.result?.datetime;

      if (!apiDateTime) {
        return new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        });
      }

      return apiDateTime.split(" ")[0];
    })(),

    generatedTime: formatTime(apiResponse?.data?.verify?.result?.datetime),

    borrower: {
      borrowerKey: borrower?.borrowerKey || "-",

      ...name,

      dob: normalizeDate(borrower?.Birth?.date),

      gender,

      emails,

      phones,

      addresses,

      identifiers,
    },

    score: {
      value: scoreAvailable ? score.riskScore : null,

      model:
        score?.CreditScoreModel?.description ||
        score?.CreditScoreModel?.symbol ||
        "-",

      scoreName: score?.scoreName || "-",

      populationRank: score?.populationRank || "-",
    },

    employment,

    accounts,

    inquiries,

    summary: calculateSummary(accounts),

    creditSummary,

    bureauStatus: {
      safetyCheckPassed: report?.SafetyCheckPassed,

      frozen: report?.Frozen,

      deceased: report?.DeceasedIndicator,

      fraud: report?.FraudIndicator,
    },

    parseWarnings,
  };
};

// ============================================================
// GENERATE PDF
// ============================================================

const generateCibilPdf = async (apiResponse, creditReportId) => {
  let browser;

  try {
    console.log("[CIBIL PDF] Preparing report data...");

    // --------------------------------------------------------
    // PREPARE DATA
    // --------------------------------------------------------

    const pdfData = prepareCibilPdfData(apiResponse, creditReportId);

    console.log("[CIBIL PDF] Accounts:", pdfData.accounts.length);

    console.log("[CIBIL PDF] Inquiries:", pdfData.inquiries.length);

    if (pdfData.parseWarnings?.length) {
      console.warn(
        "[CIBIL PDF] Data-quality warnings for",
        creditReportId,
        ":",
        pdfData.parseWarnings.join(" | "),
      );
    }

    // --------------------------------------------------------
    // BUILD HTML
    // --------------------------------------------------------

    const html = buildCibilReportHtml(pdfData);

    // --------------------------------------------------------
    // CIBIL PDF FOLDER
    // --------------------------------------------------------

    const uploadDir = path.join(
      process.cwd(),
      "uploads",
      "credit-reports",
      "cibil",
    );

    // --------------------------------------------------------
    // CREATE FOLDER IF NOT EXISTS
    // --------------------------------------------------------

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, {
        recursive: true,
      });
    }

    // --------------------------------------------------------
    // FILE NAME
    // --------------------------------------------------------

    const fileName = `cibil-report-${creditReportId}-${Date.now()}.pdf`;

    const filePath = path.join(uploadDir, fileName);

    console.log("[CIBIL PDF] File path:", filePath);

    // --------------------------------------------------------
    // LAUNCH PUPPETEER
    // --------------------------------------------------------

    console.log("[CIBIL PDF] Launching browser...");

    browser = await puppeteer.launch({
      headless: true,

      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    // --------------------------------------------------------
    // NEW PAGE
    // --------------------------------------------------------

    const page = await browser.newPage();

    // --------------------------------------------------------
    // VIEWPORT
    // --------------------------------------------------------

    await page.setViewport({
      width: 1280,
      height: 1800,
      deviceScaleFactor: 1,
    });

    // --------------------------------------------------------
    // LOAD HTML
    // --------------------------------------------------------

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    // --------------------------------------------------------
    // WAIT FOR FONTS
    // --------------------------------------------------------

    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    console.log("[CIBIL PDF] Generating PDF...");

    // --------------------------------------------------------
    // GENERATE PDF
    // --------------------------------------------------------

    await page.pdf({
      path: filePath,

      format: "A4",

      printBackground: true,

      preferCSSPageSize: true,

      displayHeaderFooter: false,

      headerTemplate: `
        <div
          style="
            width: 100%;
            font-size: 8px;
            padding: 0 25px;
            color: #777;
            font-family: Arial, sans-serif;
          "
        >
          CIBIL Credit Information Report
        </div>
      `,

      footerTemplate: `
        <div
          style="
            width: 100%;
            font-size: 8px;
            padding: 0 25px;
            color: #777;
            text-align: center;
            font-family: Arial, sans-serif;
          "
        >
          Page
          <span class="pageNumber"></span>
          of
          <span class="totalPages"></span>
        </div>
      `,

      margin: {
        top: "45px",
        bottom: "45px",
        left: "25px",
        right: "25px",
      },
    });

    // --------------------------------------------------------
    // CLOSE BROWSER
    // --------------------------------------------------------

    await browser.close();

    browser = null;

    console.log("[CIBIL PDF] PDF generated:", filePath);

    // --------------------------------------------------------
    // RETURN
    // --------------------------------------------------------

    return {
      success: true,

      fileName,

      filePath,

      // IMPORTANT:
      // CIBIL folder URL
      relativePath: `/uploads/credit-reports/cibil/${fileName}`,

      // Same URL as relativePath
      pdfUrl: `/uploads/credit-reports/cibil/${fileName}`,

      data: pdfData,
    };
  } catch (error) {
    console.error("[CIBIL PDF] Generation error:", error);

    // --------------------------------------------------------
    // CLOSE BROWSER ON ERROR
    // --------------------------------------------------------

    if (browser) {
      await browser.close();
    }

    throw error;
  }
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  generateCibilPdf,
  prepareCibilPdfData,
  getTrueLinkCreditReport,
  getCustomerAssetsSuccess,
  extractCreditSummary,
  asArray,
};
