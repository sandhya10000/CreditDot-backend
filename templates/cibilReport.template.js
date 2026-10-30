// ============================================================
// TRANSUNION CIBIL CREDIT REPORT TEMPLATE
// File: templates/cibilReport.template.js
// ============================================================

const escapeHtml = (value) => {
  if (value === null || value === undefined || value === "") return "-";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const hasValue = (v) => v !== null && v !== undefined && v !== "" && v !== "-";

const safe = (v) => escapeHtml(hasValue(v) ? v : "-");

const first = (...values) => values.find(hasValue) ?? "-";

// --------------------------------------------------
// DATE FORMAT
// --------------------------------------------------

const formatDate = (value) => {
  if (!hasValue(value)) return "-";

  const raw = String(value).trim();
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);

  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  return escapeHtml(raw);
};

// --------------------------------------------------
// AMOUNT FORMAT
// --------------------------------------------------

const formatAmount = (value) => {
  if (!hasValue(value) || String(value) === "-1") return "-";

  const n = Number(value);

  return Number.isFinite(n)
    ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : escapeHtml(value);
};

// --------------------------------------------------
// ACCOUNT TYPE FORMAT
// --------------------------------------------------

const formatAccountType = (account = {}) => {
  const descriptions = [
    account.accountTypeDescription,
    account.accountType?.description,
    account.creditAccountType?.description,
    account.accountTypeName,
  ];

  const description = descriptions.find(
    (value) => typeof value === "string" && value.trim() !== "",
  );

  if (description) return description;

  const rawCode = first(
    account.accountTypeSymbol,
    account.accountType?.symbol,
    account.creditAccountType?.symbol,
    account.accountType,
    account.creditAccountType,
    account.type,
    account.portfolioType,
    account.Tradeline?.AccountType?.symbol,
  );

  const code = String(rawCode).trim();

  const accountTypeMap = {
    "00": "Other",
    "01": "Auto Loan (Personal)",
    "02": "Housing Loan",
    "03": "Property Loan",
    "04": "Loan Against Shares/Securities",
    "05": "Personal Loan",
    "06": "Consumer Loan",
    "07": "Gold Loan",
    "08": "Education Loan",
    "09": "Loan to Professional",
    10: "Credit Card",
    11: "Leasing",
    12: "Overdraft",
    13: "Two-Wheeler Loan",
    14: "Non-Funded Credit Facility",
    15: "Loan Against Bank Deposits",
    16: "Fleet Card",
    17: "Commercial Vehicle Loan",
    31: "Secured Credit Card",
    32: "Used Car Loan",
    37: "Loan on Credit Card",
    40: "Microfinance - Business Loan",
    41: "Microfinance - Personal Loan",
    42: "Microfinance - Housing Loan",
    43: "Microfinance - Other",
    45: "P2P Personal Loan",
    46: "P2P Auto Loan",
    47: "P2P Education Loan",
    50: "Business Loan - Secured",
    51: "Business Loan - General",
    52: "Business Loan - Priority Sector - Small Business",
    53: "Business Loan - Priority Sector - Agriculture",
    54: "Business Loan - Priority Sector - Others",
    55: "Business Non-Funded Credit Facility - General",
    56: "Business Non-Funded Credit Facility - Priority Sector - Small Business",
    57: "Business Non-Funded Credit Facility - Priority Sector - Agriculture",
    58: "Business Non-Funded Credit Facility - Priority Sector - Others",
    59: "Business Loan Against Bank Deposits",
    61: "Business Loan - Unsecured",
  };

  return (
    accountTypeMap[code] ||
    (code && code !== "-" ? `Account Type (Code: ${code})` : "-")
  );
};

// --------------------------------------------------
// REPORT DATE AND TIME
// --------------------------------------------------

const formatDateTime = (value) => {
  if (!hasValue(value)) return "-";

  const raw = String(value);
  const d = new Date(raw);

  if (!Number.isNaN(d.getTime()) && raw.includes("T")) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return formatDate(value);
};

