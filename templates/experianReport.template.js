// templates/experianReport.template.js

const escapeHtml = (value) => {
  if (value === null || value === undefined) {
    return "";
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

  // YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    return `${str.substring(6, 8)}-${str.substring(
      4,
      6,
    )}-${str.substring(0, 4)}`;
  }

  // YYYY-MM-DD
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

  if (Number.isNaN(number)) {
    return escapeHtml(value);
  }

  return `₹ ${number.toLocaleString("en-IN")}`;
};

const getScoreClass = (score) => {
  const num = Number(score);

  if (Number.isNaN(num)) return "score-neutral";
  if (num >= 750) return "score-excellent";
  if (num >= 700) return "score-good";
  if (num >= 650) return "score-average";

  return "score-low";
};

const getScoreLabel = (score) => {
  const num = Number(score);

  if (Number.isNaN(num)) return "Not Available";
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
    value.includes("sub-standard") ||
    value.includes("doubtful") ||
    value.includes("loss")
  ) {
    return "status-danger";
  }

  return "status-warning";
};

/**
 * Convert month value into 1-12
 */
const getMonthNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const str = String(value).trim().toLowerCase();

  const monthMap = {
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

  if (monthMap[str]) {
    return monthMap[str];
  }

  const number = Number(str);

  if (number >= 1 && number <= 12) {
    return number;
  }

  return null;
};

const getMonthShortName = (month) => {
  const months = [
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
  ];

  return months[month - 1] || "-";
};

/**
 * Create horizontal payment history
 *
 * Output:
 *
 * Year | Jan | Feb | Mar | Apr | ... | Dec
 * 2025 | 0   | 0   | 30  | 0   | ... | 0
 */
const renderHorizontalPaymentHistory = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }

  // Group history by year
  const groupedByYear = {};

  history.forEach((item) => {
    const year = item?.Year || item?.year || item?.YEAR || "-";

    const monthValue = item?.Month ?? item?.month ?? item?.MONTH;

    const monthNumber = getMonthNumber(monthValue);

    if (!groupedByYear[year]) {
      groupedByYear[year] = {};
    }

    if (monthNumber) {
      groupedByYear[year][monthNumber] = item;
    }
  });

  // Latest year first
  const years = Object.keys(groupedByYear).sort((a, b) => {
    const yearA = Number(a);
    const yearB = Number(b);

    if (!Number.isNaN(yearA) && !Number.isNaN(yearB)) {
      return yearB - yearA;
    }

    return String(b).localeCompare(String(a));
  });

  if (!years.length) {
    return `
      <div class="empty">
        Payment history data is not available.
      </div>
    `;
  }

  return `
    <div class="sub-heading">
      Payment History
    </div>

    <div class="history-wrapper">

      <table class="history-table">

        <thead>
          <tr>

            <th class="history-year-column">
              Year
            </th>

            ${Array.from({ length: 12 }, (_, index) => {
              const month = index + 1;

              return `
                <th class="history-month-column">
                  ${getMonthShortName(month)}
                </th>
              `;
            }).join("")}

          </tr>
        </thead>

        <tbody>

          ${years
            .map((year) => {
              const yearData = groupedByYear[year];

              return `
                <tr>

                  <td class="history-year">
                    ${escapeHtml(year)}
                  </td>

                  ${Array.from({ length: 12 }, (_, index) => {
                    const month = index + 1;
                    const item = yearData[month];

                    // No data for this month
                    if (!item) {
                      return `
                        <td class="history-cell history-empty">
                          -
                        </td>
                      `;
                    }

                    let dpd =
                      item?.Days_Past_Due ??
                      item?.daysPastDue ??
                      item?.DaysPastDue ??
                      "-";

                    // Convert ?, empty value, null etc. to "-"
                    if (
                      dpd === "?" ||
                      dpd === "" ||
                      dpd === null ||
                      dpd === undefined
                    ) {
                      dpd = "-";
                    }

                    const hasDpd =
                      dpd !== "-" &&
                      !Number.isNaN(Number(dpd)) &&
                      Number(dpd) > 0;

                    return `
                      <td
                        class="
                          history-cell
                          ${hasDpd ? "history-overdue" : ""}
                        "
                      >

                        <div
                          class="
                            history-dpd
                            ${
                              hasDpd
                                ? "history-dpd-danger"
                                : "history-dpd-normal"
                            }
                          "
                        >
                          ${escapeHtml(dpd)}
                        </div>

                      </td>
                    `;
                  }).join("")}

                </tr>
              `;
            })
            .join("")}

        </tbody>

      </table>

    </div>

    <div class="history-legend">

      <span>
        <strong>DPD</strong> = Days Past Due
      </span>

    </div>
  `;
};

const experianReportTemplate = (result) => {
  const score = result?.SCORE?.FCIREXScore ?? "-";

  const scoreConfidence = result?.SCORE?.FCIREXScoreConfidLevel ?? "-";

  const exactMatch = result?.Match_result?.Exact_match ?? "-";

  const profile = result?.CreditProfileHeader || {};

  const cais = result?.CAIS_Account || {};

  const caisSummary = cais?.CAIS_Summary || {};

  const creditAccount = caisSummary?.Credit_Account || {};

  const outstanding = caisSummary?.Total_Outstanding_Balance || {};

  const accounts = Array.isArray(cais?.CAIS_Account_DETAILS)
    ? cais.CAIS_Account_DETAILS
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
          // Founder rule: show only City / State / PIN — never street lines.
          const addressParts = [
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

          const fullAddress = addressParts.join(", ");

          return [
            fullAddress,
            {
              ...address,
              fullAddress,
            },
          ];
        })
        .filter(([key]) => key),
    ).values(),
  );

  const caps = result?.CAPS || {};

  const capsSummary = caps?.CAPS_Summary || {};

  const capsApplications = Array.isArray(caps?.CAPS_Application_Details)
    ? caps.CAPS_Application_Details
    : [];

  const currentApplication = result?.Current_Application || {};

  const scoreClass = getScoreClass(score);

  const scoreLabel = getScoreLabel(score);

  const totalAccounts = creditAccount.CreditAccountTotal ?? 0;

  const activeAccounts = creditAccount.CreditAccountActive ?? 0;

  const closedAccounts = creditAccount.CreditAccountClosed ?? 0;

  const defaultAccounts = creditAccount.CreditAccountDefault ?? 0;

  return `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8" />

