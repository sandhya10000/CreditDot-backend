const axios = require("axios");

// GraphQL queries exactly as per IndiConnect docs
const CIBIL_QUERY = `mutation VerifyBureauB($input: VerifyInput!) {
  verify(input: $input) {
    ok
    message
    status
    result {
      ... on BTBureauBResult {
        txn_id
        api_category
        api_name
        billable
        message
        status
        datetime
        client_id
        htmlUrl
        cibilData
      }
    }
    error {
      status
      message
      raw
    }
  }
}`;

const CRIF_QUERY = `mutation VerifyBureauC($input: VerifyInput!) {
  verify(input: $input) {
    ok
    message
    status
    result {
      ... on BTBureauCResult {
        txn_id
        api_category
        api_name
        billable
        message
        status
        datetime
        bureauData
      }
    }
    error {
      status
      message
    }
  }
}`;

const EXPERIAN_QUERY = `mutation VerifyBureauV3($input: VerifyInput!) {
  verify(input: $input) {
    ok
    message
    status
    result {
      ... on BTBureauV3Result {
        txn_id
        api_category
        api_name
        billable
        message
        status
        datetime
        name
        father_name
        pan
        mobile
        credit_score
        credit_report
      }
    }
    error {
      status
      message
      raw
    }
  }
}`;

// Experian Soft-Pull (Credit Bureau_S): inline input, no $variables.
// Requires myAppId header + consent block + dob/pincode.
const EXPERIAN_SP_RESULT_SET = `
        Header {
          SystemCode
          MessageText
          ReportDate
          ReportTime
        }
        UserMessage {
          UserMessageText
        }
        CreditProfileHeader {
          ReportDate
          ReportTime
          Version
          ReportNumber
        }
        Match_result {
          Exact_match
        }
        TotalCAPS_Summary {
          TotalCAPSLast7Days
          TotalCAPSLast30Days
          TotalCAPSLast90Days
          TotalCAPSLast180Days
        }
        SCORE {
          FCIREXScore
          FCIREXScoreConfidLevel
        }
        CAIS_Account {
          CAIS_Summary
          CAIS_Account_DETAILS
        }
        CAPS {
          CAPS_Summary
          CAPS_Application_Details
        }
        NonCreditCAPS {
          NonCreditCAPS_Summary
          CAPS_Application_Details
        }
        Current_Application {
          Current_Application_Details
        }
        excelExperianReport`;

const buildExperianSpQuery = ({ firstName, lastName, mobile, panNumber, dob, pincode, consentIp, consentMessageId, consentTimestamp }) => {
  const q = (v) => JSON.stringify(v ?? "");
  const ts = Number(consentTimestamp) || Math.floor(Date.now() / 1000);
  // consentMessageId must be the approved ID "CM_1" — generated values
  // like CM_<timestamp> are rejected with "Invalid consent message Id".
  const msgId = consentMessageId || "CM_1";
  // consentIpAddress must be dotted-IPv4 — normalize Express-style values.
  const ip = normalizeConsentIpValue(consentIp);
  return `mutation {
  verify(
    input: {
      documentType: "Experian Credit Bureau_S"
      mobile: ${q(mobile)}
      panNumber: ${q(String(panNumber || "").toUpperCase())}
      firstName: ${q(firstName)}
      lastName: ${q(lastName)}
      dob: ${q(dob)}
      pincode: ${q(pincode)}
      consent: {
        consentFlag: true
        consentTimestamp: ${ts}
        consentIpAddress: ${q(ip)}
        consentMessageId: ${q(msgId)}
      }
    }
  ) {
    status
    ok
    message
    result {
      __typename
      ... on ExperianCreditReportResult {${EXPERIAN_SP_RESULT_SET}
      }
    }
    error {
      decryptedError
    }
  }
}`;
};

const getBaseUrl = () =>
  (process.env.INDICONNECT_BASE_URL || "https://api.ccs.indiconnect.in").replace(
    /\/$/,
    ""
  );

const getEndpoint = (specific, fallback = "/idverifygr/verification") => {
  const ep = String(specific || fallback).trim();
  return ep.startsWith("/") ? ep : `/${ep}`;
};