const formatTime = (value) => {
  if (!hasValue(value)) return "-";

  const raw = String(value).trim();

  const match = raw.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2}):(\d{2})/);

  if (match) {
    const hours = Number(match[1]);
    const minutes = match[2];
    const seconds = match[3];
    const period = hours >= 12 ? "PM" : "AM";
    const formattedHours = String(hours % 12 || 12).padStart(2, "0");

    return `${formattedHours}:${minutes}:${seconds} ${period}`;
  }

  return escapeHtml(raw);
};
//format for CREDIT FACILITY STATUS
//format for CREDIT FACILITY STATUS
const formatCreditFacilityStatus = (account = {}) => {
  const creditFacilityStatus = account.creditFacilityStatus;

  const condition =
    account.AccountCondition ||
    account.accountCondition ||
    account.Tradeline?.AccountCondition ||
    account.Tradeline?.accountCondition ||
    {};

  // Support string and object formats
  const rawStatus =
    (typeof creditFacilityStatus === "object" && creditFacilityStatus !== null
      ? creditFacilityStatus.symbol
      : creditFacilityStatus) ??
    account.creditFacilityStatusCode ??
    condition.symbol ??
    account.status;

  const description =
    condition.description ||
    (typeof creditFacilityStatus === "object" && creditFacilityStatus !== null
      ? creditFacilityStatus.description
      : "");

  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }

  if (
    rawStatus === null ||
    rawStatus === undefined ||
    String(rawStatus).trim() === ""
  ) {
    return "-";
  }

  const statusCode = String(rawStatus).trim();

  // Standard CIBIL Bureau Status/Condition Mappings (1 to 12)
  const statusMap = {
    1: "Standard / Active",
    "01": "Standard / Active",
    2: "Closed",
    "02": "Closed",
    3: "Written-off",
    "03": "Written-off",
    4: "Suit Filed / Wilful Default",
    "04": "Suit Filed / Wilful Default",
    5: "Settled",
    "05": "Settled",
    6: "Post Write-Off Settled",
    "06": "Post Write-Off Settled",
    7: "Restructured",
    "07": "Restructured",
    8: "Account Transferred / Sold",
    "08": "Account Transferred / Sold",
    9: "Suit Filed & Written-off",
    "09": "Suit Filed & Written-off",
    10: "Restructured due to Natural Calamity",
    11: "Restructured (Government Scheme)",
    12: "Data Dormant / Inactive",
  };

  return statusMap[statusCode] || statusCode;
};
// --------------------------------------------------
// COMMON HTML HELPERS
// --------------------------------------------------

const sectionTitle = (title, extraClass = "") =>
  `<div class="section-title ${extraClass}">${safe(title)}</div>`;

const field = (label, value) =>
  `<div class="field">
    <span class="field-label">${safe(label)}:</span>
    <span class="field-value">${value === undefined || value === null || value === "" ? "-" : value}</span>
  </div>`;

