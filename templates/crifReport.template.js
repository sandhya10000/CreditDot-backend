// ============================================================
// CRIF HIGH MARK CREDIT REPORT PDF TEMPLATE
// File: templates/crifReport.template.js
// Layout matches the official CRIF Consumer Credit Report PDF
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
      if (value !== undefined && value !== null && value !== "") return value;
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
    if (value === undefined || value === null || value === "") return [];
    return Array.isArray(value) ? value : [value];
  };

  const esc = (value, fallback = "-") => {
    if (value === undefined || value === null || value === "") value = fallback;
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

  const firstAvailable = (...values) =>
    values.find((v) => v !== undefined && v !== null && v !== "") ?? null;

  // Indian number format. Missing -> "-" (or "0" when zeroDefault is true)
  const money = (value, zeroDefault = false) => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      !Number.isFinite(Number(String(value).replace(/,/g, "")))
    ) {
      return zeroDefault ? "0" : "-";
    }
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
      Number(String(value).replace(/,/g, "")),
    );
  };

  const fmtDate = (value) => {
    if (!value || value === "-") return "-";
    const input = String(value).trim();

    let m = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    m = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;

    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      date.getFullYear(),
    ].join("-");
  };

  const truncate = (value, max = 62) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  };

  const getNumber = (obj, ...keys) => {
    const value = getValue(obj, ...keys);
    const n = Number(value);
    return value === null || !Number.isFinite(n) ? 0 : n;
  };

  const sum = (...values) =>
    values.reduce((t, v) => {
      const n = Number(v);
      return t + (Number.isFinite(n) ? n : 0);
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
  const group = firstAvailable(
    getObject(summary, "GROUP-ACCOUNTS-SUMMARY", "GROUP-ACCOUNT-SUMMARY"),
    {},
  );
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
          return { value: item, date: null };
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
        (i) => i.value !== null && i.value !== undefined && i.value !== "",
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
  if (!idVariations.length) {
    idVariations.push(
      ...pickList(report, ["PAN-VARIATIONS", "PAN-VARIATION", "ID-VARIATIONS"]),
    );
  }

  // ----------------------------------------------------------
  // APPLICANT DETAILS
  // ----------------------------------------------------------
  const pickReq = (...keys) =>
    firstAvailable(
      getValue(request, ...keys),
      getValue(personal, ...keys),
      getValue(contact, ...keys),
    );

  const name = firstAvailable(
    pickReq("NAME", "FULL-NAME", "APPLICANT-NAME"),
    getValue(apiData, "name", "applicantName"),
  );
  const dob = pickReq("DOB", "DATE-OF-BIRTH");
  const pan = pickReq("PAN", "PAN-NUMBER", "ID-NUMBER");
  const gender = pickReq("GENDER", "SEX");
  const father = pickReq("FATHER", "FATHER-NAME");
  const spouse = pickReq("SPOUSE", "SPOUSE-NAME");
  const mother = pickReq("MOTHER", "MOTHER-NAME");
  const mobile = pickReq(
    "PHONE-1",
    "MOBILE",
    "MOBILE-NUMBER",
    "PHONE",
    "PHONE-NUMBER",
  );
  const email = pickReq("EMAIL-1", "EMAIL", "EMAIL-ID", "EMAIL-ADDRESS");
  const address = firstAvailable(
    pickReq("ADDRESS-1", "ADDRESS", "CURRENT-ADDRESS"),
    addressVariations[0]?.value,
  );
  const otherAddress = pickReq(
    "ADDRESS-2",
    "OTHER-ADDRESS",
    "PERMANENT-ADDRESS",
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

  const applicationId = firstAvailable(
    getValue(header, "APPLICATION-ID", "INQUIRY-UNIQUE-REF-NO"),
    getValue(request, "APPLICATION-ID", "INQUIRY-UNIQUE-REF-NO"),
    getValue(report, "APPLICATION-ID"),
  );

  const dateOfIssue = fmtDate(
    firstAvailable(
      getValue(header, "DATE-OF-ISSUE"),
      getValue(header, "DATE-OF-REPORT"),
      getValue(header, "REPORT-DATE"),
      getValue(header, "DATE-OF-REQUEST"),
    ),
  );
  const dateOfRequest = fmtDate(
    firstAvailable(
      getValue(header, "DATE-OF-REQUEST"),
      getValue(header, "DATE-OF-ISSUE"),
      getValue(header, "DATE-OF-REPORT"),
      getValue(header, "REPORT-DATE"),
    ),
  );

  const employmentText = firstAvailable(
    getValue(
      employment,
      "OCCUPATION",
      "OCCUPATION-TYPE",
      "EMPLOYER",
      "EMPLOYER-NAME",
    ),
    getValue(request, "EMPLOYMENT-DETAILS", "OCCUPATION"),
    getValue(personal, "EMPLOYMENT-DETAILS", "OCCUPATION"),
  );

  // ----------------------------------------------------------
  // CREDIT SCORE
  // ----------------------------------------------------------
  const scoreObj = firstAvailable(
    arr(report?.SCORES?.SCORE)[0],
    arr(report?.SCORES)[0],
    {},
  );

  const scoreCandidates = [
    apiData?.data?.score,
    apiData?.score,
    report?.["CREDIT-SCORE"],
    report?.SCORE,
    report?.["SCORE-VALUE"],
    scoreObj?.["SCORE-VALUE"],
    scoreObj?.["SCORE"],
    report?.["SCORE-DETAILS"]?.["SCORE-VALUE"],
    report?.["CREDIT-SCORE-DETAILS"]?.["SCORE-VALUE"],
  ];

  const scoreRaw = scoreCandidates.find(
    (v) =>
      v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)),
  );
  const score = scoreRaw === undefined ? null : Number(scoreRaw);

  const scoreName = firstAvailable(
    getValue(report, "SCORE-NAME"),
    getValue(scoreObj, "SCORE-NAME", "NAME"),
    getValue(getObject(report, "SCORE-DETAILS"), "SCORE-NAME"),
    "PERFORM CONSUMER 2.2",
  );
  const scoreRange = firstAvailable(
    getValue(scoreObj, "SCORE-RANGE", "RANGE"),
    "300-900",
  );
  const scoreDescription = firstAvailable(
    getValue(scoreObj, "SCORE-COMMENTS", "DESCRIPTION"),
    getValue(report, "SCORE-DESCRIPTION"),
  );

  // ----------------------------------------------------------
  // ACCOUNT COLLECTION
  // ----------------------------------------------------------
  const responseRoot = getObject(report, "RESPONSES");
  let accounts = arr(getValue(responseRoot, "RESPONSE", "RESPONSES", "ITEM"));

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

  // ----------------------------------------------------------
  // ACCOUNT SUMMARY TABLES (Primary / Secondary / Group)
  // ----------------------------------------------------------
  const summaryColumns = [
    ["Number of<br/>Accounts", ["NUMBER-OF-ACCOUNTS"], "zero"],
    ["Active", ["ACTIVE-NUMBER-OF-ACCOUNTS"], "zero"],
    ["Overdue", ["OVERDUE-NUMBER-OF-ACCOUNTS"], "zero"],
    ["Secured", ["SECURED-NUMBER-OF-ACCOUNTS"], "zero"],
    ["Unsecured", ["UNSECURED-NUMBER-OF-ACCOUNTS"], "zero"],
    ["Untagged", ["UNTAGGED-NUMBER-OF-ACCOUNTS"], "zero"],
    ["Total<br/>Current<br/>Balance", ["CURRENT-BALANCE"], "zero"],
    [
      "Current<br/>Balance<br/>Secured",
      ["SECURED-CURRENT-BALANCE", "CURRENT-BALANCE-SECURED"],
      "dash",
    ],
    [
      "Current<br/>Balance<br/>Unsecured",
      ["UNSECURED-CURRENT-BALANCE", "CURRENT-BALANCE-UNSECURED"],
      "dash",
    ],
    ["Total<br/>Sanctioned<br/>Amount", ["SANCTIONED-AMOUNT"], "zero"],
    ["Total<br/>Disbursed<br/>Amount", ["DISBURSED-AMOUNT"], "zero"],
    [
      "Total<br/>Amount<br/>Overdue",
      ["OVERDUE-AMOUNT", "TOTAL-AMOUNT-OVERDUE"],
      "zero",
    ],
  ];

  const summaryTable = (title, obj, prefix) => {
    const hasData = Object.keys(obj || {}).length > 0;

    const cells = summaryColumns.map(([, suffixes, mode]) => {
      const raw = getValue(obj, ...suffixes.map((s) => `${prefix}-${s}`));
      if (raw === null) return hasData && mode === "zero" ? "0" : "-";
      return money(raw, false) === "-" ? esc(raw) : money(raw);
    });

    return `
      <section class="section">
        <div class="section-title">${esc(title)}</div>
        <table class="grid-table summary-table">
          <thead>
            <tr>${summaryColumns.map(([label]) => `<th>${label}</th>`).join("")}</tr>
          </thead>
          <tbody>
            <tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>
          </tbody>
        </table>
      </section>
    `;
  };

  const enquiries24 = firstAvailable(
    getValue(
      derived,
      "INQURIES-IN-LAST-24-MONTHS",
      "INQUIRIES-IN-LAST-24-MONTHS",
      "INQUIRIES-IN-LAST-TWENTY-FOUR-MONTHS",
    ),
    getValue(
      enquiryRoot,
      "NUMBER-OF-ENQUIRIES",
      "TOTAL-ENQUIRIES",
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

    if (Array.isArray(raw)) {
      return raw
        .map((item) => ({
          month: getValue(item, "MONTH", "MONTH-NAME") || "",
          year: String(getValue(item, "YEAR") || ""),
          amount: String(
            getValue(item, "AMOUNT", "DAYS-PAST-DUE", "DPD") || "-",
          )
            .replace(/\s+/g, " ")
            .trim(),
          status: String(
            getValue(item, "STATUS", "ASSET-CLASSIFICATION") || "-",
          )
            .trim()
            .toUpperCase(),
        }))
        .filter((item) => item.month && item.year);
    }

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
        amount: match[3].trim() || "-",
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

  const paymentHtml = (raw) => {
    const history = normalizeHistory(raw);

    if (!history.length) {
      return `<div class="muted pad">Payment history is not available.</div>`;
    }

    const years = {};
    history.forEach((item) => {
      const month = months.find(
        (m) =>
          m.slice(0, 3).toLowerCase() ===
          String(item.month).slice(0, 3).toLowerCase(),
      );
      if (!month || !item.year) return;
      if (!years[item.year]) years[item.year] = {};
      years[item.year][month] = item;
    });

    return `
      <table class="grid-table payment-table">
        <thead>
          <tr>
            <th class="year-col"></th>
            ${months.map((m) => `<th>${m}</th>`).join("")}
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
                  if (!item) return `<td></td>`;
                  const amount =
                    item.amount && item.amount !== "-" ? item.amount : "";
                  const status =
                    item.status && item.status !== "-" ? item.status : "";
                  const text =
                    amount && status
                      ? `${amount}/${status}`
                      : amount || status || "-";
                  return `<td>${esc(text)}</td>`;
                })
                .join("")}
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;
  };

  // ----------------------------------------------------------
  // HTML COMPONENTS
  // ----------------------------------------------------------
  const kv = (label, value) =>
    `<td class="k">${esc(label)}</td><td class="v">${esc(value)}</td>`;

  const variationTable = (items, heading, { address = false } = {}) => `
    <div class="var-block">
      <table class="var-table">
        <thead>
          <tr>
            <th>${esc(heading)}</th>
            <th class="right">Reported On</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
            <tr>
              <td>${esc(address ? truncate(item.value, 60) : item.value)}</td>
              <td class="right">${esc(fmtDate(item.date), "N.A.")}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  // ----------------------------------------------------------
  // ACCOUNT INFORMATION
  // ----------------------------------------------------------
  const securityRows = [];

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

          const accNo = getValue(loan, "ACCT-NUMBER", "ACCOUNT-NUMBER") || "-";
          const infoAsOf = fmtDate(
            getValue(loan, "INFO-AS-OF", "DATE-REPORTED"),
          );

          const suitStatus =
            getValue(
              loan,
              "SUIT-FILED_WILFUL-DEFAULT",
              "SUIT-FILED-WILFUL-DEFAULT",
              "SUIT-FILED",
              "WILFUL-DEFAULT",
              "ASSET-CLASS",
            ) || "-";

          // Security / collateral rows
          arr(
            getValue(
              loan,
              "SECURITY-DETAILS",
              "COLLATERAL-DETAILS",
              "SECURITY",
            ),
          ).forEach((sec) => {
            if (sec && typeof sec === "object") {
              securityRows.push([
                getValue(sec, "SECURITY-TYPE", "TYPE"),
                getValue(sec, "TYPE-OF-CHARGE", "CHARGE-TYPE"),
                getValue(sec, "SECURITY-VALUE", "VALUE"),
                getValue(sec, "DATE-OF-VALUE", "VALUE-DATE"),
              ]);
            }
          });

          const fields = [
            ["Ownership:", getValue(loan, "OWNERSHIP-IND", "OWNERSHIP") || "-"],
            [
              "Disbursed Date:",
              fmtDate(getValue(loan, "DISBURSED-DT", "DISBURSED-DATE")),
            ],
            [
              "Disbd Amt/High Credit:",
              money(getValue(loan, "DISBURSED-AMT", "DISBURSED-AMOUNT")),
            ],
            ["Credit Limit:", money(getValue(loan, "CREDIT-LIMIT"))],
            [
              "Last Payment Date:",
              fmtDate(getValue(loan, "LAST-PAYMENT-DATE")),
            ],
            [
              "Current Balance:",
              money(getValue(loan, "CURRENT-BAL", "CURRENT-BALANCE"), true),
            ],
            ["Cash Limit:", money(getValue(loan, "CASH-LIMIT"))],
            [
              "Closed Date:",
              fmtDate(getValue(loan, "CLOSED-DATE", "CLOSED-DT")),
            ],
            [
              "Last Paid Amt:",
              money(getValue(loan, "LAST-PAID-AMT", "LAST-PAID-AMOUNT")),
            ],
            [
              "InstlAmt/Freq:",
              getValue(
                loan,
                "INSTL-AMT",
                "INSTLAMT-FREQ",
                "INSTL-AMT-FREQ",
                "INSTALLMENT-AMOUNT",
              ) || "-",
            ],
            ["Tenure(month):", getValue(loan, "TENURE", "TENURE-MONTH") || "-"],
            [
              "Overdue Amt:",
              money(getValue(loan, "OVERDUE-AMT", "OVERDUE-AMOUNT"), true),
            ],
            ["Status:", suitStatus],
            [
              "Settlement Amt:",
              money(getValue(loan, "SETTLEMENT-AMT", "SETTLEMENT-AMOUNT")),
            ],
            [
              "Principal Writeoff Amt:",
              money(
                getValue(
                  loan,
                  "PRINCIPAL-WRITEOFF-AMT",
                  "PRINCIPAL-WRITE-OFF-AMT",
                ),
              ),
            ],
            [
              "Total Writeoff Amt:",
              money(
                getValue(
                  loan,
                  "WRITE-OFF-AMT",
                  "TOTAL-WRITEOFF-AMT",
                  "TOTAL-WRITE-OFF-AMT",
                ),
                true,
              ),
            ],
          ];

          // Build rows of 3 key/value pairs
          const rows = [];
          for (let i = 0; i < fields.length; i += 3) {
            rows.push(fields.slice(i, i + 3));
          }

          const statusUpper = String(status).toUpperCase();
          const stripClass = /CLOSED|SETTLED|WRITTEN/.test(statusUpper)
            ? "closed"
            : "active";
          const stripText = statusUpper
            .split("")
            .map((ch) => (ch === " " ? "&nbsp;" : esc(ch)))
            .join("<br/>");

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
              <span class="acc-index">${index + 1}</span>
              <span class="acc-item">Account Type:<span class="acc-type">${esc(type)}</span></span>
              <span class="acc-item">Credit Grantor: ${esc(grantor)}</span>
              <span class="acc-item">Account #: ${esc(accNo)}</span>
              <span class="acc-item plain">Info, as of: <span class="plain-val">${esc(infoAsOf)}</span></span>
            </div>

            <table class="account-table">
              <tbody>
                ${rows
                  .map((row, rIdx) => {
                    const cells = row.map(([k, v]) => kv(k, v)).join("");
                    const pad =
                      row.length < 3
                        ? `<td class="k" colspan="${(3 - row.length) * 2}"></td>`
                        : "";
                    const strip =
                      rIdx === 0
                        ? `<td class="strip ${stripClass}" rowspan="${rows.length}">${stripText}</td>`
                        : "";
                    return `<tr>${strip}${cells}${pad}</tr>`;
                  })
                  .join("")}
              </tbody>
            </table>

            <div class="payment-heading">Payment History/Asset Classification</div>
            ${paymentHtml(history)}
          </article>`;
        })
        .join("")
    : `<div class="muted pad">No account details are available in this CRIF report.</div>`;

  const securityHtml = `
    <div class="payment-heading collateral-heading">Collateral/Security Details</div>
    <table class="grid-table collateral-table">
      <thead>
        <tr>
          <th>Security Type</th>
          <th>Type of Charge</th>
          <th>Security Value</th>
          <th>Date Of Value</th>
        </tr>
      </thead>
      <tbody>
        ${
          securityRows.length
            ? securityRows
                .map(
                  (r) => `<tr>
                    <td>${esc(r[0])}</td>
                    <td>${esc(r[1])}</td>
                    <td>${esc(money(r[2]) === "-" ? r[2] : money(r[2]))}</td>
                    <td>${esc(r[3] ? fmtDate(r[3]) : "-")}</td>
                  </tr>`,
                )
                .join("")
            : `<tr><td>-</td><td>-</td><td>-</td><td>-</td></tr>`
        }
      </tbody>
    </table>
  `;

  // ----------------------------------------------------------
  // LENDER ENQUIRIES
  // ----------------------------------------------------------
  let enquiryItems = arr(
    getValue(enquiryRoot, "ENQUIRY", "ENQUIRIES", "RESPONSE", "ITEM"),
  );
  if (!enquiryItems.length) {
    enquiryItems = arr(getValue(report, "ENQUIRY", "INQUIRY", "ENQUIRIES"));
  }

  const enquiryHtml = `
    <table class="grid-table enquiry-table">
      <thead>
        <tr>
          <th>Lender Name</th>
          <th>Date of Inquiry</th>
          <th>Purpose</th>
          <th>Ownership Type</th>
          <th>Amount</th>
          <th>Remark</th>
        </tr>
      </thead>
      <tbody>
        ${
          enquiryItems.length
            ? enquiryItems
                .map(
                  (e) => `
          <tr>
            <td>${esc(getValue(e, "LENDER-NAME", "MEMBER-NAME", "CREDIT-GUARANTOR", "CREDIT-GRANTOR"))}</td>
            <td>${esc(fmtDate(getValue(e, "DATE-OF-INQUIRY", "INQUIRY-DATE", "DATE", "DATE-OF-ENQUIRY")))}</td>
            <td>${esc(getValue(e, "PURPOSE", "ENQUIRY-PURPOSE", "PURPOSE-TYPE"))}</td>
            <td>${esc(getValue(e, "OWNERSHIP-TYPE", "OWNERSHIP-IND"))}</td>
            <td>${esc(money(getValue(e, "AMOUNT", "ENQUIRY-AMOUNT", "INQUIRY-AMOUNT")))}</td>
            <td>${esc(getValue(e, "REMARK", "REMARKS"), "—")}</td>
          </tr>`,
                )
                .join("")
            : `<tr><td colspan="6" class="center">No inquiries reported</td></tr>`
        }
      </tbody>
    </table>
  `;

  // ----------------------------------------------------------
  // COMPLETE HTML
  // ----------------------------------------------------------
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>CRIF High Mark Consumer Credit Report</title>
<style>
  @page { size: A4; }

  :root {
    --navy: #1f3b73;
    --text: #222;
    --green: #bcd9b8;
    --orange: #fcd9a6;
    --head-bg: #eaeff7;
    --border: #cdd3dc;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5px;
    color: var(--text);
    line-height: 1.35;
  }

  .page-break { break-before: page; page-break-before: always; }

  /* ---------- Masthead ---------- */
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .logo { width: 33%; }
  .logo .crif {
    font-size: 22px;
    font-weight: 900;
    color: #1b2b44;
    letter-spacing: -0.5px;
  }
  .logo .hm {
    font-size: 11px;
    font-weight: 800;
    color: #1a6b9a;
    margin-left: 6px;
  }
  .logo .tag {
    font-size: 7px;
    font-style: italic;
    color: #666;
    margin-top: 1px;
  }
  .title { width: 34%; }
  .title h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #1b2b44;
  }
  .title .for {
    font-size: 10px;
    font-weight: 700;
    color: #1b2b44;
    margin-top: 2px;
  }
  .meta { width: 33%; }
  .meta table { border-collapse: collapse; font-size: 7.5px; margin-left: auto; }
  .meta td { padding: 1.5px 6px; vertical-align: top; }
  .meta td.l { color: #666; }
  .meta td.r { font-weight: 800; color: #111; }

  /* ---------- Section titles ---------- */
  .section { margin: 0 0 14px; }
  .section-title {
    background: var(--green);
    color: #1b2b44;
    font-size: 10px;
    font-weight: 800;
    padding: 7px 9px;
    margin-bottom: 7px;
    break-after: avoid;
  }
  .section-title.orange { background: var(--orange); }

  /* ---------- Inquiry input ---------- */
  .input-table { width: 100%; border-collapse: collapse; }
  .input-table td { padding: 2.5px 4px; vertical-align: top; }
  .input-table td.lab { font-weight: 800; color: #1b2b44; white-space: nowrap; width: 11%; }
  .input-table td.val { width: 22%; }

  /* ---------- Generic grid tables ---------- */
  .grid-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .grid-table th {
    background: var(--head-bg);
    color: var(--navy);
    font-weight: 800;
    font-size: 7.5px;
    text-align: center;
    padding: 5px 3px;
    border: 1px solid var(--border);
  }
  .grid-table td {
    padding: 5px 3px;
    border: 1px solid var(--border);
    text-align: center;
    font-size: 8px;
    word-wrap: break-word;
  }
  .grid-table tr { break-inside: avoid; }

  .score-table td { text-align: left; padding: 6px; }
  .score-table th { text-align: left; padding: 6px; }

  .summary-table td { font-size: 8.5px; padding: 6px 3px; }

  .inline-metrics {
    display: flex;
    width: 100%;
    border: 1px solid var(--border);
    background: var(--head-bg);
    margin-top: 14px;
    margin-bottom: 14px;
  }
  .inline-metrics div {
    flex: 1;
    padding: 6px 8px;
    border-right: 1px solid var(--border);
    color: var(--navy);
    font-weight: 800;
    font-size: 8px;
  }
  .inline-metrics div:last-child { border-right: 0; }
  .inline-metrics span { color: var(--text); font-weight: 400; }

  /* ---------- Score ---------- */
  .score-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 4px 6px;
  }
  .score-info { display: flex; gap: 90px; }
  .score-info .lbl { font-weight: 800; color: var(--navy); margin-bottom: 5px; font-size: 9px; }
  .score-info .val { font-size: 9px; }
  .score-badge {
    width: 72px;
    height: 58px;
    border-radius: 16px;
    background: #2d6178;
    color: #fff;
    text-align: center;
    padding-top: 6px;
    margin-right: 30px;
  }
  .score-badge .num { font-size: 24px; font-weight: 800; line-height: 1.05; }
  .score-badge .txt { font-size: 9px; font-weight: 700; color: #cfe0e8; }

  .factors-title { font-size: 10px; font-weight: 800; color: #1b2b44; margin: 14px 4px 5px; }
  .factor-bar { font-size: 9px; letter-spacing: 1px; color: #666; margin-left: 4px; }
  .tips { text-align: right; font-size: 7.5px; color: #555; margin-top: 8px; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin: 0 3px 0 10px; }
  .dot.g { background: #3aa655; }
  .dot.o { background: #ef7b45; }

  /* ---------- Variations ---------- */
  .tip-note { font-size: 7.5px; font-style: italic; color: #555; margin: -2px 0 8px; }
  .var-cols { display: flex; gap: 22px; align-items: flex-start; }
  .var-col { flex: 1; }
  .var-col.right { flex: 0 0 38%; }
  .var-block { margin-bottom: 14px; }
  .var-col.right .var-block {
    background: #fffaf2;
    border: 1px solid #f0c98f;
    padding: 4px 6px;
  }
  .var-table { width: 100%; border-collapse: collapse; font-size: 7.5px; }
  .var-table th {
    text-align: left;
    color: var(--navy);
    font-weight: 800;
    padding: 3px 2px 4px;
  }
  .var-table td { padding: 2px; vertical-align: top; }
  .right { text-align: right !important; }

  /* ---------- Accounts ---------- */
  .account-card { margin-bottom: 18px; break-inside: avoid; }
  .account-heading {
    background: #e8edf6;
    padding: 7px 8px;
    font-weight: 800;
    color: var(--navy);
    font-size: 9px;
  }
  .account-heading .acc-index { margin-right: 6px; }
  .account-heading .acc-item { margin-right: 22px; }
  .account-heading .acc-type { color: #d2232a; margin-left: 0; }
  .account-heading .plain { font-weight: 800; }
  .account-heading .plain-val { font-weight: 400; color: #222; }

  .account-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .account-table td {
    border: 1px solid var(--border);
    padding: 3.5px 5px;
    font-size: 8px;
  }
  .account-table td.k { color: #444; width: 13%; }
  .account-table td.v { text-align: right; font-weight: 800; color: #111; width: 20%; }
  .account-table td.strip {
    width: 16px;
    text-align: center;
    font-weight: 800;
    font-size: 7.5px;
    line-height: 1.2;
    color: #fff;
    border: 0;
    padding: 2px;
  }
  .strip.closed { background: #8fcf8f; }
  .strip.active { background: #5aa7d9; }

  .payment-heading {
    font-weight: 800;
    color: var(--navy);
    font-size: 8.5px;
    margin: 8px 0 3px 2px;
  }
  .collateral-heading { margin: 10px 0 6px 6px; font-size: 9px; }

  .payment-table th, .payment-table td { font-size: 6.8px; padding: 4px 1px; }
  .payment-table .year-col { width: 6%; background: #fff; border-top-color: transparent; }
  .payment-table .year-cell { background: #fff; color: var(--text); font-size: 8px; }

  .collateral-table td { color: #666; padding: 8px 3px; }

  .muted { color: #666; }
  .pad { padding: 6px; }
  .center { text-align: center !important; }

  /* ---------- Disclaimer ---------- */
  .disclaimer {
    font-size: 7.5px;
    line-height: 1.5;
    color: #333;
    margin-top: 6px;
  }
</style>
</head>
<body>

  <!-- MASTHEAD -->
  <div class="masthead">
    <div class="logo">
      <div><span class="crif">CRIF</span><span class="hm">HIGH MARK</span></div>
      <div class="tag">Together to the next level</div>
    </div>

    <div class="title">
      <h1>CONSUMER CREDIT REPORT</h1>
      <div class="for">For ${esc(name)}</div>
    </div>

    <div class="meta">
      <table>
        <tr><td class="l">CHM Ref #:</td><td class="r">${esc(reportNumber)}</td></tr>
        <tr><td class="l">Application ID:</td><td class="r">${esc(applicationId)}</td></tr>
        <tr><td class="l">Date of Request:</td><td class="r">${esc(dateOfRequest)}</td></tr>
        <tr><td class="l">Date of Issue:</td><td class="r">${esc(dateOfIssue)}</td></tr>
      </table>
    </div>
  </div>

  <!-- INQUIRY INPUT INFORMATION -->
  <section class="section">
    <div class="section-title">Inquiry Input Information</div>
    <table class="input-table">
      <tr>
        <td class="lab">Name:</td><td class="val">${esc(name)}</td>
        <td class="lab">DOB/Age:</td><td class="val">${esc(fmtDate(dob))}</td>
        <td class="lab">Gender:</td><td class="val">${esc(gender)}</td>
      </tr>
      <tr>
        <td class="lab">Father:</td><td class="val">${esc(father)}</td>
        <td class="lab">Spouse:</td><td class="val">${esc(spouse)}</td>
        <td class="lab">Mother:</td><td class="val">${esc(mother)}</td>
      </tr>
      <tr>
        <td class="lab">Phone Numbers:</td><td class="val">${esc(mobile)}</td>
        <td class="lab">Email ID(s):</td><td class="val">${esc(email)}</td>
        <td class="lab">ID(s):</td><td class="val">${esc(pan)}</td>
      </tr>
      <tr>
        <td class="lab">Current Address:</td>
        <td class="val" colspan="5">${esc(address)}</td>
      </tr>
      <tr>
        <td class="lab">Other Address:</td>
        <td class="val" colspan="5">${esc(otherAddress)}</td>
      </tr>
      <tr>
        <td class="lab">Employment Details:</td>
        <td class="val" colspan="5">${esc(employmentText)}</td>
      </tr>
    </table>
  </section>

  <!-- CREDIT SCORE -->
  <section class="section">
    <div class="section-title">CRIF HIGHMARK SCORE(S):</div>

    <table class="grid-table score-table">
      <thead>
        <tr>
          <th style="width:34%">SCORE NAME</th>
          <th style="width:16%">RANGE</th>
          <th style="width:12%">SCORE</th>
          <th>DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(scoreName)}</td>
          <td>${esc(scoreRange)}</td>
          <td>${score === null ? "-" : esc(score)}</td>
          <td>${esc(scoreDescription)}</td>
        </tr>
      </tbody>
    </table>

    <div class="score-wrap">
      <div class="score-info">
        <div>
          <div class="lbl">SCORE NAME</div>
          <div class="val">${esc(scoreName)}</div>
        </div>
        <div>
          <div class="lbl">Score Range</div>
          <div class="val">${esc(scoreRange)}</div>
        </div>
      </div>

      <div class="score-badge">
        <div class="num">${score === null ? "-" : esc(score)}</div>
        <div class="txt">Score</div>
      </div>
    </div>

    <div class="factors-title">SCORING FACTORS</div>
    <div class="factor-bar">|||||||||||</div>

    <div class="tips">
      Tips: <span class="dot g"></span>Positive impact on credit score
      <span class="dot o"></span>Negative impact on credit score
    </div>
  </section>

  <!-- PERSONAL INFORMATION VARIATIONS -->
  <section class="section">
    <div class="section-title orange">Personal Information - Variations</div>
    <div class="tip-note">Tip: These are applicant's personal information variations as contributed by various financial institutions</div>

    <div class="var-cols">
      <div class="var-col">
        ${variationTable(nameVariations, "Name Variations")}
        ${variationTable(addressVariations, "Address Variation", { address: true })}
        ${variationTable(emailVariations, "Email Variation")}
      </div>
      <div class="var-col right">
        ${variationTable(dobVariations, "DOB Variations")}
        ${variationTable(phoneVariations, "Phone Variations")}
        ${variationTable(idVariations, "PAN Variations")}
      </div>
    </div>
  </section>

  <!-- ACCOUNT SUMMARY (page 2) -->
  <div class="page-break"></div>

  ${summaryTable("Primary Account Summary", primary, "PRIMARY")}
  ${summaryTable("Secondary Account Summary", secondary, "SECONDARY")}
  ${summaryTable("Group Account Summary", group, "GROUP")}

  <div class="inline-metrics">
    <div>Inquiries in last 24 Months: <span>${esc(enquiries24)}</span></div>
    <div>New Account(s) in last 6 Months: <span>${esc(newAccounts6)}</span></div>
    <div>New Delinquent Account(s) in last 6 Months: <span>${esc(newDelinquent6)}</span></div>
  </div>

  <!-- ACCOUNT INFORMATION -->
  <section class="section">
    <div class="section-title">Account Information</div>
    ${accountsHtml}
    ${securityHtml}
  </section>

  <!-- LENDER INQUIRIES (page 3) -->
  <div class="page-break"></div>

  <section class="section">
    <div class="section-title">Inquiry Done by Lenders (Reported For Past 24 Months)</div>
    ${enquiryHtml}
  </section>

  <!-- DISCLAIMER (page 4) -->
  <div class="page-break"></div>

  <div class="disclaimer">
    <strong>Disclaimer:</strong> This document is prepared based on the data submitted by member
    institutions of CRIF High Mark Credit Information Services Private Limited (CRIF High Mark) and
    by using the proprietary match logic of CRIF High Mark. No alterations are made to the data
    submitted by member institutions and the same is up to date as well as accurate to the best of
    its knowledge. By using data contained in this document, the user acknowledges that CRIF High
    Mark is not responsible for errors/omissions resulting from submission of erroneous data from
    Members to CRIF High Mark. Any paper copy of this document will be considered uncontrolled. If
    you are not the intended recipient, you are not authorized to read, print, retain, copy,
    disseminate, distribute or use this information or any part thereof. PERFORM score provided in
    this document is joint work of CRIF SPA (Italy) and CRIF High Mark (India). For any assistance
    on this report, reach out to us at customerservice@crifhighmark.com
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

  const headerLabel = applicationId
    ? `CRIF_Credit_Report_${String(applicationId).replace(/[^a-zA-Z0-9_-]/g, "")}`
    : "CRIF_Credit_Report";

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
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");

    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,

      headerTemplate: `
        <div style="width:100%; font-size:8px; color:#777; text-align:right;
                    padding:0 12mm; font-family:Arial,Helvetica,sans-serif;">
          ${esc(headerLabel)}
        </div>`,

      footerTemplate: `
        <div style="width:100%; font-size:7px; color:#777; padding:0 12mm;
                    font-family:Arial,Helvetica,sans-serif;
                    display:flex; justify-content:space-between;">
          <span style="flex:1;">© Copyright ${new Date().getFullYear()}. All rights reserved</span>
          <span style="flex:1.4; text-align:center;">CRIF High Mark Credit Information Services Pvt. Ltd.</span>
          <span style="flex:1; text-align:center;">Confidential</span>
          <span style="flex:0.3; text-align:right;">
            <span class="pageNumber"></span>/<span class="totalPages"></span>
          </span>
        </div>`,

      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
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
