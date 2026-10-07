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

const getBaseUrl = () =>
  (process.env.INDICONNECT_BASE_URL || "https://api.ccs.indiconnect.in").replace(
    /\/$/,
    ""
  );

const getEndpoint = (specific, fallback = "/idverifygr/verification") => {
  const ep = specific || fallback;
  return ep.startsWith("/") ? ep : `/${ep}`;
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
  getBaseUrl,
  getEndpoint,
  getCibilProviderCode,
  buildHeaders,
  buildCibilPayload,
  extractCibilScore,
  extractCibilPdfUrl,
  parseCibilResponse,
  isHtmlReportUrl,
  makeCibilRequest,
};
