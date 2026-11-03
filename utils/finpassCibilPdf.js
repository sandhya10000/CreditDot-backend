// Maps the Finpass CIBIL payload (body.data.results.cibil.data) into the model
// that templates/cibilReport.template.js renders. Same model shape that
// cibilPdfService.prepareCibilPdfData produces for the TrueLink (Digi/IndiConnect) data.

const { renderCibilPdf } = require("./cibilPdfService");

// Finpass uses "-1" / "NA" / "" for "not reported"
const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text === "-1" || text === "-1.00" || text.toUpperCase() === "NA") return null;
  return value;
};

const titleCase = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

const joinParts = (...parts) => parts.map((p) => (p ? String(p).trim() : "")).filter(Boolean).join(", ");

const buildBorrower = (cibilData, report) => {
  const name = report?.names?.[0] || {};
  const fullName = name.name || cibilData.name || null;

  return {
    borrowerKey: report?.control_number || "-",
    fullName,
    name: fullName,
    dob: clean(name.birthDate),
    gender: titleCase(name.gender || cibilData.gender),
    emails: (report?.emails || []).map((e) => ({ email: e.emailID })),
    phones: (report?.telephones || []).map((t) => ({
      number: t.telephoneNumber,
      type: t.telephoneType === "01" ? "Residence" : t.telephoneType || null,
    })),
    addresses: (report?.addresses || []).map((a) => ({
      address: joinParts(a.line1, a.line2, a.pinCode),
      category: a.addressCategory,
      residenceCode: clean(a.residence_code),
      reportedDate: clean(a.dateReported),
    })),
    identifiers: (report?.ids || []).map((i) => ({
      type: i.idType,
      value: i.idNumber,
    })),
  };
};

const buildScore = (cibilData, report, score) => {
  const scoreRecord = report?.scores?.[0] || {};

  return {
    value: score,
    model: scoreRecord.scoreCardName || null,
    scoreName: scoreRecord.scoreName || null,
    populationRank: "-",
    scoringFactors: (scoreRecord.reasonCodes || [])
      .filter((r) => String(r.reasonCodeValue) !== "00")
      .map((r) => r.reasonCodeName),
  };
};

const buildEmployment = (report) => ({
  all: (report?.employment || []).map((e) => ({
    accountType: e.accountType,
    employer: clean(e.name),
    dateReported: clean(e.dateReported),
    occupationCode: clean(e.occupationCode),
    income: clean(e.income),
    netGrossIndicator: clean(e.net_gross_income_indicator),
    monthlyAnnualIndicator: clean(e.monthly_annual_income_indicator),
  })),
});

const buildAccounts = (report) =>
  (report?.accounts || []).map((a) => ({
    creditorName: a.memberShortName,
    accountNumber: a.accountNumber,
    accountType: a.accountType,
    ownership: a.ownershipIndicator,
    dateOpened: clean(a.dateOpened),
    dateReported: clean(a.dateReported),
    dateClosed: clean(a.dateClosed),
    dateLastPayment: clean(a.lastPaymentDate),
    paymentHistoryStart: clean(a.paymentStartDate),
    paymentHistoryEnd: clean(a.paymentEndDate),
    highCreditAmount: clean(a.highCreditAmount),
    creditLimit: clean(a.credit_limit),
    cashLimit: clean(a.cash_limit),
    currentBalance: clean(a.currentBalance),
    amountPastDue: clean(a.amountOverdue),
    actualPaymentAmount: clean(a.actualPaymentAmount),
    emi: clean(a.emiAmount),
    repaymentTenure: clean(a.repaymentTenure),
    paymentFrequency: clean(a.paymentFrequency),
    interestRate: clean(a.interest_rate),
    collateralType: clean(a.collateral_type),
    collateralValue: clean(a.collateral_value),
    writtenOffPrincipal: clean(a.woAmountPrincipal),
    writtenOff: clean(a.woAmountTotal),
    settlementAmount: clean(a.settlementAmount),
    suitFiledWilfulDefault: clean(a.suitFiledWillfulDefaultWrittenOff),
    creditFacilityStatus: clean(a.creditFacilityStatus),
    paymentHistory: (a.monthlyPayStatus || []).map((m) => ({
      date: m.date,
      status: m.status,
    })),
  }));

const buildInquiries = (report) =>
  (report?.enquiries || []).map((e) => ({
    subscriberName: e.memberShortName,
    inquiryDate: e.enquiryDate,
    inquiryType: e.enquiryPurpose,
    amount: clean(e.enquiryAmount),
  }));

const buildSummary = (report) => {
  const s = report?.response?.consumerSummaryresp?.accountSummary || {};
  return {
    totalAccounts: s.totalAccounts,
    highCreditAmount: s.highCreditAmount,
    totalCurrentBalance: s.currentBalance,
    totalPastDue: s.overdueBalance,
    overdueAccounts: s.overdueAccounts,
    zeroBalanceAccounts: s.zeroBalanceAccounts,
    recentDateOpened: s.recentDateOpened,
    oldestDateOpened: s.oldestDateOpened,
  };
};

const buildEnquirySummary = (report) => {
  const i = report?.response?.consumerSummaryresp?.inquirySummary || {};
  return {
    total: i.totalInquiry,
    past30Days: i.inquiryPast30Days,
    past12Months: i.inquiryPast12Months,
    past24Months: i.inquiryPast24Months,
    recentDate: i.recentInquiryDate,
  };
};

// cibilData = body.data.results.cibil.data (credit_score, credit_report[], name, pan, ...)
// score = parsed numeric score from finpassClient.parseCibilResponse
const prepareFinpassCibilPdfData = (cibilData, score, creditReportId) => {
  const report = Array.isArray(cibilData?.credit_report) ? cibilData.credit_report[0] : null;
  const now = new Date();

  return {
    creditReportId,
    referenceKey: report?.control_number || "-",
    reportVersion: "-",
    generatedAt: now.toISOString(),
    generatedTime: now.toISOString(),
    borrower: buildBorrower(cibilData || {}, report),
    score: buildScore(cibilData || {}, report, score),
    employment: buildEmployment(report),
    accounts: buildAccounts(report),
    inquiries: buildInquiries(report),
    summary: buildSummary(report),
    enquirySummary: buildEnquirySummary(report),
    creditSummary: {},
    bureauStatus: {},
    parseWarnings: [],
  };
};

// Renders the styled CIBIL PDF for a Finpass report. Returns the same shape as generateCibilPdf.
const generateFinpassCibilPdf = (cibilData, score, creditReportId) =>
  renderCibilPdf(prepareFinpassCibilPdfData(cibilData, score, creditReportId), creditReportId);

module.exports = {
  prepareFinpassCibilPdfData,
  generateFinpassCibilPdf,
};