// Provider code resolution per bureau (explicit code first, then siblings).
const getProviderCodeFor = (bureau) => {
  if (bureau === "crif") {
    return (
      process.env.INDICONNECT_CRIF_PROVIDER_CODE ||
      process.env.INDICONNECT_EXPERIAN_PROVIDER_CODE ||
      process.env.INDICONNECT_CIBIL_PROVIDER_CODE ||
      process.env.INDICONNECT_PROVIDERCODE ||
      ""
    );
  }
  if (bureau === "experian") {
    return (
      process.env.INDICONNECT_EXPERIAN_PROVIDER_CODE ||
      process.env.INDICONNECT_CRIF_PROVIDER_CODE ||
      process.env.INDICONNECT_CIBIL_PROVIDER_CODE ||
      process.env.INDICONNECT_PROVIDERCODE ||
      ""
    );
  }
  return getCibilProviderCode();
};

// Provider code resolution for CIBIL:
// explicit CIBIL code -> experian code -> crif code -> generic -> docs sample
const getCibilProviderCode = () =>
  process.env.INDICONNECT_CIBIL_PROVIDER_CODE ||
  process.env.INDICONNECT_EXPERIAN_PROVIDER_CODE ||
  process.env.INDICONNECT_CRIF_PROVIDER_CODE ||
  process.env.INDICONNECT_PROVIDERCODE ||
  "";

const getAuthHeader = () => {
  // Docs: Authorization: x-api-access indc_live_...:ac_live_...
  const indc =
    process.env.INDICONNECT_SECRET_KEY ||
    process.env.INDICONNECT_INDC_KEY ||
    "";
  const ac = process.env.INDICONNECT_ACCESS_KEY || "";
  if (process.env.INDICONNECT_AUTH) return process.env.INDICONNECT_AUTH;
  if (indc && ac) return `x-api-access ${indc}:${ac}`;
  return "";
};

const buildHeaders = (providerCode) => {
  const headers = { "Content-Type": "application/json" };
  if (process.env.INDICONNECT_SERVICE_KEY) {
    headers["service-key"] = process.env.INDICONNECT_SERVICE_KEY;
  }
  const auth = getAuthHeader();
  if (auth) headers["Authorization"] = auth;
  const pc = providerCode || getCibilProviderCode();
  if (pc) headers["providercode"] = pc;
  return headers;
};

const buildCibilPayload = ({ pan, name, mobile }) => ({
  query: CIBIL_QUERY,
  variables: {
    input: {
      documentType: "bureau-verification-cibil",
      pan: (pan || "").toUpperCase(),
      name: name || "",
      mobile: mobile || "",
    },
  },
});

const buildCrifPayload = ({ pan, name, mobile }) => ({
  query: CRIF_QUERY,
  variables: {
    input: {
      documentType: "bureau-verification-crif",
      name: name || "",
      mobile: mobile || "",
      ...(pan ? { pan: String(pan).toUpperCase() } : {}),
    },
  },
});

const buildExperianPayload = ({ pan, name, mobile }) => ({
  query: EXPERIAN_QUERY,
  variables: {
    input: {
      documentType: "bureau-verification-v3-experian",
      pan: (pan || "").toUpperCase(),
      ...(name ? { name } : {}),
      ...(mobile ? { mobile } : {}),
    },
  },
});

// "FIRST MIDDLE LAST" -> { firstName, lastName }. Requires ≥2 words.
const splitFullName = (fullName) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

const getExperianAppId = () =>
  process.env.INDICONNECT_EXPERIAN_MY_APP_ID || "";

// Gateway validates consentIpAddress as strict dotted-IPv4.
// Express req.ip is often ::1 or ::ffff:1.2.3.4 (no trust proxy here),
// both rejected — normalize, else fall back to proven 127.0.0.1.
const normalizeConsentIpValue = (raw) => {
  const v4 = String(raw || "")
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4;
  return "127.0.0.1";
};
const normalizeConsentIp = (req) =>
  normalizeConsentIpValue(
    req?.headers?.["x-forwarded-for"] || req?.ip || "",
  );

// Soft-Pull headers = standard headers + myAppId.
const buildExperianSpHeaders = (providerCode) => {
  const headers = buildHeaders(
    providerCode || process.env.INDICONNECT_EXPERIAN_PROVIDER_CODE || "",
  );
  const appId = getExperianAppId();
  if (appId) headers.myAppId = appId;
  return headers;
};