<title>
  Experian Credit Report
</title>

<style>

/* =========================================================
   PAGE
========================================================= */

@page {
  size: A4;
  margin: 12mm 10mm 16mm 10mm;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  font-family:
    Arial,
    Helvetica,
    sans-serif;

  color: #172033;

  background: #ffffff;

  font-size: 10px;

  line-height: 1.45;
}

.page {
  width: 100%;
}


/* =========================================================
   HEADER
========================================================= */

.header {
  background:
    linear-gradient(
      135deg,
      #0B2947 0%,
      #123B66 55%,
      #1976D2 100%
    );

  color: white;

  padding: 20px 22px;

  border-radius: 12px;

  margin-bottom: 18px;

  position: relative;

  overflow: hidden;
}

.header::after {
  content: "";

  position: absolute;

  width: 180px;
  height: 180px;

  border-radius: 50%;

  right: -70px;
  top: -80px;

  background:
    rgba(255,255,255,0.08);
}

.header-top {
  display: flex;

  justify-content: space-between;

  align-items: flex-start;
}

.brand {
  font-size: 23px;

  font-weight: 800;

  letter-spacing: 0.3px;
}

.brand span {
  color: #8FD3FF;
}

.report-type {
  margin-top: 5px;

  font-size: 10px;

  color: #D7E9F8;

  letter-spacing: 0.6px;

  text-transform: uppercase;
}

.header-badge {
  background:
    rgba(255,255,255,0.13);

  border:
    1px solid
    rgba(255,255,255,0.25);

  padding: 7px 11px;

  border-radius: 20px;

  font-size: 9px;

  font-weight: bold;

  text-transform: uppercase;

  letter-spacing: 0.5px;
}

.header-bottom {
  margin-top: 18px;

  padding-top: 12px;

  border-top:
    1px solid
    rgba(255,255,255,0.18);

  display: flex;

  justify-content: space-between;
}

.header-meta {
  font-size: 9px;

  color: #D7E9F8;
}

.header-meta strong {
  color: white;
}


/* =========================================================
   SCORE CARD
========================================================= */