const table = (headers, rows, emptyMessage = "Not reported") => {
  if (!rows.length) {
    return `<div class="empty">${safe(emptyMessage)}</div>`;
  }

  return `
    <table class="data-table">
      <thead>
        <tr>${headers.map((h) => `<th>${safe(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
};

// --------------------------------------------------
// HEADER
// --------------------------------------------------

const renderHeader = (data) => {
  const meta = data.reportMeta || {};
  const borrower = data.borrower || {};
  const now = new Date();

  const generated = first(
    meta.generatedAt,
    data.generatedAt,
    now.toISOString(),
  );

  const dateText = first(meta.reportDate, data.reportDate, generated);

  const timeText = first(
    meta.reportTime,
    data.reportTime,
    data.generatedTime,
    data.reportMeta?.datetime,
    data.datetime,
    "-",
  );

  return `
    <div class="brand-row">
      <div class="brand-logo">
        <span class="tu">TransUnion</span>
        <span class="cibil">CIBIL</span><sup>®</sup>
      </div>
    </div>

    <div class="yellow-band">CONSUMER CIR</div>

    <div class="meta-grid">
      <div>
        <em>CONSUMER:</em>
        <strong>${safe(first(meta.consumerName, borrower.fullName, borrower.name))}</strong>
      </div>

      <div>
        <em>DATE:</em>
        <strong>${safe(formatDateTime(dateText))}</strong>
      </div>

      <div>
        <em>MEMBER ID:</em>
        <strong>${safe(first(meta.memberId, data.memberId))}</strong>
      </div>

      <div>
        <em>TIME:</em>
        <strong>${safe(formatTime(timeText))}</strong>
      </div>

      <div>
        <em>MEMBER REFERENCE NUMBER:</em>
        <strong>${safe(first(meta.memberReferenceNumber, data.memberReferenceNumber))}</strong>
      </div>

      <div>
        <em>CONTROL NUMBER:</em>
        <strong>${safe(first(meta.controlNumber, data.controlNumber, data.referenceKey))}</strong>
      </div>
    </div>`;
};

// --------------------------------------------------
// CONSUMER INFORMATION
// --------------------------------------------------

const renderPersonalInformation = (data) => {
  const b = data.borrower || {};

  return `
    ${sectionTitle("CONSUMER INFORMATION")}

    <div class="consumer-row">
      <div>${field("NAME", safe(first(b.fullName, b.name)))}</div>
      <div>${field("GENDER", safe(b.gender))}</div>
      <div>${field("DATE OF BIRTH", safe(formatDate(first(b.dob, b.dateOfBirth))))}</div>
    </div>`;
};

// --------------------------------------------------
// CIBIL SCORE
// --------------------------------------------------

const renderCreditScore = (data) => {
  const score = data.score || {};

  const factors = Array.isArray(score.scoringFactors)
    ? score.scoringFactors
    : Array.isArray(data.scoringFactors)
      ? data.scoringFactors
      : [];

  const factorsHtml = factors.length
    ? factors
        .map(
          (x, i) =>
            `<div>${i + 1}. ${safe(typeof x === "object" ? first(x.description, x.name, x.value) : x)}</div>`,
        )
        .join("")
    : "<div>-</div>";

  return `
    ${sectionTitle("CIBIL TRANSUNION SCORE(S)")}

    <table class="score-table">
      <thead>
        <tr>
          <th>SCORE NAME</th>
          <th>SCORE</th>
          <th>SCORING FACTORS</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td class="score-name">
            ${safe(first(score.scoreName, score.model, "CIBILTRANSUNIONSCORE3"))}
          </td>

          <td class="score-number">${safe(score.value)}</td>

          <td class="score-factors">${factorsHtml}</td>
        </tr>
      </tbody>
    </table>

    <div class="range-box">
      <strong>POSSIBLE RANGE FOR CREDITVISION® SCORE</strong>

      <div>
        Consumer with at least one trade on the bureau in last 36 months
        <span>: 300 (high risk) to 900 (low risk)</span>
      </div>

      <div>
        Consumer not in CIBIL database or history older than 36 months
        <span>: -1</span>
      </div>

      <div>
        * At least one tradeline with information updated in last 36 months is required.
      </div>
    </div>`;
};

// --------------------------------------------------
// IDENTIFICATION
// --------------------------------------------------

const renderIdentifiers = (data) => {
  const items = data.borrower?.identifiers || data.identifiers || [];

  const rows = items.map(
    (x) => `
    <tr>
      <td>${safe(first(x.type, x.identifierType))}</td>
      <td>${safe(first(x.value, x.number, x.identifierNumber))}</td>
      <td>${safe(formatDate(x.issueDate))}</td>
      <td>${safe(formatDate(x.expirationDate))}</td>
    </tr>`,
  );

  return `
    ${sectionTitle("IDENTIFICATION(S)")}

    ${table(
      [
        "IDENTIFICATION TYPE",
        "IDENTIFICATION NUMBER",
        "ISSUE DATE",
        "EXPIRATION DATE",
      ],
      rows,
      "Identification details not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// TELEPHONE NUMBERS
// --------------------------------------------------

const renderPhones = (data) => {
  const phones = data.borrower?.phones || data.phones || [];

  const rows = phones.map((x) => {
    const p = typeof x === "object" ? x : { number: x };

    return `
      <tr>
        <td>${safe(first(p.type, p.telephoneType, "Not Classified"))}</td>
        <td>${safe(first(p.number, p.value, p.phone, p.telephoneNumber))}</td>
        <td>${safe(first(p.extension, p.telephoneExtension))}</td>
      </tr>`;
  });

  return `
    ${sectionTitle("TELEPHONE(S)")}

    ${table(
      ["TELEPHONE TYPE", "TELEPHONE NUMBER", "TELEPHONE EXTENSION"],
      rows,
      "Telephone numbers not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// EMAILS
// --------------------------------------------------

const renderEmails = (data) => {
  const emails = data.borrower?.emails || data.emails || [];

  const rows = emails.map(
    (x) => `
    <tr>
      <td>${safe(typeof x === "object" ? first(x.email, x.address, x.value) : x)}</td>
    </tr>`,
  );

  return `
    ${sectionTitle("EMAIL CONTACT(S)")}

    ${table(
      ["EMAIL ADDRESS"],
      rows,
      "Email addresses not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// ADDRESSES
// --------------------------------------------------

const renderAddresses = (data) => {
  const addresses = data.borrower?.addresses || data.addresses || [];

  const rows = addresses.map((x) => {
    const address = first(
      x.address,
      x.fullAddress,
      [
        x.addressLine1,
        x.addressLine2,
        x.addressLine3,
        x.city,
        x.state,
        x.pincode,
      ]
        .filter(hasValue)
        .join(", "),
    );

    return `
      <tr>
        <td>
          <b>ADDRESS:</b> ${safe(address)}<br/>
          <b>CATEGORY:</b> ${safe(first(x.category, x.type))}

          <span class="address-gap">
            <b>RESIDENCE CODE:</b> ${safe(x.residenceCode)}
          </span>

          <span class="address-gap">
            <b>DATE REPORTED:</b> ${safe(formatDate(x.reportedDate))}
          </span>
        </td>
      </tr>`;
  });

  return `
    ${sectionTitle("ADDRESS(ES)")}

    ${table(
      ["ADDRESS DETAILS"],
      rows,
      "Address information not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// EMPLOYMENT
// --------------------------------------------------

const renderEmployment = (data) => {
  const e = data.employment || {};

  const records =
    Array.isArray(e.all) && e.all.length
      ? e.all
      : Array.isArray(data.employments)
        ? data.employments
        : Object.keys(e).length
          ? [e]
          : [];

  const rows = records.map(
    (x) => `
    <tr>
      <td>${safe(first(x.accountType))}</td>
      <td>${safe(first(x.employer, x.employerName))}</td>
      <td>${safe(formatDate(x.dateReported))}</td>
      <td>${safe(first(x.occupationCode, x.occupation))}</td>
      <td>${safe(formatAmount(x.income))}</td>
      <td>${safe(first(x.incomeIndicator, x.netGrossIndicator))}</td>
      <td>${safe(first(x.incomeFrequency, x.monthlyAnnualIndicator))}</td>
    </tr>`,
  );

  return `
    ${sectionTitle("EMPLOYMENT INFORMATION")}

    ${table(
      [
        "ACCOUNT TYPE",
        "EMPLOYER NAME",
        "DATE REPORTED",
        "OCCUPATION CODE",
        "INCOME",
        "NET / GROSS INCOME INDICATOR",
        "MONTHLY / ANNUAL INCOME INDICATOR",
      ],
      rows,
      "Employment information not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// SUMMARY
// --------------------------------------------------

const renderSummary = (data) => {
  const s = data.summary || {};
  const enq = data.enquirySummary || {};

  return `
    ${sectionTitle("SUMMARY")}

    <div class="subheading">ACCOUNT(S)</div>

    <table class="summary-table">
      <thead>
        <tr>
          <th>ACCOUNT TYPE</th>
          <th>ACCOUNTS</th>
          <th>ADVANCES</th>
          <th>BALANCES</th>
          <th>DATE OPENED</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>All Accounts</td>

          <td>
            <i>TOTAL:</i> ${safe(first(s.totalAccounts, data.accounts?.length))}<br/>
            <i>OVERDUE:</i> ${safe(s.overdueAccounts)}<br/>
            <i>ZERO-BALANCE:</i> ${safe(s.zeroBalanceAccounts)}
          </td>

          <td>
            <i>HIGH CR/SANC. AMT:</i>
            ${safe(formatAmount(first(s.totalHighBalance, s.highCreditAmount)))}
          </td>

          <td>
            <i>CURRENT:</i> ${safe(formatAmount(s.totalCurrentBalance))}<br/>
            <i>OVERDUE:</i> ${safe(formatAmount(s.totalPastDue))}
          </td>

          <td>
            <i>RECENT:</i>
            ${safe(formatDate(first(s.recentAccountOpened, s.recentDateOpened)))}<br/>

            <i>OLDEST:</i>
            ${safe(formatDate(first(s.oldestAccountOpened, s.oldestDateOpened)))}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="subheading">ENQUIRIES</div>

    <table class="summary-table">
      <thead>
        <tr>
          <th>ENQUIRY PURPOSE</th>
          <th>TOTAL</th>
          <th>PAST 30 DAYS</th>
          <th>PAST 12 MONTHS</th>
          <th>PAST 24 MONTHS</th>
          <th>RECENT</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>All Enquiries</td>
          <td>${safe(first(enq.total, data.inquiries?.length))}</td>
          <td>${safe(enq.past30Days)}</td>
          <td>${safe(enq.past12Months)}</td>
          <td>${safe(enq.past24Months)}</td>
          <td>${safe(formatDate(enq.recentDate))}</td>
        </tr>
      </tbody>
    </table>`;
};

// --------------------------------------------------
// PAYMENT HISTORY DATE PARSER
// --------------------------------------------------

const parseAccountHistoryDate = (item) => {
  const raw =
    typeof item === "string" || typeof item === "number"
      ? item
      : first(
          item?.date,
          item?.paymentDate,
          item?.month,
          item?.reportDate,
          item?.dateReported,
          item?.yearMonth,
        );

  if (!hasValue(raw)) return null;

  const value = String(raw).trim();

  let match = value.match(/^(\d{4})[-/](\d{1,2})/);

  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
    };
  }

  match = value.match(/^(\d{1,2})[-/](\d{4})$/);

  if (match) {
    return {
      year: Number(match[2]),
      month: Number(match[1]),
    };
  }

  match = value.match(/^(\d{1,2})[-/](\d{2})$/);

  if (match) {
    const yy = Number(match[2]);

    return {
      year: yy <= 49 ? 2000 + yy : 1900 + yy,
      month: Number(match[1]),
    };
  }

  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);

  if (match) {
    return {
      year: Number(match[3]),
      month: Number(match[2]),
    };
  }

  return null;
};

// --------------------------------------------------
// PAYMENT HISTORY STATUS
// --------------------------------------------------

const getHistoryStatus = (item) => {
  if (item === null || item === undefined) return "-";

  if (typeof item !== "object") {
    return String(item);
  }

  return String(
    first(
      item.daysPastDue,
      item.dpd,
      item.assetClassification,
      item.assetClass,
      item.paymentStatus,
      item.status,
      item.value,
      item.amount,
    ),
  );
};

// --------------------------------------------------
// PAYMENT HISTORY - SCREENSHOT STYLE
// --------------------------------------------------

const renderPaymentHistory = (account) => {
  let history =
    account.paymentHistory ||
    account.paymentHistoryDetails ||
    account.paymentHistoryList ||
    account.monthlyPaymentHistory ||
    account.dpdHistory ||
    account.assetClassificationHistory ||
    [];

  if (!Array.isArray(history) && history && typeof history === "object") {
    history = Object.entries(history).map(([date, value]) =>
      value && typeof value === "object"
        ? { date, ...value }
        : { date, status: value },
    );
  }

  const heading =
    "DAYS PAST DUE/ASSET CLASSIFICATION (UP TO 36 MONTHS; LEFT TO RIGHT)";

  if (!Array.isArray(history) || !history.length) {
    return `
      <div class="account-history">
        <div class="history-heading">${heading}</div>
        <div class="history-empty">No payment history reported.</div>
      </div>`;
  }

  const entries = history
    .map((item) => ({
      date: parseAccountHistoryDate(item),
      status: getHistoryStatus(item),
    }))
    .filter(({ date }) => date && date.month >= 1 && date.month <= 12)
    .sort(
      (a, b) =>
        b.date.year * 12 + b.date.month - (a.date.year * 12 + a.date.month),
    );

  // Keep one status for each month.
  const latestByMonth = new Map();

  entries.forEach(({ date, status }) => {
    const key = `${date.year}-${date.month}`;

    if (!latestByMonth.has(key)) {
      latestByMonth.set(key, { date, status });
    }
  });

  // Latest 36 months, newest first.
  const latestEntries = [...latestByMonth.values()].slice(0, 36);

  if (!latestEntries.length) {
    return `
      <div class="account-history">
        <div class="history-heading">${heading}</div>
        <div class="history-empty">
          Payment history dates could not be processed.
        </div>
      </div>`;
  }

  const cells = latestEntries
    .map(({ date, status }) => {
      const monthYear =
        `${String(date.month).padStart(2, "0")}-` + String(date.year).slice(-2);

      return `
        <div class="history-cell">
          <div class="history-status">${safe(status)}</div>
          <div class="history-date">${monthYear}</div>
        </div>`;
    })
    .join("");

  return `
    <div class="account-history">
      <div class="history-heading">${heading}</div>
      <div class="history-grid">${cells}</div>
    </div>`;
};

//
// --------------------------------------------------
// CREDIT ACCOUNTS - FOUR COLUMN LAYOUT
// --------------------------------------------------

// 1. Safe Ownership Formatter with String Conversion

const formatOwnership = (account) => {
  if (!account || typeof account !== "object") return "-";

  const candidates = [
    account?.ownership,
    account?.accountOwnership,
    account?.AccountOwnership,
    account?.AccountDesignator,
    account?.["OWNERSHIP-IND"],

    account?.Tradeline?.AccountDesignator,
    account?.Tradeline?.AccountOwnership,
    account?.Tradeline?.ownership,

    account?.GrantedTrade?.AccountDesignator,
    account?.GrantedTrade?.AccountOwnership,
    account?.GrantedTrade?.ownership,
  ];

  const ownership = candidates.find((item) => {
    if (item === undefined || item === null) return false;

    if (typeof item === "object") {
      return Boolean(
        item.symbol || item.description || item.abbreviation || item.value,
      );
    }

    return String(item).trim() !== "";
  });

  if (!ownership) return "-";

  const symbol =
    typeof ownership === "object"
      ? ownership.symbol ||
        ownership.description ||
        ownership.abbreviation ||
        ownership.value
      : ownership;

  const cleanSymbol = String(symbol || "").trim();

  if (!cleanSymbol) return "-";

  const ownershipMap = {
    1: "Individual",
    "01": "Individual",
    2: "Joint",
    "02": "Joint",
    3: "Authorised User",
    4: "Guarantor",
    5: "Primary",
  };

  return ownershipMap[cleanSymbol] || cleanSymbol;
};

// 2. Updated renderAccount Function
const renderAccount = (account) => {
  console.log("ACCOUNT OBJECT:", JSON.stringify(account, null, 2));
  console.log("ACCOUNT KEYS:", Object.keys(account || {}));
  const status = formatCreditFacilityStatus(account);

  const accountFields = [
    [
      "MEMBER NAME",
      first(
        account.Tradeline?.creditorName,
        account.creditorName,
        account.memberName,
      ),
    ],
    [
      "ACCOUNT NUMBER",
      first(account.Tradeline?.accountNumber, account.accountNumber),
    ],
    ["TYPE", formatAccountType(account)],
    ["OWNERSHIP", formatOwnership(account)],
    [
      "Amount Overdue",
      formatAmount(
        first(account.Tradeline?.amountPastDue, account.amountPastDue, "0"),
      ),
    ],
    [
      "INTEREST RATE",
      (() => {
        const rate = first(
          account.Tradeline?.GrantedTrade?.interestRate,
          account.GrantedTrade?.interestRate,
          account.interestRate,
        );

        // Agar rate missing hai, ya -1 / -1.00 hai toh dash return karein
        if (
          !rate ||
          rate === "-1" ||
          rate === "-1.00" ||
          rate === -1 ||
          rate === -1.0 ||
          rate === "-"
        ) {
          return "-";
        }
        return `${rate}%`;
      })(),
    ],
  ];

  const dateFields = [
    ["OPENED", formatDate(first(account.dateOpened, account.openedDate))],
    [
      "REPORTED AND CERTIFIED",
      formatDate(first(account.reportedAndCertified, account.dateReported)),
    ],
    ["PMT HIST START", formatDate(account.paymentHistoryStart)],
    ["PMT HIST END", formatDate(account.paymentHistoryEnd)],
    ["LAST PAYMENT", formatDate(account.dateLastPayment)],
    ["COLLATERAL TYPE", first(account.collateralType)],
  ];

  const amountFields = [
    [
      "HIGH CREDIT AMOUNT",
      formatAmount(
        first(
          account.highCreditAmount,
          account.highBalance,
          account.Tradeline?.highBalance,
        ),
      ),
    ],
    [
      "CREDIT LIMIT",
      formatAmount(first(account.creditLimit, account.Tradeline?.CreditLimit)),
    ],
    [
      "ACTUAL PAYMENT AMOUNT",
      formatAmount(
        first(
          account.actualPaymentAmount,
          account.actualPayment,
          account.Tradeline?.actualPaymentAmount,
        ),
      ),
    ],
    [
      "CURRENT BALANCE",
      formatAmount(
        first(account.currentBalance, account.Tradeline?.currentBalance),
      ),
    ],
    ["EMI", formatAmount(first(account.emi, account.Tradeline?.EMIAmount))],
    [
      "PAYMENT FREQUENCY",
      first(
        account.paymentFrequency,
        account.Tradeline?.GrantedTrade?.PaymentFrequency?.symbol,
      ),
    ],
    [
      "REPAYMENT TENURE",
      first(account.repaymentTenure, account.Tradeline?.termMonths),
    ],
    ["COLLATERAL VALUE", formatAmount(account.collateralValue)],
  ];

  const statusFields = [
    ["CREDIT FACILITY STATUS", status],
    [
      "ACCOUNT CLOSED",
      first(
        formatDate(account.dateClosed),
        account.accountClosed,
        formatDate(account.Tradeline?.dateClosed),
      ),
    ],
    [
      "WRITTEN-OFF AMOUNT (PRINCIPAL)",
      formatAmount(
        first(
          account.writtenOffPrincipal,
          account.Tradeline?.writtenOffPrincipal,
        ),
      ),
    ],
    [
      "WRITTEN-OFF AMOUNT (TOTAL)",
      formatAmount(
        first(account.writtenOff, account.Tradeline?.writtenOffAmtTotal),
      ),
    ],
    [
      "SETTLEMENT AMOUNT",
      formatAmount(
        first(account.settlementAmount, account.Tradeline?.settlementAmount),
      ),
    ],
    ["SUIT - FILED / WILFUL DEFAULT", first(account.suitFiledWilfulDefault)],
    [
      "CASH LIMIT",
      formatAmount(first(account.cashLimit, account.Tradeline?.CashLimit)),
    ],
  ];

  const renderFields = (fields) =>
    fields
      .map(
        ([label, value]) => `
          <div class="account-field">
            <span class="account-label">${safe(label)}:</span>
            <span class="account-value">${safe(value)}</span>
          </div>`,
      )
      .join("");

  return `
    <div class="account-record">
      <div class="account-column-headings">
        <div>ACCOUNT</div>
        <div>DATES</div>
        <div>AMOUNTS</div>
        <div>STATUS</div>
      </div>

      <div class="account-columns">
        <div class="account-col">
          ${renderFields(accountFields)}
        </div>

        <div class="account-col">
          ${renderFields(dateFields)}
        </div>

        <div class="account-col">
          ${renderFields(amountFields)}
        </div>

        <div class="account-col">
          ${renderFields(statusFields)}
        </div>
      </div>

      ${renderPaymentHistory(account)}
    </div>`;
};

// --------------------------------------------------
// ALL ACCOUNTS
// --------------------------------------------------

const renderAccounts = (data) => {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];

  return `
    ${sectionTitle("ACCOUNT(S)")}

    ${
      accounts.length
        ? accounts.map(renderAccount).join("")
        : `<div class="empty">Credit accounts not reported by bureau.</div>`
    }`;
};

// --------------------------------------------------
// ENQUIRIES
// --------------------------------------------------

const renderEnquiries = (data) => {
  const items = Array.isArray(data.inquiries) ? data.inquiries : [];

  const rows = items.map(
    (x) => `
    <tr>
      <td>${safe(first(x.subscriberName, x.memberName, x.member))}</td>
      <td>${safe(formatDate(first(x.inquiryDate, x.date)))}</td>
      <td>${safe(first(x.inquiryType, x.purpose))}</td>
      <td>${safe(formatAmount(first(x.amount, x.inquiryAmount)))}</td>
    </tr>`,
  );

  return `
    ${sectionTitle("ENQUIRIES")}

    ${table(
      ["MEMBER", "ENQUIRY DATE", "ENQUIRY PURPOSE", "ENQUIRY AMOUNT"],
      rows,
      "Credit enquiries not reported by bureau.",
    )}`;
};

// --------------------------------------------------
// MAIN HTML TEMPLATE
// --------------------------------------------------

const generateCibilPdf = (data = {}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Consumer CIR - TransUnion CIBIL</title>

<style>
* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Default report typography */
body,
body * {
  font-weight: 700;
}

.account-label {
  font-weight: 400 !important;
}

@page {
  size: A4;
  margin: 7mm 7mm 8mm;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  background: #fff;
  color: #111;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8px;
  line-height: 1.25;
}

/* --------------------------------------------------
   HEADER
-------------------------------------------------- */

.brand-row {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 2px 8px 5px;
}

.brand-logo {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.tu,
.cibil {
  font-size: 25px;
  color: #63C5DA;
  font-weight: 500;
  letter-spacing: -1px;
}

.brand-logo sup {
  font-size: 7px;
  color: #63C5DA;
}

.yellow-band {
  background: #ffdc00;
  color: #111;
  font-size: 12px;
  padding: 4px 6px;
  margin: 0 0 5px;
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
  padding: 0 2px 4px;
  border-bottom: 3px solid #18a9c1;
  margin-bottom: 6px;
  font-size: 8px;
}

.meta-grid > div {
  min-width: 0;
  overflow-wrap: anywhere;
}

.meta-grid em {
  font-style: italic;
  color: #777;
  font-size: 7px;
}

.meta-grid strong {
  color: #111;
}

/* --------------------------------------------------
   SECTION TITLES
-------------------------------------------------- */

.section-title {
  margin: 7px 0 3px;
  padding: 0 1px 2px;
  font-size: 10px;
  color: #444;
  border-bottom: 1px solid #b7b7b7;
  text-transform: uppercase;
  break-after: avoid;
}

/* --------------------------------------------------
   CONSUMER INFORMATION
-------------------------------------------------- */

.consumer-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2px 12px;
  padding: 1px 2px 3px;
}

.consumer-row > div:nth-child(3) {
  grid-column: 1 / -1;
}

.field {
  margin: 1px 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.field-label {
  color: #63C5DA;
  font-size: 7px;
  text-transform: uppercase;
}

.field-value {
  color: #111;
  font-size: 8px;
}

/* --------------------------------------------------
   DATA TABLES
-------------------------------------------------- */

.data-table,
.summary-table,
.score-table,
.payment-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 2px 0 5px;
  font-size: 8px;
}

.data-table th,
.summary-table th,
.score-table th {
  color: #63C5DA;
  background: #e9e9e9;
  text-align: left;
  font-size: 7px;
  padding: 4px;
  vertical-align: top;
}

.data-table td,
.summary-table td,
.score-table td {
  padding: 3px 4px;
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.data-table tbody tr:nth-child(odd),
.summary-table tbody tr:nth-child(odd) {
  background: #ededed;
}

.data-table tbody tr:nth-child(even),
.summary-table tbody tr:nth-child(even) {
  background: #fff;
}

.data-table th,
.data-table td {
  border: 0;
}

.data-table tr {
  break-inside: avoid;
}

/* --------------------------------------------------
   SCORE TABLE
-------------------------------------------------- */

.score-table th:nth-child(1) {
  width: 25%;
}

.score-table th:nth-child(2) {
  width: 25%;
}

.score-table th:nth-child(3) {
  width: 50%;
}

.score-name {
  background: #ededed;
  color: #3155b8;
}

.score-number {
  background: #ededed;
  font-size: 22px;
  color: #3155b8;
  text-align: center;
}

.score-factors {
  background: #ededed;
  font-size: 7px;
}

.range-box {
  background: #ededed;
  padding: 5px 7px;
  margin: 5px 0 7px;
  font-size: 7px;
}

.range-box strong {
  display: block;
  color: #3155b8;
  font-size: 8px;
  margin-bottom: 2px;
}

.range-box span {
  color: #b33;
}

.range-box div {
  margin: 1px 0;
}

/* --------------------------------------------------
   SUMMARY
-------------------------------------------------- */

.subheading {
  font-size: 9px;
  color: #63C5DA;
  margin: 5px 0 2px;
}

.summary-table th {
  background: #e8e8e8;
}

.summary-table td {
  font-size: 7px;
}

.summary-table i {
  color: #888;
  font-style: italic;
}

.address-gap {
  margin-left: 12px;
}

/* --------------------------------------------------
   ACCOUNT SECTION - SCREENSHOT STYLE
-------------------------------------------------- */

.account-record {
  width: 100%;
  padding: 8px 7px 5px;
  margin: 0;
  border-bottom: 4px solid #888;
  background: #fff;
  break-inside: auto;
}

.account-column-headings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 5px;
  color: #00a9d0;
  font-size: 11px;
  font-weight: 700;
}

.account-columns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.account-col {
  min-width: 0;
}

.account-field {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
  margin: 1px 0;
  line-height: 1.22;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.account-label {
  color: #929292;
  font-size: 10px;
  font-weight: 400;
  font-style: italic;
  text-transform: uppercase;
}

.account-value {
  color: #111;
  font-size: 10px;
  font-weight: 700;
  font-style: normal;
}

/* --------------------------------------------------
   ACCOUNT PAYMENT HISTORY
-------------------------------------------------- */

.account-history {
  width: 100%;
  margin-top: 18px;
  padding-bottom: 2px;
}

.history-heading {
  color: #00a9d0;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 10px;
  line-height: 1.3;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(18, minmax(0, 1fr));
  gap: 6px 3px;
  width: 100%;
}

.history-cell {
  min-width: 0;
  text-align: center;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.history-status {
  color: #111;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.history-date {
  color: #111;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.history-empty {
  color: #777;
  font-size: 9px;
  padding: 3px 0;
}

/* --------------------------------------------------
   EMPTY STATES
-------------------------------------------------- */

.payment-empty {
  font-size: 7px;
  color: #777;
  padding: 4px;
  border: 1px solid #999;
}

.empty {
  padding: 5px;
  background: #ededed;
  color: #555;
  font-size: 8px;
  margin: 3px 0;
}

/* --------------------------------------------------
   FOOTER
-------------------------------------------------- */

.footer-note {
  font-size: 7px;
  line-height: 1.35;
  margin-top: 8px;
  padding: 5px 2px 0;
  border-top: 2px solid #167F91;
  color: #333;
}

.copyright {
  text-align: center;
  font-size: 7px;
  margin: 5px 0;
  color: #333;
}

/* --------------------------------------------------
   SCREEN AND PRINT
-------------------------------------------------- */

@media screen {
  body {
    max-width: 210mm;
    margin: 0 auto;
    padding: 5mm;
    box-shadow: 0 0 5px #ddd;
  }
}

@media print {
  html,
  body {
    width: 100%;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }

  .section-title,
  .subheading {
    break-after: avoid;
  }

  .data-table thead,
  .summary-table thead {
    display: table-header-group;
  }

  .account-record {
    break-inside: auto;
  }

  .account-columns,
  .account-column-headings {
    break-inside: avoid;
  }
}
</style>
</head>

<body>
${renderHeader(data)}
${renderPersonalInformation(data)}
${renderCreditScore(data)}
${renderIdentifiers(data)}
${renderPhones(data)}
${renderEmails(data)}
${renderAddresses(data)}
${renderEmployment(data)}
${renderSummary(data)}
${renderAccounts(data)}
${renderEnquiries(data)}

<div class="footer-note">
  All information contained in this credit report has been collated by
  TransUnion CIBIL Limited (TU CIBIL) based on information provided /
  submitted by its various members (“Members”), as part of periodic data
  submission. Members are required to ensure accuracy, completeness and
  veracity of the information submitted. The use of this report is governed
  by the terms and conditions applicable to TU CIBIL and its Members.
</div>

<div class="copyright">
  © TransUnion CIBIL Limited. All rights reserved.
</div>

</body>
</html>`;

module.exports = { generateCibilPdf };