// Score lives inside cibilData.
// Live shape: Borrower.CreditScore.riskScore ("760"); be liberal with casings.
const extractCibilScore = (cibilData) => {
  if (!cibilData || typeof cibilData !== "object") return null;
  const tl =
    cibilData?.GetCustomerAssetsResponse?.GetCustomerAssetsSuccess?.Asset
      ?.TrueLinkCreditReport ||
    cibilData?.get_customer_assets_response?.get_customer_assets_success?.asset
      ?.true_link_credit_report ||
    null;
  const borrower = tl?.Borrower || tl?.borrower || null;
  const cs = borrower?.CreditScore || borrower?.credit_score || null;
  const candidates = [
    cs?.riskScore,
    cs?.risk_score,
    borrower?.credit_score?.riskScore,
    borrower?.credit_score?.risk_score,
    cibilData?.credit_score,
    cibilData?.risk_score,
    cibilData?.riskScore,
    cibilData?.score,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

// Direct PDF link when IndiConnect embeds one (S3 presigned, ~7-day expiry).
// Seen at cibilData.cibil_report_link; accept nearby variants.
const extractCibilPdfUrl = (cibilData) => {
  if (!cibilData || typeof cibilData !== "object") return null;
  return (
    cibilData.cibil_report_link ||
    cibilData.credit_report_link ||
    cibilData.report_link ||
    cibilData.pdf_url ||
    null
  );
};

// CRIF: score at bureauData.credit_report.SCORES.SCORE["SCORE-VALUE"],
// PDF at bureauData.credit_report_link (S3 presigned, ~24h expiry).
const parseCrifResponse = (resData) => {
  const verify = resData?.data?.verify || resData?.verify || null;
  const result = verify?.result || null;
  const bureauData = result?.bureauData || null;
  const report = bureauData?.credit_report || null;
  const scoreNode = report?.SCORES?.SCORE || null;
  const rawScore = Array.isArray(scoreNode)
    ? scoreNode[0]?.["SCORE-VALUE"]
    : scoreNode?.["SCORE-VALUE"];
  const n = Number(rawScore);
  return {
    ok: verify?.ok === true,
    status: verify?.status,
    message: verify?.message || result?.message || null,
    bureauStatus: result?.status ?? null,
    bureauMessage: result?.message || null,
    error: verify?.error || null,
    txn_id: result?.txn_id || null,
    hasResult: !!result,
    score: Number.isFinite(n) && n > 0 ? n : null,
    reportUrl:
      bureauData?.credit_report_link ||
      report?.credit_report_link ||
      report?.report_link ||
      null,
    bureauData,
    raw: resData,
  };
};

// Experian Soft-Pull parse: score = SCORE.FCIREXScore.
// Report arrives as base64 .xlsx (excelExperianReport); the platform renders
// its own styled PDF from the JSON instead.
const parseExperianSpResponse = (resData) => {
  const verify = resData?.data?.verify || resData?.verify || null;
  const result = verify?.result || null;
  const n = Number(result?.SCORE?.FCIREXScore);
  const errNode = verify?.error || null;
  const errMsg =
    (typeof errNode === "string" && errNode) ||
    errNode?.decryptedError ||
    errNode?.message ||
    null;
  return {
    ok: verify?.ok === true,
    status: verify?.status,
    message: verify?.message || result?.UserMessage?.UserMessageText || null,
    bureauStatus: verify?.status ?? null,
    bureauMessage: verify?.message || null,
    error: errMsg ? { message: errMsg, raw: errNode } : null,
    txn_id:
      result?.CreditProfileHeader?.ReportNumber != null
        ? String(result.CreditProfileHeader.ReportNumber)
        : null,
    hasResult: !!result,
    score: Number.isFinite(n) && n > 0 ? n : null,
    scoreConfidence: result?.SCORE?.FCIREXScoreConfidLevel ?? null,
    exactMatch: result?.Match_result?.Exact_match ?? null,
    header: result?.Header || null,
    userMessage: result?.UserMessage || null,
    totalCaps: result?.TotalCAPS_Summary || null,
    creditProfileHeader: result?.CreditProfileHeader || null,
    caisAccount: result?.CAIS_Account || null,
    caps: result?.CAPS || null,
    nonCreditCaps: result?.NonCreditCAPS || null,
    currentApplication: result?.Current_Application || null,
    excelBase64: result?.excelExperianReport || null,
    reportUrl: null,
    raw: resData,
  };
};

// Experian V3: credit_score + credit_report (URL string when the bureau
// returns a file, object/JSON otherwise — caller decides).
const parseExperianResponse = (resData) => {
  const verify = resData?.data?.verify || resData?.verify || null;
  const result = verify?.result || null;
  const n = Number(result?.credit_score);
  const cr = result?.credit_report ?? null;
  const reportUrl =
    typeof cr === "string" && /^https?:\/\//i.test(cr.trim()) ? cr.trim() : null;
  return {
    ok: verify?.ok === true,
    status: verify?.status,
    message: verify?.message || result?.message || null,
    bureauStatus: result?.status ?? null,
    bureauMessage: result?.message || null,
    error: verify?.error || null,
    txn_id: result?.txn_id || null,
    hasResult: !!result,
    score: Number.isFinite(n) && n > 0 ? n : null,
    reportUrl,
    creditReport: cr,
    raw: resData,
  };
};

const parseCibilResponse = (resData) => {
  const verify = resData?.data?.verify || resData?.verify || null;
  const result = verify?.result || null;
  const htmlUrl = result?.htmlUrl || null;
  const txn_id = result?.txn_id || null;
  const cibilData = result?.cibilData || null;
  const score = extractCibilScore(cibilData);
  const pdfUrl = extractCibilPdfUrl(cibilData);
  return {
    ok: verify?.ok === true,
    status: verify?.status,
    message: verify?.message || result?.message || null,
    // Bureau-level outcome: 1 = Success, 2 = No Record Found, etc.
    bureauStatus: result?.status ?? null,
    bureauMessage: result?.message || null,
    error: verify?.error || null,
    txn_id,
    hasResult: !!result,
    htmlUrl,
    pdfUrl,
    score,
    cibilData,
    raw: resData,
  };
};

const isHtmlReportUrl = (url) =>
  typeof url === "string" &&
  (url.includes("myscore.cibil.com") || url.includes("webtoken"));

// Returns a failure message when an IndiConnect bureau result is unusable
// (transport-level error, or a null/empty result envelope like the
// "ok:true + result:null" shape). Returns null when there is data worth
// saving (including bureau-level no-record outcomes, which still carry
// txn_id + message). Prevents saving empty reports and deducting credits.
const indiconnectFailed = (parsed) => {
  if (!parsed) return "empty provider response";
  if (!parsed.hasResult) {
    return (
      parsed?.error?.message ||
      parsed?.bureauMessage ||
      parsed?.message ||
      "provider returned no result"
    );
  }
  if (!parsed.ok && parsed.error) {
    return (
      parsed.error.message || parsed.message || "provider check failed"
    );
  }
  return null;
};

const makeCibilRequest = async (
  { pan, name, mobile },
  { providerCode, timeout = 60000 } = {}
) => {
  const baseUrl = getBaseUrl();
  const endpoint = getEndpoint(
    process.env.INDICONNECT_CIBIL_ENDPOINT ||
      process.env.INDICONNECT_EXPERIAN_ENDPOINT
  );
  const url = `${baseUrl}${endpoint}`;
  const headers = buildHeaders(providerCode);
  const payload = buildCibilPayload({ pan, name, mobile });
  const response = await axios.post(url, payload, { headers, timeout });
  return response;
};

module.exports = {
  CIBIL_QUERY,
  CRIF_QUERY,
  EXPERIAN_QUERY,
  getBaseUrl,
  getEndpoint,
  getCibilProviderCode,
  getProviderCodeFor,
  buildHeaders,
  buildCibilPayload,
  buildCrifPayload,
  buildExperianPayload,
  buildExperianSpQuery,
  splitFullName,
  getExperianAppId,
  normalizeConsentIpValue,
  normalizeConsentIp,
  buildExperianSpHeaders,
  extractCibilScore,
  extractCibilPdfUrl,
  parseCibilResponse,
  parseCrifResponse,
  parseExperianResponse,
  parseExperianSpResponse,
  indiconnectFailed,
  isHtmlReportUrl,
  makeCibilRequest,
};