.score-card {
  border-radius: 14px;

  padding: 18px;

  margin-bottom: 18px;

  background:
    linear-gradient(
      135deg,
      #F8FBFF,
      #EDF6FF
    );

  border:
    1px solid
    #D6E9FA;

  position: relative;

  overflow: hidden;
}

.score-card::before {
  content: "";

  position: absolute;

  width: 130px;
  height: 130px;

  right: -35px;
  top: -35px;

  border-radius: 50%;

  background:
    rgba(25,118,210,0.06);
}

.score-layout {
  display: flex;

  align-items: center;

  justify-content: space-between;
}

.score-left {
  width: 35%;

  text-align: center;
}

.score-circle {
  width: 108px;
  height: 108px;

  border-radius: 50%;

  margin: 0 auto;

  display: flex;

  flex-direction: column;

  justify-content: center;

  align-items: center;

  background: white;

  border:
    7px solid
    #1976D2;

  box-shadow:
    0 5px 18px
    rgba(18,59,102,0.12);
}

.score-number {
  font-size: 30px;

  line-height: 1;

  font-weight: 800;

  color: #123B66;
}

.score-small {
  font-size: 8px;

  color: #64748B;

  margin-top: 5px;

  text-transform: uppercase;

  letter-spacing: 0.4px;
}

.score-right {
  width: 60%;
}

.score-title {
  font-size: 10px;

  color: #64748B;

  text-transform: uppercase;

  letter-spacing: 0.8px;

  font-weight: bold;
}

.score-status {
  font-size: 21px;

  font-weight: 800;

  color: #123B66;

  margin: 4px 0 7px;
}

.score-description {
  color: #64748B;

  font-size: 9px;

  line-height: 1.6;

  margin-bottom: 10px;
}

.score-info {
  display: flex;

  gap: 8px;
}

.score-info-item {
  background: white;

  border:
    1px solid
    #E0EAF4;

  border-radius: 7px;

  padding: 7px 9px;

  flex: 1;
}

