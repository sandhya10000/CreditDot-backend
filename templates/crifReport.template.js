// ============================================================
// CRIF HIGH MARK CREDIT REPORT PDF TEMPLATE
// File: templates/crifReport.template.js
// ============================================================

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const generateCrifPdf = async (apiData, creditReportId) => {
  // ----------------------------------------------------------
  // FIND CRIF B2C REPORT
  // ----------------------------------------------------------
  const findB2CReport = (root, visited = new WeakSet()) => {
    if (!root || typeof root !== "object") return null;
    if (visited.has(root)) return null;

    visited.add(root);

    if (root["B2C-REPORT"] && typeof root["B2C-REPORT"] === "object") {
      return root["B2C-REPORT"];
    }

    for (const child of Object.values(root)) {
      if (child && typeof child === "object") {
        const found = findB2CReport(child, visited);
        if (found) return found;
      }
    }

    return null;
  };

  // Support both the complete API response and an already-extracted report.
  const report =
    findB2CReport(apiData) ||
    (apiData &&
    typeof apiData === "object" &&
    (apiData.HEADER ||
      apiData.REQUEST ||
      apiData["PERSONAL-INFO"] ||
      apiData.RESPONSES ||
      apiData["ACCOUNTS-SUMMARY"])
      ? apiData
      : null);

  if (!report) {
    console.error("[CRIF PDF] Input keys:", Object.keys(apiData || {}));

    throw new Error(
      "CRIF B2C-REPORT data not found. Input is neither a complete response nor a recognized report object.",
    );
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------
  const getValue = (obj, ...keys) => {
    if (!obj || typeof obj !== "object") return null;

    for (const key of keys) {
      const value = obj[key];

      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return null;
  };

  const getObject = (obj, ...keys) => {
    const value = getValue(obj, ...keys);

    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  };

  const arr = (value) => {
    if (value === undefined || value === null || value === "") {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  };

  const firstItem = (value) => {
    if (Array.isArray(value)) return value[0] || {};
    return value && typeof value === "object" ? value : {};
  };

  const esc = (value, fallback = "-") => {
    if (value === undefined || value === null || value === "") {
      value = fallback;
    }

    if (typeof value === "object") {
      value =
        getValue(value, "VALUE", "TEXT", "NAME", "DESCRIPTION", "ID") ??
        fallback;
    }

    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const getPathValue = (obj, pathParts) => {
    return pathParts.split(".").reduce((current, key) => {
      if (current === null || current === undefined) return undefined;

      return current[key];
    }, obj);
  };

  const firstAvailable = (...values) => {
    return (
      values.find(
        (value) => value !== undefined && value !== null && value !== "",
      ) ?? null
    );
  };

  const fmtNum = (value) => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "0";
    }

    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2,
    }).format(Number(value));
  };

  const fmtDate = (value) => {
    if (!value || value === "-") return "-";

    const input = String(value).trim();

    let match = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);

    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }

    match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }

    match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }

    const date = new Date(input);

    if (Number.isNaN(date.getTime())) {
      return input;
    }

    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      date.getFullYear(),
    ].join("-");
  };

  const maskAddress = (rawAddress) => {
    if (!rawAddress) return "-";

    const value = String(rawAddress).trim();

    if (!value || value === "-") return "-";

    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.length > 3 ? parts.slice(-3).join(", ") : parts.join(", ");
  };

  const getText = (obj, ...keys) => {
    const value = getValue(obj, ...keys);

    if (value === null) return "-";

    if (typeof value === "object") {
      return esc(value);
    }

    return String(value);
  };

  const getNumber = (obj, ...keys) => {
    const value = getValue(obj, ...keys);
    const number = Number(value);

    return value === null || value === "" || !Number.isFinite(number)
      ? 0
      : number;
  };

  const sum = (...values) =>
    values.reduce((total, value) => {
      const number = Number(value);

      return total + (Number.isFinite(number) ? number : 0);
    }, 0);

  // ----------------------------------------------------------
  // REPORT SECTIONS
  // ----------------------------------------------------------
  const header = getObject(report, "HEADER");
  const request = getObject(report, "REQUEST");

  const personal = getObject(report, "PERSONAL-INFO", "PERSONAL-INFORMATION");

  const contact = getObject(report, "CONTACT-DETAILS", "CONTACT-INFORMATION");

  const summary = getObject(report, "ACCOUNTS-SUMMARY");

  const primary = getObject(summary, "PRIMARY-ACCOUNTS-SUMMARY");

  const secondary = getObject(summary, "SECONDARY-ACCOUNTS-SUMMARY");

  const derived = getObject(summary, "DERIVED-ATTRIBUTES");

  const employment = getObject(report, "EMPLOYMENT-DETAILS", "EMPLOYMENT");

  const enquiryRoot = getObject(
    report,
    "ENQUIRY-HISTORY",
    "ENQUIRIES",
    "INQUIRY-HISTORY",
  );

  const variationRoot = getObject(
    report,
    "PERSONAL-INFO-VARIATION",
    "PERSONAL-INFORMATION-VARIATION",
  );

  // ----------------------------------------------------------
  // VARIATION LISTS
  // ----------------------------------------------------------
  const pickList = (source, keys) => {
    let raw = getValue(source, ...keys);

    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      const nested = getValue(
        raw,
        "VARIATION",
        "ITEM",
        "VALUE",
        "ADDRESS",
        "NAME",
        "PHONE",
        "EMAIL",
        "ID",
      );

      if (nested !== null) raw = nested;
    }

    return arr(raw)
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return {
            value: item,
            date: null,
          };
        }

        return {
          value: getValue(
            item,
            "VALUE",
            "TEXT",
            "ADDRESS",
            "NAME",
            "DOB",
            "DATE-OF-BIRTH",
            "PHONE",
            "PHONE-NUMBER",
            "MOBILE",
            "EMAIL",
            "EMAIL-ID",
            "ID",
            "PAN",
          ),
          date: getValue(
            item,
            "REPORTED-DATE",
            "REPORTED-ON",
            "DATE",
            "DATE-REPORTED",
          ),
        };
      })
      .filter(
        (item) =>
          item.value !== null && item.value !== undefined && item.value !== "",
      );
  };

  const nameVariations = pickList(variationRoot, [
    "NAME-VARIATIONS",
    "NAME-VARIATION",
  ]);

  const dobVariations = pickList(variationRoot, [
    "DOB-VARIATIONS",
    "DOB-VARIATION",
    "DATE-OF-BIRTH-VARIATIONS",
  ]);

  const addressVariations = pickList(variationRoot, [
    "ADDRESS-VARIATIONS",
    "ADDRESS-VARIATION",
  ]);

  const phoneVariations = pickList(variationRoot, [
    "PHONE-VARIATIONS",
    "PHONE-VARIATION",
    "MOBILE-VARIATIONS",
  ]);

  const emailVariations = pickList(variationRoot, [
    "EMAIL-VARIATIONS",
    "EMAIL-VARIATION",
  ]);

  const idVariations = pickList(variationRoot, [
    "ID-VARIATIONS",
    "ID-VARIATION",
    "PAN-VARIATIONS",
    "PAN-VARIATION",
  ]);

  // Also support variation fields supplied directly on the report.
  if (!idVariations.length) {
    idVariations.push(
      ...pickList(report, ["PAN-VARIATIONS", "PAN-VARIATION", "ID-VARIATIONS"]),
    );
  }

  // ----------------------------------------------------------
  // APPLICANT DETAILS
  // ----------------------------------------------------------
  const name = firstAvailable(
    getValue(request, "NAME", "FULL-NAME", "APPLICANT-NAME"),
    getValue(personal, "NAME", "FULL-NAME", "APPLICANT-NAME"),
    getValue(apiData, "name", "applicantName"),
  );

  const dob = firstAvailable(
    getValue(request, "DOB", "DATE-OF-BIRTH"),
    getValue(personal, "DOB", "DATE-OF-BIRTH"),
  );

  const pan = firstAvailable(
    getValue(request, "PAN", "PAN-NUMBER", "ID-NUMBER"),
    getValue(personal, "PAN", "PAN-NUMBER", "ID-NUMBER"),
  );

  const gender = firstAvailable(
    getValue(request, "GENDER", "SEX"),
    getValue(personal, "GENDER", "SEX"),
  );

  const mobile = firstAvailable(
    getValue(
      request,
      "PHONE-1",
      "MOBILE",
      "MOBILE-NUMBER",
      "PHONE",
      "PHONE-NUMBER",
    ),
    getValue(
      contact,
      "PHONE-1",
      "MOBILE",
      "MOBILE-NUMBER",
      "PHONE",
      "PHONE-NUMBER",
    ),
  );

  const email = firstAvailable(
    getValue(request, "EMAIL-1", "EMAIL", "EMAIL-ID", "EMAIL-ADDRESS"),
    getValue(contact, "EMAIL-1", "EMAIL", "EMAIL-ID", "EMAIL-ADDRESS"),
  );

  const address = firstAvailable(
    getValue(request, "ADDRESS-1", "ADDRESS", "CURRENT-ADDRESS"),
    getValue(contact, "ADDRESS-1", "ADDRESS", "CURRENT-ADDRESS"),
    getValue(personal, "ADDRESS-1", "ADDRESS", "CURRENT-ADDRESS"),
    addressVariations[0]?.value,
  );

  const reportNumber = firstAvailable(
    getValue(
      header,
      "REPORT-ID",
      "REPORT_NUMBER",
      "REPORT-NUMBER",
      "CHM-REF-NO",
      "REFERENCE-NUMBER",
    ),
    getValue(report, "REPORT-ID", "REPORT-NUMBER"),
    creditReportId,
  );

  const reportDate = fmtDate(
    firstAvailable(
      getValue(header, "DATE-OF-ISSUE"),
      getValue(header, "DATE-OF-REQUEST"),
      getValue(header, "DATE-OF-REPORT"),
      getValue(header, "REPORT-DATE"),
    ),
  );

  // ----------------------------------------------------------
  // CREDIT SCORE
  // ----------------------------------------------------------
  const scoreCandidates = [
    apiData?.data?.score,
    apiData?.score,
    report?.["CREDIT-SCORE"],
    report?.SCORE,
    report?.["SCORE-VALUE"],
    report?.SCORES?.SCORE?.["SCORE-VALUE"],
    report?.SCORES?.SCORE?.["SCORE"],
    report?.["SCORE-DETAILS"]?.["SCORE-VALUE"],
    report?.["CREDIT-SCORE-DETAILS"]?.["SCORE-VALUE"],
  ];

  const scoreRaw = scoreCandidates.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      Number.isFinite(Number(value)),
  );

  const score = scoreRaw === undefined ? null : Number(scoreRaw);

  const scoreStatus =
    score === null
      ? "Not Available"
      : score >= 750
        ? "Excellent"
        : score >= 700
          ? "Good"
          : score >= 650
            ? "Fair"
            : "Needs Improvement";

  const scoreDescription =
    score === null
      ? "Credit score information is not available in the supplied API response."
      : score >= 750
        ? "The reported score falls in a higher score band."
        : score >= 700
          ? "The reported score falls in a good score band."
          : score >= 650
            ? "The reported score falls in a moderate score band."
            : "Review the credit report details to understand the reported score.";

  const scoreName = firstAvailable(
    getValue(report, "SCORE-NAME"),
    getValue(getObject(report, "SCORE-DETAILS"), "SCORE-NAME"),
    "CRIF High Mark Score",
  );

  // ----------------------------------------------------------
  // ACCOUNT COLLECTION
  // ----------------------------------------------------------
  const responseRoot = getObject(report, "RESPONSES");

  let accounts = arr(getValue(responseRoot, "RESPONSE", "RESPONSES", "ITEM"));

  // Support a single account object directly on the report.
  if (!accounts.length && getValue(report, "LOAN-DETAILS")) {
    accounts = [report];
  }

  const getLoan = (item) => {
    const loan = firstAvailable(
      item?.["LOAN-DETAILS"],
      item?.["LOAN-DETAIL"],
      item?.LOAN_DETAIL,
      item?.ACCOUNT,
      item,
    );

    return loan && typeof loan === "object" ? loan : {};
  };

  const accountLoans = accounts.map(getLoan);

  const totalAccounts = firstAvailable(
    sum(
      getNumber(primary, "PRIMARY-NUMBER-OF-ACCOUNTS"),
      getNumber(secondary, "SECONDARY-NUMBER-OF-ACCOUNTS"),
    ) || null,
    accountLoans.length,
  );

  const activeAccounts = sum(
    getNumber(primary, "PRIMARY-ACTIVE-NUMBER-OF-ACCOUNTS"),
    getNumber(secondary, "SECONDARY-ACTIVE-NUMBER-OF-ACCOUNTS"),
  );

  const overdueAccounts = sum(
    getNumber(primary, "PRIMARY-OVERDUE-NUMBER-OF-ACCOUNTS"),
    getNumber(secondary, "SECONDARY-OVERDUE-NUMBER-OF-ACCOUNTS"),
  );

  const securedAccounts = sum(
    getNumber(primary, "PRIMARY-SECURED-NUMBER-OF-ACCOUNTS"),
    getNumber(secondary, "SECONDARY-SECURED-NUMBER-OF-ACCOUNTS"),
  );

  const unsecuredAccounts = sum(
    getNumber(primary, "PRIMARY-UNSECURED-NUMBER-OF-ACCOUNTS"),
    getNumber(secondary, "SECONDARY-UNSECURED-NUMBER-OF-ACCOUNTS"),
  );

  const currentBalance = sum(
    getNumber(primary, "PRIMARY-CURRENT-BALANCE"),
    getNumber(secondary, "SECONDARY-CURRENT-BALANCE"),
  );

  const disbursedAmount = sum(
    getNumber(primary, "PRIMARY-DISBURSED-AMOUNT"),
    getNumber(secondary, "SECONDARY-DISBURSED-AMOUNT"),
  );

  const enquiries6 = firstAvailable(
    getValue(
      derived,
      "INQURIES-IN-LAST-SIX-MONTHS",
      "INQUIRIES-IN-LAST-SIX-MONTHS",
    ),
    "-",
  );

  const enquiries24 = firstAvailable(
    getValue(
      enquiryRoot,
      "NUMBER-OF-ENQUIRIES",
      "TOTAL-ENQUIRIES",
      "INQUIRIES-IN-LAST-24-MONTHS",
    ),
    getValue(
      derived,
      "INQUIRIES-IN-LAST-TWENTY-FOUR-MONTHS",
      "INQUIRIES-IN-LAST-24-MONTHS",
    ),
    "-",
  );

  const newAccounts6 = firstAvailable(
    getValue(derived, "NEW-ACCOUNTS-IN-LAST-SIX-MONTHS"),
    "-",
  );

  const newDelinquent6 = firstAvailable(
    getValue(derived, "NEW-DELINQUENT-ACCOUNTS-IN-LAST-SIX-MONTHS"),
    "-",
  );

  // ----------------------------------------------------------
  // PAYMENT HISTORY
  // ----------------------------------------------------------

  const normalizeHistory = (raw) => {
    if (!raw) return [];

    // Handles array-based payment history
    if (Array.isArray(raw)) {
      return raw
        .map((item) => ({
          month: getValue(item, "MONTH", "MONTH-NAME") || "",
          year: String(getValue(item, "YEAR") || ""),

          amount:
            String(getValue(item, "AMOUNT", "DAYS-PAST-DUE", "DPD") || "-")
              .replace(/XXX/gi, "")
              .replace(/\s+/g, " ")
              .trim() || "-",

          status: String(
            getValue(item, "STATUS", "ASSET-CLASSIFICATION") || "-",
          )
            .trim()
            .toUpperCase(),
        }))
        .filter((item) => item.month && item.year);
    }

    // Handles string-based payment history
    const text = String(raw)
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/X\s*X\s*X/gi, "XXX")
      .replace(/S\s*TD/gi, "STD")
      .replace(/S\s*UB/gi, "SUB")
      .replace(/D\s*BT/gi, "DBT")
      .replace(/L\s*OS/gi, "LOS")
      .replace(/S\s*MA/gi, "SMA");

    const regex =
      /([A-Za-z]{3})\s*:\s*(\d{4})\s*,\s*([^/|]+?)\s*\/\s*([A-Za-z0-9-]+)(?=\s*(?:\||[A-Za-z]{3}\s*:|$))/gi;

    const output = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      output.push({
        month: match[1],
        year: match[2],

        amount: match[3].replace(/XXX/gi, "").trim() || "-",

        status: match[4].trim().toUpperCase(),
      });
    }

    return output;
  };

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthMap = {
    Jan: "January",
    Feb: "February",
    Mar: "March",
    Apr: "April",
    May: "May",
    Jun: "June",
    Jul: "July",
    Aug: "August",
    Sep: "September",
    Oct: "October",
    Nov: "November",
    Dec: "December",
  };

  const paymentHtml = (raw) => {
    const history = normalizeHistory(raw);

    if (!history.length) {
      return `
      <div class="muted">
        Payment history is not available in the supplied response.
      </div>
    `;
    }

    const years = {};

    history.forEach((item) => {
      const monthKey = String(item.month || "")
        .slice(0, 3)
        .toLowerCase();

      const month = {
        jan: "January",
        feb: "February",
        mar: "March",
        apr: "April",
        may: "May",
        jun: "June",
        jul: "July",
        aug: "August",
        sep: "September",
        oct: "October",
        nov: "November",
        dec: "December",
      }[monthKey];

      if (!month || !item.year) return;

      if (!years[item.year]) years[item.year] = {};

      years[item.year][month] = {
        amount:
          String(item.amount || "-")
            .replace(/\bXXX\b/gi, "")
            .trim() || "-",
        status: String(item.status || "-")
          .trim()
          .toUpperCase(),
      };
    });

    return `
    <div class="table-wrap payment-history-wrap">
      <table class="payment-table">
        <thead>
          <tr>
            <th class="year-col">Year</th>
            ${months.map((month) => `<th>${esc(month)}</th>`).join("")}
          </tr>
        </thead>

        <tbody>
          ${Object.keys(years)
            .sort((a, b) => Number(b) - Number(a))
            .map(
              (year) => `
                <tr>
                  <th class="year-cell">${esc(year)}</th>

                  ${months
                    .map((month) => {
                      const item = years[year][month];

                      if (!item) {
                        return `<td class="empty-cell">-</td>`;
                      }

                      const status = item.status;
                      const className =
                        status === "STD"
                          ? "std"
                          : /(SUB|DBT|LOS|LSS|SMA|DA|DPD)/.test(status)
                            ? "alert"
                            : "";

                      const amount =
                        String(item.amount ?? "-")
                          .replace(/XXX/gi, "")
                          .trim() || "-";

                      return `
                        <td class="${className}">
                          <span class="payment-value">
  ${esc(amount)}
</span>
                        </td>
                      `;
                    })
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  };

  // ----------------------------------------------------------
  // REUSABLE HTML COMPONENTS
  // ----------------------------------------------------------
  const infoCard = (label, value, wide = false) => `
    <div class="info-card ${wide ? "wide" : ""}">
      <div class="label">${esc(label)}</div>
      <div class="value">${esc(value)}</div>
    </div>
  `;

  const variationTable = (items, heading, addressMode = false) => `
    <div class="variation-block">
      <div class="subheading">${esc(heading)}</div>

      ${
        items.length
          ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>${addressMode ? "City / State / PIN" : "Value"}</th>
                  <th>Reported On</th>
                </tr>
              </thead>

              <tbody>
                ${items
                  .map(
                    (item) => `
                  <tr>
                    <td>
                      ${esc(addressMode ? maskAddress(item.value) : item.value)}
                    </td>
                    <td>${esc(fmtDate(item.date))}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : `
            <div class="muted">
              No ${esc(heading.toLowerCase())} available in the response.
            </div>
          `
      }
    </div>
  `;

  // ----------------------------------------------------------
  // ACCOUNT INFORMATION HTML
  // ----------------------------------------------------------
  const accountsHtml = accountLoans.length
    ? accountLoans
        .map((loan, index) => {
          const type =
            getValue(
              loan,
              "ACCT-TYPE",
              "ACCOUNT-TYPE",
              "ACCOUNT-TYPE-DESCRIPTION",
            ) || "Credit Account";

          const status =
            getValue(
              loan,
              "ACCOUNT-STATUS",
              "STATUS",
              "ACCOUNT-STATUS-DESCRIPTION",
            ) || "-";

          const grantor =
            getValue(
              loan,
              "CREDIT-GUARANTOR",
              "CREDIT-GRANTOR",
              "LENDER-NAME",
              "MEMBER-NAME",
            ) || "-";

          const fields = [
            ["Credit Grantor", grantor],
            [
              "Account Number",
              getValue(loan, "ACCT-NUMBER", "ACCOUNT-NUMBER") || "-",
            ],
            ["Ownership", getValue(loan, "OWNERSHIP-IND", "OWNERSHIP") || "-"],
            [
              "Date Reported",
              fmtDate(getValue(loan, "DATE-REPORTED", "INFO-AS-OF")),
            ],
            [
              "Disbursed Date",
              fmtDate(getValue(loan, "DISBURSED-DT", "DISBURSED-DATE")),
            ],
            [
              "Disbursed Amount / High Credit",
              `₹ ${fmtNum(getValue(loan, "DISBURSED-AMT", "DISBURSED-AMOUNT"))}`,
            ],
            ["Credit Limit", `₹ ${fmtNum(getValue(loan, "CREDIT-LIMIT"))}`],
            ["Cash Limit", `₹ ${fmtNum(getValue(loan, "CASH-LIMIT"))}`],
            ["Last Payment Date", fmtDate(getValue(loan, "LAST-PAYMENT-DATE"))],
            [
              "Closed Date",
              fmtDate(getValue(loan, "CLOSED-DATE", "CLOSED-DT")),
            ],
            [
              "Current Balance",
              `₹ ${fmtNum(getValue(loan, "CURRENT-BAL", "CURRENT-BALANCE"))}`,
            ],
            [
              "Overdue Amount",
              `₹ ${fmtNum(getValue(loan, "OVERDUE-AMT", "OVERDUE-AMOUNT"))}`,
            ],
            [
              "Installment / Frequency",
              getValue(
                loan,
                "INSTLAMT-FREQ",
                "INSTL-AMT-FREQ",
                "INSTALLMENT-AMOUNT",
              ) || "-",
            ],
            ["Tenure", getValue(loan, "TENURE", "TENURE-MONTH") || "-"],
            [
              "Last Paid Amount",
              `₹ ${fmtNum(getValue(loan, "LAST-PAID-AMT", "LAST-PAID-AMOUNT"))}`,
            ],
          ];

          const history = getValue(
            loan,
            "COMBINED-PAYMENT-HISTORY",
            "COMBINED_PAYMENT_HISTORY",
            "PAYMENT-HISTORY",
            "PAYMENT_HISTORY",
          );

          return `
          <article class="account-card">
            <div class="account-heading">
              <div class="account-heading-main">
                <span class="account-index">${index + 1}</span>

                <div class="account-title-wrap">
                  <strong class="account-title">
                    ${esc(type)}
                  </strong>

                  <span class="grantor">
                    Credit Grantor: ${esc(grantor)}
                  </span>
                </div>
              </div>

              <span class="status">${esc(status)}</span>
            </div>

            <div class="account-grid">
              ${fields
                .map(
                  ([label, value]) => `
                <div class="account-field">
                  <div class="label">${esc(label)}</div>
                  <div class="value">${esc(value)}</div>
                </div>
              `,
                )
                .join("")}
            </div>

            <div class="payment-heading">
              Payment History / Asset Classification
            </div>

            ${paymentHtml(history)}
          </article>
        `;
        })
        .join("")
    : `
      <div class="muted">
        No account details are available in this CRIF report.
      </div>
    `;

  // ----------------------------------------------------------
  // LENDER ENQUIRIES
  // ----------------------------------------------------------
  let enquiryItems = arr(
    getValue(enquiryRoot, "ENQUIRY", "ENQUIRIES", "RESPONSE", "ITEM"),
  );

  if (!enquiryItems.length) {
    const nestedEnquiries = getValue(report, "ENQUIRY", "INQUIRY", "ENQUIRIES");

    enquiryItems = arr(nestedEnquiries);
  }

  const enquiryHtml = enquiryItems.length
    ? `
      <div class="table-wrap">
        <table class="data-table enquiry-table">
          <thead>
            <tr>
              <th>Lender Name</th>
              <th>Date of Inquiry</th>
              <th>Purpose</th>
              <th>Ownership Type</th>
              <th>Amount (₹)</th>
              <th>Remark</th>
            </tr>
          </thead>

          <tbody>
            ${enquiryItems
              .map(
                (enquiry) => `
              <tr>
                <td>
                  ${esc(
                    getValue(
                      enquiry,
                      "LENDER-NAME",
                      "MEMBER-NAME",
                      "CREDIT-GUARANTOR",
                      "CREDIT-GRANTOR",
                    ),
                  )}
                </td>

                <td>
                  ${esc(
                    fmtDate(
                      getValue(
                        enquiry,
                        "DATE-OF-INQUIRY",
                        "INQUIRY-DATE",
                        "DATE",
                        "DATE-OF-ENQUIRY",
                      ),
                    ),
                  )}
                </td>

                <td>
                  ${esc(
                    getValue(
                      enquiry,
                      "PURPOSE",
                      "ENQUIRY-PURPOSE",
                      "PURPOSE-TYPE",
                    ),
                  )}
                </td>

                <td>
                  ${esc(getValue(enquiry, "OWNERSHIP-TYPE", "OWNERSHIP-IND"))}
                </td>

                <td>
                  ${esc(
                    fmtNum(
                      getValue(
                        enquiry,
                        "AMOUNT",
                        "ENQUIRY-AMOUNT",
                        "INQUIRY-AMOUNT",
                      ),
                    ),
                  )}
                </td>

                <td>
                  ${esc(getValue(enquiry, "REMARK", "REMARKS"))}
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
      <div class="muted">
        Individual lender enquiry details are not available
        in the supplied API response.
      </div>
    `;

  // ----------------------------------------------------------
  // EMPLOYMENT AND COMMENTS
  // ----------------------------------------------------------
  const comments = firstAvailable(
    getValue(report, "COMMENTS", "COMMENT"),
    getValue(report, "REPORT-COMMENTS"),
  );

  // ----------------------------------------------------------
  // COMPLETE PDF HTML
  // ----------------------------------------------------------
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />

      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
      />

      <title>CRIF High Mark Consumer Credit Report</title>

      <style>
 
/* =========================================
   CRIF REFERENCE PDF STYLE
   HORIZONTAL LAYOUT - A4 PDF
   BOLD KEYS + PAYMENT HISTORY FIX
========================================= */

@page {
  size: A4;
  margin: 10mm 9mm 12mm;
}

:root {
  --primary: #234f6b;
  --primary-dark: #173d55;
  --key-color: #173f59;
  --value-color: #172630;
  --border-color: #cbd5db;
  --light-bg: #f0f3f4;
  --green-bg: #e7f3e8;
  --green-text: #245a37;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9px;
  color: var(--value-color);
  line-height: 1.4;
  background: #fff;
  overflow-wrap: anywhere;
}

img {
  max-width: 100%;
}

/* =========================================
   GLOBAL TEXT COLORS
   KEYS / LABELS BOLD
========================================= */

.label,
.info-card .label,
.account-field .label,
.account-title,
.section-title,
.subheading,
.payment-heading,
.score-title,
.data-table th,
.summary-table th,
.payment-table th,
strong,
b {
  color: var(--key-color) !important;
  font-weight: 800 !important;
}

.value,
.info-card .value,
.account-field .value,
.data-table td,
.summary-table td,
.payment-table td {
  color: var(--value-color) !important;
  font-weight: 500 !important;
}

/* Bold labels in common key-value structures */
.info-card .label,
.account-field .label {
  display: block;
  font-size: 8px;
  font-weight: 800 !important;
  margin-bottom: 3px;
}

.info-card .value,
.account-field .value {
  display: block;
  font-size: 8px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

/* If the template uses label/value inline pairs */
.info-card label,
.account-field label,
.key,
.field-label,
.data-label {
  color: var(--key-color) !important;
  font-weight: 800 !important;
}

/* =========================================
   HEADER - HORIZONTAL
========================================= */

.masthead {
  display: grid !important;
  grid-template-columns:
    minmax(0, 1fr)
    minmax(0, 1.5fr)
    minmax(0, 1fr) !important;
  align-items: center !important;
  gap: 8px;
  width: 100%;
  border-bottom: 1px solid #bfc9ce;
  padding-bottom: 10px;
  margin-bottom: 14px;
}

.brand {
  min-width: 0;
  font-size: 17px;
  font-weight: 800 !important;
  color: var(--primary-dark);
  letter-spacing: -0.4px;
  text-align: left;
}

.brand small {
  display: block !important;
  font-size: 7px;
  font-weight: 500 !important;
  color: #435966;
  letter-spacing: 0;
  margin-top: 4px;
}

.report-name {
  display: block;
  min-width: 0;
  text-align: center !important;
  font-size: 16px;
  font-weight: 800 !important;
  color: var(--primary-dark);
  margin: 0 0 3px;
}

.mast-right {
  min-width: 0;
  font-size: 7px;
  line-height: 1.5;
  text-align: right !important;
  color: #263d49;
  overflow-wrap: anywhere;
}

.masthead::after {
  content: none !important;
}

.prepared {
  display: block;
  text-align: center;
  font-size: 10px;
  font-weight: 700 !important;
  color: var(--primary-dark);
  margin-bottom: 12px;
}

.top-meta {
  display: none !important;
}

/* =========================================
   TAGLINE
========================================= */

.tagline {
  display: block;
  width: 100%;
  background: #c6e5c9;
  color: #243d2c;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 800 !important;
  text-transform: none;
  letter-spacing: 0;
  margin: 12px 0 8px;
}

/* =========================================
   SECTION HEADINGS
========================================= */

.section {
  display: block;
  width: 100%;
  margin: 13px 0;
}

.section-title {
  display: block;
  width: 100%;
  background: #c6e5c9;
  border: 0;
  border-radius: 2px;
  color: #203c2a !important;
  font-size: 10px;
  font-weight: 800 !important;
  padding: 8px 12px;
  margin-bottom: 10px;
  break-after: avoid;
}

.section-title.orange-title {
  background: #ffdfad;
  color: #3e3425 !important;
}

/* =========================================
   INQUIRY / PERSONAL INFORMATION
   THREE COLUMNS
========================================= */

.info-grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  grid-auto-flow: row;
  gap: 5px 12px;
  align-items: start;
  width: 100%;
}

.info-card {
  display: block !important;
  min-width: 0;
  width: 100%;
  border: 0;
  padding: 3px 2px;
  background: #fff;
  break-inside: avoid;
}

.info-card.wide {
  grid-column: 1 / -1 !important;
}

.label {
  display: block;
  color: var(--key-color) !important;
  font-size: 8px;
  font-weight: 800 !important;
  text-transform: none;
  letter-spacing: 0;
  margin-bottom: 2px;
}

.value {
  display: block;
  font-size: 8px;
  color: var(--value-color) !important;
  font-weight: 500 !important;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* =========================================
   CREDIT SCORE
========================================= */

.score-panel {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 105px !important;
  align-items: center !important;
  gap: 12px;
  width: 100%;
  border: 0;
  background: #fff;
  padding: 6px 10px;
  break-inside: avoid;
}

.score-panel > * {
  min-width: 0;
}

.score-row {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap;
  align-items: center !important;
  gap: 12px;
  width: 100%;
}

.score-title {
  color: var(--key-color) !important;
  font-weight: 800 !important;
  text-transform: uppercase;
  font-size: 10px;
}

.score-number {
  flex-shrink: 0;
  color: var(--primary-dark) !important;
  font-size: 31px;
  font-weight: 800 !important;
  white-space: nowrap;
}

.score-number small {
  color: var(--primary-dark) !important;
  font-weight: 700 !important;
}

/* Circular score badge, if score-number is the circle element */
.score-number.circle,
.score-number.score-circle,
.score-circle {
  display: inline-flex !important;
  justify-content: center;
  align-items: center;
  width: 76px;
  height: 76px;
  border: 3px solid var(--primary);
  border-radius: 50% !important;
  text-align: center;
  padding: 8px;
}

.score-status {
  color: var(--primary-dark) !important;
  font-weight: 800 !important;
}

.score-description {
  color: #334953 !important;
  font-weight: 500 !important;
}

.score-range {
  font-size: 8px;
  font-weight: 700 !important;
}

/* =========================================
   VARIATIONS / SUBSECTIONS
========================================= */

.section-note {
  display: block;
  font-size: 7px;
  font-style: italic;
  color: #52636d;
  text-align: center;
  margin: 0 0 10px;
}

.variation-block {
  display: block;
  width: 100%;
  margin: 9px 0 12px;
  break-inside: auto;
}

.subheading {
  display: block;
  width: 100%;
  background: var(--light-bg);
  color: var(--key-color) !important;
  font-size: 8px;
  font-weight: 800 !important;
  padding: 7px;
  margin-bottom: 0;
}

/* =========================================
   ALL TABLES
   HORIZONTAL TABLE LAYOUT
========================================= */

.data-table,
.summary-table,
.payment-table {
  display: table !important;
  width: 100% !important;
  max-width: 100%;
  border-collapse: collapse !important;
  border-spacing: 0;
  table-layout: fixed !important;
}

.data-table thead,
.summary-table thead,
.payment-table thead {
  display: table-header-group !important;
}

.data-table tbody,
.summary-table tbody,
.payment-table tbody {
  display: table-row-group !important;
}

.data-table tr,
.summary-table tr,
.payment-table tr {
  display: table-row !important;
  break-inside: avoid;
  page-break-inside: avoid;
}

.data-table th,
.summary-table th,
.payment-table th {
  display: table-cell !important;
  background: var(--light-bg);
  color: var(--key-color) !important;
  font-size: 7px;
  font-weight: 800 !important;
  text-transform: none;
  letter-spacing: 0;
  text-align: left;
  vertical-align: middle !important;
  padding: 6px 5px;
  border: 1px solid var(--border-color);
  overflow-wrap: anywhere;
  word-break: normal;
}

.data-table td,
.summary-table td,
.payment-table td {
  display: table-cell !important;
  background: #fff;
  color: var(--value-color) !important;
  font-size: 8px;
  font-weight: 500 !important;
  padding: 6px 5px;
  border: 1px solid var(--border-color);
  vertical-align: top !important;
  overflow-wrap: anywhere;
  word-break: normal;
}

.summary-table td.number {
  font-size: 10px;
  font-weight: 800 !important;
  text-align: center;
}

.table-wrap {
  display: block !important;
  width: 100% !important;
  max-width: 100%;
  overflow: visible !important;
}

/* =========================================
   ACCOUNT SUMMARY METRICS
========================================= */

.inline-metrics {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  width: 100%;
  border: 0;
  background: #fff;
  padding: 9px 4px;
  font-size: 8px;
  line-height: 1.7;
}

.inline-metrics > * {
  min-width: 0;
}

.inline-metrics strong,
.inline-metrics b,
.inline-metrics .label {
  color: var(--key-color) !important;
  font-weight: 800 !important;
}

/* =========================================
   ACCOUNT DETAILS CARD
========================================= */

.account-card {
  display: block;
  width: 100%;
  margin: 12px 0;
  border: 1px solid #d7dfe3;
  break-inside: auto;
}

.account-heading {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap;
  justify-content: space-between !important;
  align-items: center !important;
  gap: 10px;
  width: 100%;
  background: #eef1f2;
  border-bottom: 1px solid #d7dfe3;
  padding: 8px;
}

.account-heading-main {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap;
  align-items: center !important;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.account-index {
  display: inline-flex !important;
  flex-shrink: 0;
  justify-content: center;
  align-items: center;
  background: var(--primary);
  color: #fff !important;
  font-weight: 800 !important;
}

.account-title-wrap {
  display: flex !important;
  flex-direction: column !important;
  min-width: 0;
}

.account-title {
  color: var(--primary-dark) !important;
  font-size: 9px;
  font-weight: 800 !important;
  overflow-wrap: anywhere;
}

.status {
  display: inline-block !important;
  flex-shrink: 0;
  background: #d8eadb;
  color: #245a37 !important;
  font-weight: 800 !important;
  white-space: nowrap;
  padding: 3px 6px;
}

.account-grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  grid-auto-flow: row;
  gap: 0 !important;
  align-items: stretch;
  width: 100%;
}

.account-field {
  display: block !important;
  min-width: 0;
  padding: 7px;
  border-color: #e0e5e8;
  border-style: solid;
  border-width: 0 1px 1px 0;
  overflow-wrap: anywhere;
}

.account-field .label {
  margin-bottom: 3px;
  color: var(--key-color) !important;
  font-weight: 800 !important;
}

.account-field .value {
  line-height: 1.4;
  color: var(--value-color) !important;
  font-weight: 500 !important;
}

/* =========================================
   PAYMENT HISTORY
   TABLE FIXES
========================================= */

.payment-heading {
  display: block;
  margin: 8px 0 12px;
  color: #111 !important;
  font-size: 10px;
  font-weight: 800 !important;
}

.payment-table {
  display: table !important;
  width: 100% !important;
  max-width: 100%;
  table-layout: fixed !important;
  border-collapse: collapse !important;
  border-spacing: 0 !important;
}

.payment-table thead {
  display: table-header-group !important;
}

.payment-table tbody {
  display: table-row-group !important;
}

.payment-table tr {
  display: table-row !important;
  break-inside: avoid;
  page-break-inside: avoid;
}

.payment-table th,
.payment-table td {
  display: table-cell !important;
  vertical-align: middle !important;
  text-align: center;
  border: 1px solid var(--border-color) !important;
  padding: 5px 3px !important;
  overflow-wrap: anywhere;
  word-break: normal;
  white-space: normal;
}

.payment-table th {
  background: var(--light-bg) !important;
  color: var(--key-color) !important;
  font-size: 7px !important;
  font-weight: 800 !important;
}

.payment-table td {
  background: #fff !important;
  color: var(--value-color) !important;
  font-size: 7px !important;
  font-weight: 600 !important;
  font-variant-numeric: tabular-nums;
}

/* Standard / on-time payment indicator */
.payment-table td.std {
  background: var(--green-bg) !important;
  color: var(--green-text) !important;
  font-weight: 800 !important;
}

/* Keep payment codes/numbers readable */
.payment-table td span,
.payment-table td strong,
.payment-table td b {
  color: inherit !important;
  font-weight: 800 !important;
}

/* Prevent CSS pseudo-elements from duplicating cell text.
   This does not remove XXX/numbers present in actual HTML data. */
.payment-table td::before,
.payment-table td::after,
.payment-table th::before,
.payment-table th::after {
  content: none !important;
  display: none !important;
}

/* Don't allow nested elements to create extra layout columns */
.payment-table td > *,
.payment-table th > * {
  max-width: 100%;
  overflow-wrap: anywhere;
}

/* =========================================
   DISCLAIMER AND FOOTER
========================================= */

.disclaimer {
  display: block;
  width: 100%;
  border-top: 1px solid #c5cfd4;
  color: #43545d;
  font-size: 7px;
  font-weight: 500 !important;
  line-height: 1.5;
  padding-top: 6px;
}

.disclaimer strong,
.disclaimer b {
  color: var(--key-color) !important;
  font-weight: 800 !important;
}

.footer-note {
  display: block;
  width: 100%;
  color: #52636d;
  font-size: 7px;
  font-weight: 500 !important;
  text-align: center;
  margin-top: 8px;
}

/* =========================================
   PRINT / PUPPETEER PDF
========================================= */

@media print {
  html,
  body {
    width: 100%;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .masthead,
  .info-grid,
  .score-panel,
  .account-heading {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .section-title,
  .variation-block {
    break-after: avoid;
    page-break-after: avoid;
  }

  .section-title,
  .subheading,
  .data-table th,
  .summary-table th,
  .payment-table th {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .data-table,
  .summary-table,
  .payment-table {
    width: 100% !important;
  }

  .data-table th,
  .data-table td,
  .summary-table th,
  .summary-table td,
  .payment-table th,
  .payment-table td {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}

/* =========================================
   SMALL SCREEN FALLBACK
   PDF remains A4 when rendered by Puppeteer
========================================= */

@media screen and (max-width: 650px) {
  .masthead {
    grid-template-columns: minmax(0, 1fr) !important;
    text-align: center;
  }

  .brand,
  .mast-right {
    text-align: center !important;
  }

  .info-grid,
  .account-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .score-panel {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}

 
      </style>
    </head>

    <body>
      <header class="masthead">
        <div class="brand">
          CRIF HIGH MARK
          <small>TOGETHER TO THE NEXT LEVEL</small>
        </div>

        <div class="mast-right">
          <strong>CONSUMER CREDIT REPORT</strong>
          Confidential Credit Information<br />
          CHM Ref #: ${esc(reportNumber)}<br />
          Date of Request: ${esc(reportDate)}<br />
          Date of Issue: ${esc(reportDate)}
        </div>
      </header>

      <div class="tagline">Inquiry Input Information</div>

      <h1 class="report-name">Consumer Credit Report</h1>

      <div class="prepared">
        For <strong>${esc(name)}</strong>
      </div>

      <div class="top-meta">
        <div>
          <span>Report Reference</span>
          <strong>${esc(reportNumber)}</strong>
        </div>

        <div>
          <span>Date of Request / Issue</span>
          <strong>${esc(reportDate)}</strong>
        </div>

        <div>
          <span>Applicant Name</span>
          <strong>${esc(name)}</strong>
        </div>
      </div>

      <!-- INQUIRY INPUT INFORMATION -->
      <section class="section">
        <div class="section-title">
          Inquiry Input Information
        </div>

        <div class="info-grid">
          ${infoCard("Name", name)}
          ${infoCard("Date of Birth", fmtDate(dob))}
          ${infoCard("Gender", gender)}
          ${infoCard("Phone Number", mobile)}
          ${infoCard("Email ID", email)}
          ${infoCard("ID / PAN", pan)}
          ${infoCard("Address", maskAddress(address), true)}
        </div>
      </section>

      <!-- CREDIT SCORE -->
      <section class="section">
        <div class="section-title">
          CRIF HIGH MARK SCORE
        </div>

        <div class="score-panel">
          <div>
            <div class="score-title">Score Information</div>

            <div class="score-row">
              <div class="score-number">
                ${score === null ? "-" : esc(score)}

                <small>CRIF Score</small>
              </div>

              <div>
                <div class="score-name">${esc(scoreName)}</div>
                <div class="score-range">Score Range: 300–900</div>
              </div>
            </div>
          </div>

          <div>
            <div class="score-status">${esc(scoreStatus)}</div>
            <div class="score-description">
              ${esc(scoreDescription)}
            </div>
          </div>
        </div>

        <div class="subheading" style="margin-top: 11px">
          Scoring Factors
        </div>

        <ul class="factor-list">
          <li>
            The reported credit score should be interpreted with
            the credit information shown in this report.
          </li>
          <li>
            Review account status, outstanding balances and
            payment history for additional context.
          </li>
        </ul>
      </section>

      <!-- PERSONAL INFORMATION VARIATIONS -->
      <section class="section">
        <div class="section-title">
          Personal Information - Variations
        </div>

        <div class="section-note">
          Variations reported by financial institutions in the source data.
        </div>

        ${variationTable(nameVariations, "Name Variations")}
        ${variationTable(dobVariations, "DOB Variations")}
        ${variationTable(addressVariations, "Address Variations", true)}
        ${variationTable(phoneVariations, "Phone Variations")}
        ${variationTable(idVariations, "ID / PAN Variations")}
        ${variationTable(emailVariations, "Email ID Variations")}
      </section>

      <!-- ACCOUNT SUMMARY -->
      <section class="section">
        <div class="section-title">Account Summary</div>

        <div class="section-note">
          Amounts are shown in INR. Values are based on the
          account-summary fields returned by the source.
        </div>

        <table class="summary-table">
          <thead>
            <tr>
              <th>Number of Accounts</th>
              <th>Active Accounts</th>
              <th>Overdue Accounts</th>
              <th>Current Balance (₹)</th>
              <th>Disbursed Amount / High Credit (₹)</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td class="number">${esc(totalAccounts)}</td>
              <td class="number">${esc(activeAccounts)}</td>
              <td class="number">${esc(overdueAccounts)}</td>
              <td class="number">${esc(fmtNum(currentBalance))}</td>
              <td class="number">${esc(fmtNum(disbursedAmount))}</td>
            </tr>
          </tbody>
        </table>

        <div class="inline-metrics">
          <strong>Inquiries in last 24 months:</strong>
          ${esc(enquiries24)}
          &nbsp; | &nbsp;

          <strong>New accounts in last 6 months:</strong>
          ${esc(newAccounts6)}
          &nbsp; | &nbsp;

          <strong>New delinquent accounts in last 6 months:</strong>
          ${esc(newDelinquent6)}
        </div>

        <div class="info-grid" style="margin-top: 8px">
          ${infoCard("Secured Accounts", securedAccounts)}
          ${infoCard("Unsecured Accounts", unsecuredAccounts)}
          ${infoCard("Inquiries - Last 6 Months", enquiries6)}
        </div>
      </section>

      <!-- ACCOUNT INFORMATION -->
      <section class="section">
        <div class="section-title">Account Information</div>
        ${accountsHtml}
      </section>

      <!-- LENDER ENQUIRIES -->
      <section class="section">
        <div class="section-title">
          Inquiry Done by Lenders - Past 24 Months
        </div>

        ${enquiryHtml}
      </section>

      <!-- EMPLOYMENT DETAILS -->
      <section class="section">
        <div class="section-title">Employment Details</div>

        <div class="info-grid">
          ${infoCard(
            "Occupation",
            getValue(employment, "OCCUPATION", "OCCUPATION-TYPE"),
          )}

          ${infoCard(
            "Employer",
            getValue(employment, "EMPLOYER", "EMPLOYER-NAME"),
          )}

          ${infoCard(
            "Income",
            getValue(employment, "INCOME", "MONTHLY-INCOME", "ANNUAL-INCOME"),
          )}

          ${infoCard(
            "Employment Type",
            getValue(employment, "EMPLOYMENT-TYPE", "EMPLOYMENT_TYPE"),
          )}
        </div>
      </section>

      <!-- COMMENTS -->
      <section class="section">
        <div class="section-title">Comments</div>

        <div class="muted">
          ${esc(comments)}
        </div>
      </section>

      <!-- APPENDIX -->
      <section class="section">
        <div class="section-title">Appendix - Understanding the Report</div>

        <div class="appendix-note">
          <strong>Account information:</strong>
          Account details and status are displayed using the
          information supplied by the source response.

          <br /><br />

          <strong>Payment history:</strong>
          Payment history and asset-classification values are
          displayed when they are available in the API response.
          A dash indicates that a value was not supplied.

          <br /><br />

          <strong>Data variations:</strong>
          Personal-information variations reflect the variation
          fields present in the supplied response. Missing variation
          records are not inferred or created.
        </div>
      </section>

      <!-- DISCLAIMER -->
      <div class="disclaimer">
        <strong>Disclaimer:</strong>
        This report is generated using information received from
        the CRIF High Mark credit information source through the
        configured API integration. The information is subject to
        the source data and may be updated or corrected by reporting
        institutions. Missing fields are displayed as “-” when the
        corresponding value is not present in the API response.
        This report contains confidential personal and financial
        information and should only be accessed or shared by
        authorized recipients.
      </div>

      <div class="footer-note">
        CRIF HIGH MARK · CONSUMER CREDIT REPORT · CONFIDENTIAL
      </div>
    </body>
    </html>
  `;

  // ----------------------------------------------------------
  // GENERATE PDF
  // ----------------------------------------------------------
  const uploadDir = path.join(
    process.cwd(),
    "uploads",
    "credit-reports",
    "crif",
  );

  fs.mkdirSync(uploadDir, { recursive: true });

  const safeId = String(creditReportId || Date.now()).replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );

  const filePath = path.join(uploadDir, `crif-${safeId}.pdf`);

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    await page.emulateMediaType("print");

    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,

      headerTemplate: `
        <div style="
          width: 100%;
          font-size: 7px;
          color: #73858e;
          text-align: right;
          padding: 0 11mm;
          font-family: Arial, Helvetica, sans-serif;
        ">
          CRIF High Mark Consumer Credit Report
        </div>
      `,

      footerTemplate: `
        <div style="
          width: 100%;
          font-size: 7px;
          color: #73858e;
          text-align: center;
          padding: 0 11mm;
          font-family: Arial, Helvetica, sans-serif;
        ">
          Page
          <span class="pageNumber"></span>
          of
          <span class="totalPages"></span>
        </div>
      `,

      margin: {
        top: "14mm",
        right: "11mm",
        bottom: "16mm",
        left: "11mm",
      },
    });

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      throw new Error("CRIF PDF was not created or is empty");
    }

    console.log(
      "[CRIF] PDF generated successfully:",
      filePath,
      fs.statSync(filePath).size,
      "bytes",
    );

    return filePath;
  } catch (error) {
    console.error("[CRIF] PDF generation failed:", error);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (removeError) {
        console.error(
          "[CRIF] Failed to remove incomplete PDF:",
          removeError.message,
        );
      }
    }

    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("[CRIF] Browser close error:", closeError.message);
      }
    }
  }
};

module.exports = { generateCrifPdf };
