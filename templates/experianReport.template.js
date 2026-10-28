// templates/experianReport.template.js

const escapeHtml = (value) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const formatDate = (value) => {
  if (!value) return "-";

  const str = String(value);

  if (/^\d{8}$/.test(str)) {
    return `${str.slice(6, 8)}-${str.slice(4, 6)}-${str.slice(0, 4)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split("-");
    return `${day}-${month}-${year}`;
  }

  return escapeHtml(str);
};

const formatAmount = (value) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? `₹ ${number.toLocaleString("en-IN")}`
    : escapeHtml(value);
};

const getScoreLabel = (score) => {
  const num = Number(score);

  if (!Number.isFinite(num)) return "Not Available";
  if (num >= 750) return "Excellent";
  if (num >= 700) return "Good";
  if (num >= 650) return "Fair";

  return "Needs Attention";
};

const getStatusClass = (status) => {
  const value = String(status || "").toLowerCase();

  if (
    value.includes("active") ||
    value.includes("current") ||
    value.includes("regular") ||
    value.includes("standard") ||
    value === "000"
  ) {
    return "status-success";
  }

  if (value.includes("closed") || value.includes("paid") || value === "0") {
    return "status-neutral";
  }

  if (
    value.includes("default") ||
    value.includes("overdue") ||
    value.includes("written") ||
    value.includes("settled") ||
    value.includes("doubtful") ||
    value.includes("loss")
  ) {
    return "status-danger";
  }

  return "status-warning";
};

const getMonthNumber = (value) => {
  if (value === null || value === undefined) return null;

  const str = String(value).trim().toLowerCase();

  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  if (months[str]) return months[str];

  const number = Number(str);

  return number >= 1 && number <= 12 ? number : null;
};

const getMonthShortName = (month) =>
  [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][month - 1] || "-";

const renderHorizontalPaymentHistory = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }

  const grouped = {};

  history.forEach((item) => {
    const year = item?.Year || item?.year || item?.YEAR || "-";

    const month = getMonthNumber(item?.Month ?? item?.month ?? item?.MONTH);

    if (!grouped[year]) grouped[year] = {};

    if (month) grouped[year][month] = item;
  });

  const years = Object.keys(grouped).sort((a, b) => Number(b) - Number(a));

  return `
    <div class="sub-heading">Payment History</div>

    <div class="table-wrapper">
      <table class="history-table">
        <thead>
          <tr>
            <th>Year</th>
            ${Array.from(
              { length: 12 },
              (_, i) => `<th>${getMonthShortName(i + 1)}</th>`,
            ).join("")}
          </tr>
        </thead>

        <tbody>
          ${years
            .map(
              (year) => `
            <tr>
              <td>${escapeHtml(year)}</td>

              ${Array.from({ length: 12 }, (_, i) => {
                const item = grouped[year][i + 1];

                if (!item) return "<td>-</td>";

                let dpd =
                  item?.Days_Past_Due ??
                  item?.daysPastDue ??
                  item?.DaysPastDue ??
                  "-";

                if (
                  dpd === "?" ||
                  dpd === "" ||
                  dpd === null ||
                  dpd === undefined
                ) {
                  dpd = "-";
                }

                const overdue =
                  dpd !== "-" &&
                  Number.isFinite(Number(dpd)) &&
                  Number(dpd) > 0;

                return `
                  <td class="${overdue ? "overdue" : ""}">
                    ${escapeHtml(dpd)}
                  </td>
                `;
              }).join("")}
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="history-legend">
      DPD = Days Past Due
    </div>
  `;
};

const experianReportTemplate = (result) => {
  const score = result?.SCORE?.FCIREXScore ?? "-";

  const profile = result?.CreditProfileHeader || {};

  const currentApplication = result?.Current_Application || {};

  const applicant =
    currentApplication?.Current_Application_Details
      ?.Current_Applicant_Details || {};

  const cais = result?.CAIS_Account || {};

  const caisSummary = cais?.CAIS_Summary || {};

  const creditAccount = caisSummary?.Credit_Account || {};

  const outstanding = caisSummary?.Total_Outstanding_Balance || {};

  const accounts = Array.isArray(cais?.CAIS_Account_DETAILS)
    ? cais.CAIS_Account_DETAILS
    : [];

  const caps = result?.CAPS || {};

  const capsSummary = caps?.CAPS_Summary || {};

  const capsApplications = Array.isArray(caps?.CAPS_Application_Details)
    ? caps.CAPS_Application_Details
    : [];

  const holderAddresses = Array.from(
    new Map(
      accounts
        .flatMap((account) =>
          Array.isArray(account?.CAIS_Holder_Address_Details)
            ? account.CAIS_Holder_Address_Details
            : [],
        )
        .map((address) => {
          const parts = [
            address?.City_non_normalized,
            address?.State_non_normalized,
            address?.ZIP_Postal_Code_non_normalized,
          ]
            .filter(
              (value) =>
                value !== null &&
                value !== undefined &&
                String(value).trim() !== "",
            )
            .map((value) => String(value).trim());

          const key = parts.join(", ");

          return [key, { ...address, fullAddress: key }];
        })
        .filter(([key]) => key),
    ).values(),
  );

  const totalAccounts = creditAccount.CreditAccountTotal ?? 0;
  const activeAccounts = creditAccount.CreditAccountActive ?? 0;
  const closedAccounts = creditAccount.CreditAccountClosed ?? 0;
  const defaultAccounts = creditAccount.CreditAccountDefault ?? 0;

  const fullName = [applicant?.First_Name, applicant?.Last_Name]
    .filter(Boolean)
    .join(" ");

  const scoreFactors = [
    ["Recency", "Recent Credit Account Defaults"],
    ["Leverage", "Credit Accounts with on-time re-payment history"],
    ["Coverage", "Non-delinquent and delinquent Credit Accounts"],
    ["Delinquency Status", "Defaults on Credit Accounts"],
    ["Credit Applications", "Credit Account Applications over last 30 days"],
  ];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Experian Credit Report</title>

<style>
@page {
  size: A4;
  margin: 8mm;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10px;
  line-height: 1.4;
  color: #111;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 100%;
}

/* HEADER */

.header {
  margin-bottom: 15px;
  padding: 5px 0 12px;
  background: #fff;
  color: #222;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.brand {
  color: #244c91;
  font-size: 34px;
  font-weight: 400;
  letter-spacing: -1.5px;
  white-space: nowrap;
}

.header-right {
  flex: 1;
  text-align: right;
}

.report-heading {
  color: #2876d2;
  font-size: 28px;
  font-weight: bold;
  line-height: 1.15;
  margin-bottom: 2px;
}

.header-meta {
  font-size: 12px;
  line-height: 1.3;
  color: #2876d2;
}

.header-meta strong {
  color: #333;
  font-weight: 400;
  overflow-wrap: anywhere;
}

/* SECTION TITLES */

.section {
  margin-top: 14px;
}

.section-title {
  position: relative;
  background: #ebebeb;
  color: #000;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 15px;
  font-weight: bold;
  padding: 5px 8px 7px 29px;
  margin-bottom: 10px;
  border: 0;
  border-bottom: 4px solid #d7d7d7;
}

.section-title::before {
  content: "✓";
  position: absolute;
  left: 8px;
  top: 4px;
  color: #16a34a;
  font-family: Arial, sans-serif;
  font-size: 14px;
}

/* APPLICATION DETAILS */

.application-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 12px;
  padding: 8px 10px;
}

.application-field {
  min-width: 0;
  overflow-wrap: anywhere;
}

.application-label {
  color: #2876d2;
  font-size: 10px;
}

.application-value {
  color: #111;
  font-size: 10px;
}

/* SCORE */


.score-intro {
  color: #f28c00;
  font-size: 10px;
  margin: 14px 10px;
}

.score-layout {
  display: grid;
  grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);
  column-gap: 25px;
  row-gap: 10px;
  align-items: center;
  padding: 4px 10px;
  box-sizing: border-box;
  width: 100%;
}

.score-left {
  min-width: 0;
  padding-top: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.score-right {
  border: 1px solid #ddd;
  padding: 12px 18px;
  min-width: 0;
  box-sizing: border-box;
}

.gauge-row {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-top: 12px;
  padding-right: 45px;
}

.score-gauge {
  position: relative;
  width: 100%;
  max-width: 205px;
  height: 100px;
  flex-shrink: 0;
  border-radius: 205px 205px 0 0;
  background: conic-gradient(
    from 270deg at 50% 100%,
    #ff0000 0deg 54deg,
    #ffa500 54deg 90deg,
    #ffff00 90deg 123deg,
    #90ee90 123deg 180deg,
    transparent 180deg 360deg
  );
}

.score-gauge::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #fff;
}

.gauge-value {
  position: absolute;
  left: calc(100% + 12px);
  bottom: 30px;
  color: #000;
  font-size: 28px;
  font-weight: bold;
  white-space: nowrap;
}

.gauge-range {
  width: 100%;
  max-width: 205px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  box-sizing: border-box;
}

.score-factors-title {
  color: #2876d2;
  font-size: 15px;
  font-weight: bold;
  margin: 0 0 5px;
}

.factor {
  font-size: 10px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

/* Responsive layout */
@media (max-width: 600px) {
  .score-layout {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 20px;
  }

  .score-left {
    padding-bottom: 5px;
  }

  .score-right {
    width: 100%;
  }

  .gauge-row {
    padding-right: 45px;
  }
}


/* SUMMARY */

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 10px;
}

.summary-heading {
  color: #2876d2;
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 7px;
  overflow-wrap: anywhere;
}

.summary-item {
  margin: 2px 0;
  font-size: 10px;
  overflow-wrap: anywhere;
}

.summary-item span {
  color: #2876d2;
}

/* COMMON TABLES */

.table-wrapper {
  width: 100%;
  overflow: hidden;
  margin-top: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

th {
  background: #ebebeb;
  color: #2876d2;
  font-weight: bold;
  text-align: left;
  padding: 6px 5px;
  border: 1px solid #ddd;
}

td {
  padding: 5px;
  border: 1px solid #ddd;
  vertical-align: top;
  overflow-wrap: anywhere;
}

tr {
  page-break-inside: avoid;
}

.history-table {
  font-size: 7px;
  table-layout: fixed;
}

.history-table th,
.history-table td {
  text-align: center;
  padding: 3px 1px;
}

.history-table th:first-child,
.history-table td:first-child {
  width: 34px;
  font-weight: bold;
}

.overdue {
  color: #dc2626;
  font-weight: bold;
  background: #fff0f0;
}

.history-legend {
  text-align: right;
  color: #64748b;
  font-size: 8px;
  margin-top: 4px;
}

.sub-heading {
  font-weight: bold;
  color: #2876d2;
  margin: 10px 0 5px;
}

/* ACCOUNT CARDS */

.account {
  margin: 10px 0;
  border: 1px solid #ddd;
  page-break-inside: avoid;
}

.account-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
  background: #eee;
  padding: 8px;
}

.account-title {
  font-size: 11px;
  font-weight: bold;
  overflow-wrap: anywhere;
}

.account-number {
  font-size: 9px;
  margin-top: 3px;
}

.badge {
  display: inline-block;
  padding: 3px 6px;
  font-size: 8px;
  font-weight: bold;
  border-radius: 2px;
}

.status-success {
  color: #15803d;
  background: #ecfdf3;
}

.status-neutral {
  color: #475569;
  background: #f1f5f9;
}

.status-danger {
  color: #dc2626;
  background: #fef2f2;
}

.status-warning {
  color: #b45309;
  background: #fffbeb;
}

.account-body {
  padding: 8px;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.account-field {
  min-width: 0;
  overflow-wrap: anywhere;
}

.account-field-label {
  color: #2876d2;
  font-size: 9px;
}

.account-field-value {
  font-size: 10px;
  font-weight: 600;
}

/* ADDRESSES */

.address-row {
  display: grid;
  grid-template-columns: 30px 1fr 75px 90px;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #ddd;
  overflow-wrap: anywhere;
}

.address-label {
  color: #2876d2;
  font-size: 8px;
  font-weight: bold;
  text-transform: uppercase;
}

.address-value {
  font-size: 10px;
}

/* EMPTY STATE AND FOOTER */

.empty {
  padding: 12px;
  text-align: center;
  color: #64748b;
  border: 1px dashed #cbd5e1;
  margin-top: 6px;
}

.footer {
  margin-top: 20px;
  padding-top: 8px;
  border-top: 1px solid #ddd;
  color: #64748b;
  font-size: 8px;
  page-break-inside: avoid;
}

.no-break {
  page-break-inside: avoid;
}

@media print {
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
</head>

<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-top">
      <div class="brand">experian</div>

      <div class="header-right">
        <div class="report-heading">Experian Credit Report</div>

        <div class="header-meta">
          Report Date:
          <strong>${escapeHtml(profile.ReportDate || "-")}</strong>
        </div>

        <div class="header-meta">
          Report Time:
          <strong>${escapeHtml(profile.ReportTime || "-")}</strong>
        </div>

        <div class="header-meta">
          Report Number:
          <strong>${escapeHtml(profile.ReportNumber || "-")}</strong>
        </div>
      </div>
    </div>
  </div>

  <!-- CURRENT APPLICATION -->
  <div class="section">
    <div class="section-title">CURRENT APPLICATION INFORMATION</div>

    <div class="application-grid">
      <div class="application-field">
        <span class="application-label">Name - </span>
        <span class="application-value">${escapeHtml(fullName)}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Date of Birth - </span>
        <span class="application-value">${escapeHtml(applicant?.DateOfBirth || applicant?.Date_of_Birth || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Ration Card - </span>
        <span class="application-value">${escapeHtml(applicant?.RationCard || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Mobile Phone - </span>
        <span class="application-value">${escapeHtml(applicant?.MobilePhoneNumber || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">PAN - </span>
        <span class="application-value">${escapeHtml(applicant?.IncomeTaxPan || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Driving License - </span>
        <span class="application-value">${escapeHtml(applicant?.DriverLicenseNumber || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Passport Number - </span>
        <span class="application-value">${escapeHtml(applicant?.PassportNumber || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Voter ID - </span>
        <span class="application-value">${escapeHtml(applicant?.VoterID || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Aadhaar Number - </span>
        <span class="application-value">${escapeHtml(applicant?.AadhaarNumber || "-")}</span>
      </div>

      <div class="application-field">
        <span class="application-label">Email - </span>
        <span class="application-value">${escapeHtml(applicant?.EmailAddress || "-")}</span>
      </div>
    </div>
  </div>

  <!-- CREDIT SCORE -->
  <div class="section">
    <div class="section-title">EXPERIAN CREDIT SCORE</div>

    <div class="score-intro">
      Your Experian Credit Report is summarized in the form of
      Experian Credit Score which ranges from 300 - 900.
    </div>

    <div class="score-layout">
      <div class="score-left">
        <div class="gauge-row">
          <div class="score-gauge">
            <div class="gauge-value">${escapeHtml(score)}</div>
          </div>
        </div>

        <div class="gauge-range">
          <span>300</span>
          <span>900</span>
        </div>
      </div>

      <div class="score-right">
        <div class="score-factors-title">Score Factors</div>

        ${scoreFactors
          .map(
            ([title, description], index) => `
          <div class="factor">
            <strong>${index + 1}. ${escapeHtml(title)}:</strong>
            ${escapeHtml(description)}
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  </div>

  <!-- REPORT SUMMARY -->
  <div class="section">
    <div class="section-title">REPORT SUMMARY</div>

    <div class="summary-grid">
      <div>
        <div class="summary-heading">Credit Account Summary</div>
        <div class="summary-item"><span>Total number of Accounts - </span>${totalAccounts}</div>
        <div class="summary-item"><span>Active Accounts - </span>${activeAccounts}</div>
        <div class="summary-item"><span>Closed Accounts - </span>${closedAccounts}</div>
        <div class="summary-item"><span>Default Accounts - </span>${defaultAccounts}</div>
      </div>

      <div>
        <div class="summary-heading">Current Balance Amount Summary</div>
        <div class="summary-item"><span>Total Current Balance - </span>${formatAmount(outstanding.Outstanding_Balance_All)}</div>
        <div class="summary-item"><span>Secured Balance - </span>${formatAmount(outstanding.Outstanding_Balance_Secured)}</div>
        <div class="summary-item"><span>Unsecured Balance - </span>${formatAmount(outstanding.Outstanding_Balance_UnSecured)}</div>
      </div>

      <div>
        <div class="summary-heading">Credit Enquiry Summary</div>
        <div class="summary-item"><span>Last 7 days - </span>${capsSummary.CAPSLast7Days ?? 0}</div>
        <div class="summary-item"><span>Last 30 days - </span>${capsSummary.CAPSLast30Days ?? 0}</div>
        <div class="summary-item"><span>Last 90 days - </span>${capsSummary.CAPSLast90Days ?? 0}</div>
        <div class="summary-item"><span>Last 180 days - </span>${capsSummary.CAPSLast180Days ?? 0}</div>
      </div>

      <div>
        <div class="summary-heading">Non-Credit Enquiry Summary</div>
        <div class="summary-item"><span>Last 7 days - </span>${capsSummary.NonCreditCAPSLast7Days ?? 0}</div>
        <div class="summary-item"><span>Last 30 days - </span>${capsSummary.NonCreditCAPSLast30Days ?? 0}</div>
        <div class="summary-item"><span>Last 90 days - </span>${capsSummary.NonCreditCAPSLast90Days ?? 0}</div>
      </div>
    </div>
  </div>

  <!-- CREDIT ACCOUNTS -->
  <div class="section">
    <div class="section-title">CREDIT ACCOUNTS</div>

    ${
      accounts.length
        ? accounts
            .map((account, index) => {
              const status = account.accountStatusDescription || "-";

              const history = Array.isArray(account.CAIS_Account_History)
                ? account.CAIS_Account_History
                : [];

              return `
              <div class="account">
                <div class="account-header">
                  <div>
                    <div class="account-title">
                      Account ${index + 1} -
                      ${escapeHtml(account.Subscriber_Name || "Unknown Institution")}
                    </div>

                    <div class="account-number">
                      Account No: ${escapeHtml(account.Account_Number || "-")}
                    </div>
                  </div>

                  <span class="badge ${getStatusClass(status)}">
                    ${escapeHtml(status)}
                  </span>
                </div>

                <div class="account-body">
                  <div class="account-grid">
                    <div class="account-field">
                      <div class="account-field-label">Account Type</div>
                      <div class="account-field-value">${escapeHtml(account.accountTypeDescription || "-")}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Portfolio Type</div>
                      <div class="account-field-value">${escapeHtml(account.portfolioTypeDescription || "-")}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Open Date</div>
                      <div class="account-field-value">${formatDate(account.Open_Date)}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Closed Date</div>
                      <div class="account-field-value">${formatDate(account.Date_Closed)}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Original Loan Amount</div>
                      <div class="account-field-value">${formatAmount(account.Highest_Credit_or_Original_Loan_Amount)}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Current Balance</div>
                      <div class="account-field-value">${formatAmount(account.Current_Balance)}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Amount Past Due</div>
                      <div class="account-field-value">${formatAmount(account.Amount_Past_Due)}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Rate of Interest</div>
                      <div class="account-field-value">${escapeHtml(account.Rate_of_Interest || "-")}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Repayment Tenure</div>
                      <div class="account-field-value">${escapeHtml(account.Repayment_Tenure || "-")}</div>
                    </div>

                    <div class="account-field">
                      <div class="account-field-label">Currency</div>
                      <div class="account-field-value">${escapeHtml(account.CurrencyCode || "-")}</div>
                    </div>
                  </div>

                  ${renderHorizontalPaymentHistory(history)}
                </div>
              </div>
            `;
            })
            .join("")
        : '<div class="empty">No credit accounts found.</div>'
    }
  </div>

  <!-- CREDIT ENQUIRIES -->
  <div class="section">
    <div class="section-title">CREDIT ENQUIRIES</div>

    ${
      capsApplications.length
        ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th>Date</th>
                  <th>Reason</th>
                  <th>Amount Financed</th>
                </tr>
              </thead>

              <tbody>
                ${capsApplications
                  .map(
                    (item) => `
                  <tr>
                    <td>${escapeHtml(item.Subscriber_Name || "-")}</td>
                    <td>${formatDate(item.Date_of_Request)}</td>
                    <td>${escapeHtml(item.enquiryReasonDescription || "-")}</td>
                    <td>${formatAmount(item.Amount_Financed)}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : '<div class="empty">No credit enquiries found.</div>'
    }
  </div>

  <!-- HOLDER ADDRESSES -->
  <div class="section">
    <div class="section-title">HOLDER ADDRESSES</div>

    ${
      holderAddresses.length
        ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Sr. No.</th>
                  <th>City</th>
                  <th>State</th>
                  <th>PIN Code</th>
                </tr>
              </thead>

              <tbody>
                ${holderAddresses
                  .map(
                    (address, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(address.City_non_normalized || "-")}</td>
                    <td>${escapeHtml(address.State_non_normalized || "-")}</td>
                    <td>${escapeHtml(address.ZIP_Postal_Code_non_normalized || "-")}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : '<div class="empty">No address details found.</div>'
    }
  </div>

  <!-- FOOTER -->
  <div class="footer">
    Generated from Experian credit information response.
    This document contains confidential financial information.
    Handle and store it securely.
  </div>

</div>
</body>
</html>
`;
};

module.exports = experianReportTemplate;