.score-info-label {
  color: #94A3B8;
  font-size: 7px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.score-info-value {
  color: #172033;
  font-size: 9px;
  font-weight: 800;
  margin-top: 3px;
  line-height: 1.4;
}


/* =========================================================
   SCORE COLORS
========================================================= */

.score-excellent .score-circle {
  border-color: #16A34A;
}

.score-excellent .score-number {
  color: #15803D;
}

.score-good .score-circle {
  border-color: #1976D2;
}

.score-good .score-number {
  color: #1976D2;
}

.score-average .score-circle {
  border-color: #F59E0B;
}

.score-average .score-number {
  color: #D97706;
}

.score-low .score-circle {
  border-color: #DC2626;
}

.score-low .score-number {
  color: #DC2626;
}

.score-neutral .score-circle {
  border-color: #94A3B8;
}

.score-neutral .score-number {
  color: #64748B;
}


/* =========================================================
   SECTION
========================================================= */

.section {
  margin-top: 18px;

  page-break-inside: avoid;
}

.section-title {
  display: flex;

  align-items: center;

  gap: 8px;

  font-size: 13px;

  font-weight: 800;

  color: #123B66;

  padding-bottom: 7px;

  margin-bottom: 10px;

  border-bottom:
    2px solid
    #E8EEF5;
}

.section-title::before {
  content: "";

  width: 4px;

  height: 17px;

  border-radius: 4px;

  background: #1976D2;
}


/* =========================================================
   GRID
========================================================= */

.grid {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 8px;
}

.grid-4 {
  display: grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap: 8px;
}

.card {
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 11px 12px;
  box-shadow: none;
}

 .label {
  color: #94A3B8;
  font-size: 7.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  line-height: 1.3;
}

.value {
  color: #172033;
  font-size: 10px;
  font-weight: 800;
  margin-top: 4px;
  line-height: 1.4;
  word-break: break-word;
}


/* =========================================================
   METRIC CARDS
========================================================= */

.metric-card {
  background: white;

  border:
    1px solid
    #E2E8F0;

  border-radius: 10px;

  padding: 11px;

  position: relative;

  overflow: hidden;
}

.metric-card::after {
  content: "";

  position: absolute;

  right: -15px;
  bottom: -15px;

  width: 55px;
  height: 55px;

  border-radius: 50%;

  background: #F1F5F9;
}

.metric-label {
  font-size: 7.5px;
  color: #94A3B8;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 700;
  line-height: 1.3;
}

.metric-number {
  font-size: 20px;
  font-weight: 800;
  color: #172033;
  margin-top: 5px;
  line-height: 1.2;
}


/* =========================================================
   STATUS BADGES
========================================================= */

.badge {
  display: inline-block;

  padding: 3px 7px;

  border-radius: 20px;

  font-size: 7.5px;

  font-weight: bold;

  white-space: nowrap;
}

.status-success {
  color: #15803D;

  background: #ECFDF3;
}

.status-warning {
  color: #B45309;

  background: #FFF7E6;
}

.status-danger {
  color: #B91C1C;

  background: #FEF2F2;
}

.status-neutral {
  color: #475569;

  background: #F1F5F9;
}


/* =========================================================
   NORMAL TABLES
========================================================= */

.table-wrapper {
  border:
    1px solid
    #E2E8F0;

  border-radius: 9px;

  overflow: hidden;

  margin-top: 8px;
}

table {
  width: 100%;

  border-collapse: collapse;

  margin: 0;
}

thead {
  background: #F1F6FB;
}

 

th {
  color: #94A3B8;
  font-size: 7.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 8px;
  border-bottom: 1px solid #DCE5EF;
  text-align: left;
}

td {
  color: #172033;
  font-size: 8.5px;
  font-weight: 700;
  padding: 7px 8px;
  border-bottom: 1px solid #EEF2F7;
  vertical-align: top;
}

tbody tr:nth-child(even) {
  background: #FAFCFE;
}

tbody tr:last-child td {
  border-bottom: none;
}


/* =========================================================
   ACCOUNT
========================================================= */

.account {
  margin-bottom: 15px;

  page-break-inside: avoid;

  border:
    1px solid
    #DDE6EF;

  border-radius: 10px;

  overflow: hidden;

  background: white;
}

.account-header {
  background:
    linear-gradient(
      90deg,
      #F1F7FD,
      #FAFCFF
    );

  padding: 10px 12px;

  display: flex;

  justify-content: space-between;

  align-items: center;

  border-bottom:
    1px solid
    #E1EAF2;
}

.account-title {
  color: #123B66;

  font-size: 10.5px;

  font-weight: 800;
}

.account-number {
  color: #475569;
  font-size: 8px;
  font-weight: 700;
  margin-top: 3px;
}

.account-body {
  padding: 10px;
}

.account-grid {
  display: grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap: 7px;

  margin-bottom: 8px;
}
 
.account-field {
  padding: 7px 8px;
  background: #FFFFFF;
  border-radius: 6px;
  border: 1px solid #E8EDF3;
}

.account-field-label {
  color: #94A3B8;
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 700;
  line-height: 1.3;
}

.account-field-value {
  color: #172033;
  font-size: 9px;
  font-weight: 800;
  margin-top: 4px;
  line-height: 1.4;
  word-break: break-word;
}


/* =========================================================
   SUB HEADING
========================================================= */

.sub-heading {
  color: #334155;

  font-size: 9px;

  font-weight: 800;

  margin: 11px 0 6px;

  display: flex;

  align-items: center;

  gap: 5px;
}

.sub-heading::before {
  content: "";

  width: 5px;
  height: 5px;

  border-radius: 50%;

  background: #1976D2;
}


/* =========================================================
   HORIZONTAL PAYMENT HISTORY
========================================================= */

.history-wrapper {
  width: 100%;

  overflow: hidden;

  border:
    1px solid
    #DDE6EF;

  border-radius: 8px;

  margin-top: 7px;
}

.history-table {
  width: 100%;

  table-layout: fixed;

  border-collapse: collapse;
}

.history-table th {
  text-align: center;

  font-size: 7px;

  padding: 6px 2px;

  color: #475569;

  background: #EDF4FA;

  border-right:
    1px solid
    #DCE5EF;
}

.history-table td {
  text-align: center;

  padding: 5px 2px;

  font-size: 7px;

  border-right:
    1px solid
    #EEF2F7;

  border-bottom:
    1px solid
    #EEF2F7;

  vertical-align: middle;
}

.history-table th:last-child,
.history-table td:last-child {
  border-right: none;
}

.history-year-column {
  width: 8%;
}

.history-month-column {
  width: 7.66%;
}

.history-year {
  font-weight: 800;

  color: #123B66;

  background: #F5F9FD;

  font-size: 7.5px !important;
}

.history-cell {
  min-height: 30px;

  background: white;
}

.history-empty {
  color: #CBD5E1;

  background: #FAFCFE;
}

.history-overdue {
  background: #FFF8F8;
}

.history-dpd {
  font-size: 7.5px;

  font-weight: 800;

  line-height: 1.1;
}

.history-dpd-normal {
  color: #15803D;
}

.history-dpd-danger {
  color: #DC2626;
}

.history-status {
  display: inline-block;

  margin-top: 2px;

  padding: 1px 3px;

  border-radius: 3px;

  font-size: 5.5px;

  line-height: 1.2;

  max-width: 100%;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;
}

.history-legend {
  display: flex;

  justify-content: flex-end;

  gap: 12px;

  color: #94A3B8;

  font-size: 6.5px;

  margin-top: 4px;
}


/* =========================================================
   EMPTY STATE
========================================================= */

.empty {
  padding: 14px;

  text-align: center;

  color: #94A3B8;

  background: #F8FAFC;

  border:
    1px dashed
    #CBD5E1;

  border-radius: 8px;

  font-size: 9px;
}


/* =========================================================
   FOOTER
========================================================= */

.footer {
  margin-top: 22px;

  padding: 12px 0 0;

  border-top:
    1px solid
    #E2E8F0;

  display: flex;

  justify-content: space-between;

  color: #94A3B8;

  font-size: 7.5px;

  line-height: 1.5;
}

.footer-left {
  width: 75%;
}

.footer-right {
  text-align: right;

  font-weight: bold;

  color: #64748B;
}


/* =========================================================
   GENERATED FROM Experian
========================================================= */

.generated-from {
  color: #123B66;

  font-size: 8px;

  font-weight: 700;

  margin-bottom: 4px;
}

.generated-from strong {
  color: #1976D2;
}

.footer-description {
  color: #94A3B8;

  font-size: 7.5px;

  line-height: 1.5;
}


/* =========================================================
   PAGE BREAK
========================================================= */

.no-break {
  page-break-inside: avoid;
}

.page-break {
  page-break-before: always;
}

</style>

</head>


<body>

<div class="page">


<!-- ======================================================
     HEADER
====================================================== -->

<div class="header">

  <div class="header-top">

    <div>

      <div class="brand">
        <span>Experian</span>
      </div>

      <div class="report-type">
        Experian Credit Information Report
      </div>

    </div>

    <div class="header-badge">
      EXPERIAN
    </div>

  </div>


  <div class="header-bottom">

    <div class="header-meta">
      Report No:
      <strong>
        ${escapeHtml(profile.ReportNumber || "-")}
      </strong>
    </div>

    <div class="header-meta">
      Report Date:
      <strong>
        ${formatDate(profile.ReportDate)}
      </strong>
    </div>

    <div class="header-meta">
      Version:
      <strong>
        ${escapeHtml(profile.Version || "-")}
      </strong>
    </div>

  </div>

</div>


<!-- ======================================================
     SCORE
====================================================== -->

<div class="score-card ${scoreClass}">

  <div class="score-layout">

    <div class="score-left">

      <div class="score-circle">

        <div class="score-number">
          ${escapeHtml(score)}
        </div>

        <div class="score-small">
          Credit Score
        </div>

      </div>

    </div>


    <div class="score-right">

      <div class="score-title">
        Experian Credit Score
      </div>

      <div class="score-status">
        ${escapeHtml(scoreLabel)}
      </div>

      <div class="score-description">
        Your Experian credit score represents your
        creditworthiness based on the information
        available in your credit profile.
      </div>


      <div class="score-info">

        <div class="score-info-item">

          <div class="score-info-label">
            Confidence Level
          </div>

          <div class="score-info-value">
            ${escapeHtml(scoreConfidence)}
          </div>

        </div>


        <div class="score-info-item">

          <div class="score-info-label">
            Exact Match
          </div>

          <div class="score-info-value">
            ${escapeHtml(exactMatch)}
          </div>

        </div>

      </div>

    </div>

  </div>

</div>
<!-- ======================================================
     CURRENT APPLICATION
====================================================== -->

<div class="section">

  <div class="section-title">
    Current Application
  </div>


  <div class="grid">


    <div class="card">

      <div class="label">
        Applicant Name
      </div>

      <div class="value">

        ${escapeHtml(
          currentApplication?.Current_Application_Details
            ?.Current_Applicant_Details?.First_Name || "",
        )}

        ${escapeHtml(
          currentApplication?.Current_Application_Details
            ?.Current_Applicant_Details?.Last_Name || "",
        )}

      </div>

    </div>


    <div class="card">

      <div class="label">
        PAN
      </div>

      <div class="value">

        ${escapeHtml(
          currentApplication?.Current_Application_Details
            ?.Current_Applicant_Details?.IncomeTaxPan || "-",
        )}

      </div>

    </div>


    <div class="card">

      <div class="label">
        Mobile
      </div>

      <div class="value">

        ${escapeHtml(
          currentApplication?.Current_Application_Details
            ?.Current_Applicant_Details?.MobilePhoneNumber || "-",
        )}

      </div>

    </div>


    <div class="card">

      <div class="label">
        Enquiry Reason
      </div>

      <div class="value">

        ${escapeHtml(
          currentApplication?.Current_Application_Details
            ?.enquiryReasonDescription || "-",
        )}

      </div>

    </div>

  </div>

</div>

<!-- ======================================================
     REPORT DETAILS
====================================================== -->

<div class="section">

  <div class="section-title">
    Report Details
  </div>

  <div class="grid">

    <div class="card">

      <div class="label">
        Report Number
      </div>

      <div class="value">
        ${escapeHtml(profile.ReportNumber || "-")}
      </div>

    </div>


    <div class="card">

      <div class="label">
        Report Date
      </div>

      <div class="value">
        ${formatDate(profile.ReportDate)}
      </div>

    </div>


    <div class="card">

      <div class="label">
        Report Time
      </div>

      <div class="value">
        ${escapeHtml(profile.ReportTime || "-")}
      </div>

    </div>


    <div class="card">

      <div class="label">
        Report Version
      </div>

      <div class="value">
        ${escapeHtml(profile.Version || "-")}
      </div>

    </div>

 

  </div>

</div>


<!-- ======================================================
     CREDIT ACCOUNT SUMMARY
====================================================== -->

<div class="section">

  <div class="section-title">
    Credit Account Summary
  </div>

  <div class="grid-4">

    <div class="metric-card">

      <div class="metric-label">
        Total Accounts
      </div>

      <div class="metric-number">
        ${totalAccounts}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Active Accounts
      </div>

      <div class="metric-number">
        ${activeAccounts}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Closed Accounts
      </div>

      <div class="metric-number">
        ${closedAccounts}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Default Accounts
      </div>

      <div
        class="metric-number"
        style="${
          Number(defaultAccounts) > 0 ? "color:#DC2626;" : "color:#16A34A;"
        }"
      >
        ${defaultAccounts}
      </div>

    </div>

  </div>

</div>


<!-- ======================================================
     OUTSTANDING BALANCE
====================================================== -->

<div class="section">

  <div class="section-title">
    Outstanding Balance
  </div>


  <div class="grid">

    <div class="card">

      <div class="label">
        Secured Outstanding
      </div>

      <div class="value">
        ${formatAmount(outstanding.Outstanding_Balance_Secured)}
      </div>

    </div>


    <div class="card">

      <div class="label">
        Unsecured Outstanding
      </div>

      <div class="value">
        ${formatAmount(outstanding.Outstanding_Balance_UnSecured)}
      </div>

    </div>


    <div
      class="card"
      style="
        grid-column: 1 / -1;
        background:#F1F7FD;
        border-color:#D7E8F7;
      "
    >

      <div class="label">
        Total Outstanding Balance
      </div>

      <div
        class="value"
        style="
          font-size:16px;
          color:#123B66;
        "
      >
        ${formatAmount(outstanding.Outstanding_Balance_All)}
      </div>

    </div>

  </div>

</div>


<!-- ======================================================
     CREDIT ACCOUNTS
====================================================== -->

<div class="section">

  <div class="section-title">
    Credit Accounts
  </div>


  ${
    accounts.length
      ? accounts
          .map((account, index) => {
            const status = account.accountStatusDescription || "-";

            const statusClass = getStatusClass(status);

            const history = Array.isArray(account.CAIS_Account_History)
              ? account.CAIS_Account_History
              : [];

            return `

<div class="account">


  <!-- ACCOUNT HEADER -->

  <div class="account-header">

    <div>

      <div class="account-title">
        Account ${index + 1} -
        ${escapeHtml(account.Subscriber_Name || "Unknown Institution")}
      </div>

      <div class="account-number">
        Account No:
        ${escapeHtml(account.Account_Number || "-")}
      </div>

    </div>


    <div>

      <span class="badge ${statusClass}">
        ${escapeHtml(status)}
      </span>

    </div>

  </div>


  <!-- ACCOUNT BODY -->

  <div class="account-body">


    <!-- ACCOUNT INFORMATION -->

    <div class="account-grid">


      <div class="account-field">

        <div class="account-field-label">
          Account Type
        </div>

        <div class="account-field-value">
          ${escapeHtml(account.accountTypeDescription || "-")}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Portfolio Type
        </div>

        <div class="account-field-value">
          ${escapeHtml(account.portfolioTypeDescription || "-")}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Open Date
        </div>

        <div class="account-field-value">
          ${formatDate(account.Open_Date)}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Closed Date
        </div>

        <div class="account-field-value">
          ${formatDate(account.Date_Closed)}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Original Loan Amount
        </div>

        <div class="account-field-value">
          ${formatAmount(account.Highest_Credit_or_Original_Loan_Amount)}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Current Balance
        </div>

        <div class="account-field-value">
          ${formatAmount(account.Current_Balance)}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Amount Past Due
        </div>

        <div
          class="account-field-value"
          style="${
            Number(account.Amount_Past_Due) > 0
              ? "color:#DC2626;"
              : "color:#16A34A;"
          }"
        >
          ${formatAmount(account.Amount_Past_Due)}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Rate of Interest
        </div>

        <div class="account-field-value">
          ${escapeHtml(account.Rate_of_Interest || "-")}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Repayment Tenure
        </div>

        <div class="account-field-value">
          ${escapeHtml(account.Repayment_Tenure || "-")}
        </div>

      </div>


      <div class="account-field">

        <div class="account-field-label">
          Currency
        </div>

        <div class="account-field-value">
          ${escapeHtml(account.CurrencyCode || "-")}
        </div>

      </div>

    </div>


    <!-- =================================================
         HORIZONTAL PAYMENT HISTORY
    ================================================== -->

    ${history.length ? renderHorizontalPaymentHistory(history) : ""}

  </div>

</div>

`;
          })
          .join("")
      : `
<div class="empty">
  No credit accounts found.
</div>
`
  }

</div>


<!-- ======================================================
     CREDIT ENQUIRIES
====================================================== -->

<div class="section">

  <div class="section-title">
    Credit Enquiries
  </div>


  <div class="grid-4">


    <div class="metric-card">

      <div class="metric-label">
        Last 7 Days
      </div>

      <div class="metric-number">
        ${capsSummary.CAPSLast7Days ?? 0}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Last 30 Days
      </div>

      <div class="metric-number">
        ${capsSummary.CAPSLast30Days ?? 0}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Last 90 Days
      </div>

      <div class="metric-number">
        ${capsSummary.CAPSLast90Days ?? 0}
      </div>

    </div>


    <div class="metric-card">

      <div class="metric-label">
        Last 180 Days
      </div>

      <div class="metric-number">
        ${capsSummary.CAPSLast180Days ?? 0}
      </div>

    </div>

  </div>


  ${
    capsApplications.length
      ? `

<div class="table-wrapper">

<table>

<thead>

<tr>

<th>
  Subscriber
</th>

<th>
  Date
</th>

<th>
  Reason
</th>

<th>
  Amount Financed
</th>

</tr>

</thead>


<tbody>

${capsApplications
  .map(
    (item) => `

<tr>

<td>
  ${escapeHtml(item.Subscriber_Name || "-")}
</td>

<td>
  ${formatDate(item.Date_of_Request)}
</td>

<td>
  ${escapeHtml(item.enquiryReasonDescription || "-")}
</td>

<td>
  ${formatAmount(item.Amount_Financed)}
</td>

</tr>

`,
  )
  .join("")}

</tbody>

</table>

</div>

`
      : `

<div class="empty">
  No credit enquiries found.
</div>

`
  }

</div>

<!-- ======================================================
     HOLDER ADDRESSES
====================================================== -->

<div class="section">

  <div class="section-title">
    Holder Addresses
  </div>

  ${
    holderAddresses.length
      ? `
        <div style="
          width:100%;
          border:1px solid #d9dee7;
          border-radius:6px;
          overflow:hidden;
          margin-top:10px;
        ">

          ${holderAddresses
            .map(
              (address, index) => `
                <div style="
                  width:100%;
                  border-bottom:${
                    index === holderAddresses.length - 1
                      ? "none"
                      : "1px solid #e1e5eb"
                  };
                  padding:12px 14px;
                  box-sizing:border-box;
                ">

                  <!-- Address Row -->
                  <div style="
                    display:flex;
                    width:100%;
                    align-items:flex-start;
                  ">

                    <!-- Sr No -->
                    <div style="
                      width:45px;
                      min-width:45px;
                      font-size:10px;
                      color:#666;
                      font-weight:600;
                    ">
                      ${index + 1}
                    </div>

                    <!-- City -->
                    <div style="
                      flex:1;
                      padding-right:15px;
                    ">

                    <div style="
  font-size:7.5px;
  color:#94A3B8;
  text-transform:uppercase;
  margin-bottom:4px;
  font-weight:700;
  letter-spacing:0.4px;
">
  City
</div>

                      <div style="
  font-size:10px;
  color:#172033;
  line-height:1.4;
  font-weight:800;
  word-break:break-word;
">
                        ${escapeHtml(address?.City_non_normalized ?? "-")}
                      </div>

                    </div>

                    <!-- PIN -->
                    <div style="
                      width:80px;
                      min-width:80px;
                      padding-left:10px;
                    ">

                      <div style="
  font-size:10px;
  color:#172033;
  line-height:1.4;
  font-weight:800;
  word-break:break-word;
">
                        PIN Code
                      </div>

                      <div style="
                        font-size:11px;
                        color:#222;
                        font-weight:500;
                      ">
                        ${escapeHtml(
                          address?.ZIP_Postal_Code_non_normalized ?? "-",
                        )}
                      </div>

                    </div>

                    <!-- State -->
                    <div style="
                      width:90px;
                      min-width:90px;
                      padding-left:10px;
                    ">
<div style="
  font-size:10px;
  color:#172033;
  line-height:1.4;
  font-weight:800;
  word-break:break-word;
">
                        State
                      </div>

                      <div style="
                        font-size:11px;
                        color:#222;
                        font-weight:500;
                      ">
                        ${escapeHtml(address?.State_non_normalized ?? "-")}
                      </div>

                    </div>

                    <!-- Country -->
                    <div style="
                      width:70px;
                      min-width:70px;
                      padding-left:10px;
                    ">

                    <div style="
  font-size:10px;
  color:#172033;
  line-height:1.4;
  font-weight:800;
  word-break:break-word;
">
                        Country
                      </div>

                      <div style="
                        font-size:11px;
                        color:#222;
                        font-weight:500;
                      ">
                        ${escapeHtml(
                          address?.CountryCode_non_normalized || "-",
                        )}
                      </div>

                    </div>

                    <!-- Indicator -->
                    <div style="
                      width:80px;
                      min-width:80px;
                      padding-left:10px;
                    ">

                      <div style="
  font-size:10px;
  color:#172033;
  line-height:1.4;
  font-weight:800;
  word-break:break-word;
">
                        Indicator
                      </div>

                      <div style="
                        font-size:11px;
                        color:#222;
                        font-weight:500;
                      ">
                        ${escapeHtml(
                          address?.Address_indicator_non_normalized ?? "-",
                        )}
                      </div>

                    </div>

                  </div>

                </div>
              `,
            )
            .join("")}

        </div>
      `
      : `
        <div class="empty">
          No address details found.
        </div>
      `
  }

</div>


<!-- ======================================================
     FOOTER
====================================================== -->

<div class="footer">

  <div class="footer-left">

    <div class="generated-from">
      Generated from <strong>Experian</strong>
    </div>

    <div class="footer-description">
      This report has been generated from the Experian
      credit information response received through an
      authorized API. This document is intended for
      informational purposes and should be handled
      securely.
    </div>

  </div>


  <div class="footer-right">

    <strong>Experian</strong><br />

    Experian Credit Report

  </div>

</div>


</div>

</body>

</html>
`;
};

module.exports = experianReportTemplate;
