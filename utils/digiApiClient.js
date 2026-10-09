// Digi CIBIL bureau client (VerifyHub-compatible contract).
//
// Provider call: POST {DIGI_BASE_URL}/api/v7/cibil-bureau-report
// Headers: { accept, Content-Type, jwt-token } where jwt-token is a fresh
// HS256 JWT per request: { timestamp: unixSec, partnerId, reqid: random }.
// Payload carries ONLY { fullname, mobile, pan (upper), consent: "Y" };
// email/gender/dob/address are stored in our DB, never sent to Digi v7.
const axios = require("axios");
const jwt = require("jsonwebtoken");

const DIGI_TIMEOUT_MS = 120000;
const DIGI_DEFAULT_ENDPOINT = "/api/v7/cibil-bureau-report";

// Fresh per-request auth token (<=5min validity contract).
const signDigiJwt = (partnerId, secretKey) => {
  const payload = {
    timestamp: Math.floor(Date.now() / 1000),
    partnerId: String(partnerId).trim(),
    reqid: Math.floor(Math.random() * 1e9),
  };
  return jwt.sign(payload, String(secretKey).trim());
};

const buildCibilPayload = ({ pan, name, mobile }) => ({
  fullname: name || "",
  mobile: mobile || "",
  pan: String(pan || "").toUpperCase(),
  consent: "Y",
});

// Score lives inside cibilData's TrueLinkCreditReport.
// Live shape: GetCustomerAssetsResponse.GetCustomerAssetsSuccess.Asset
//   .TrueLinkCreditReport.Borrower.CreditScore.riskScore — be liberal.
const extractDigiScore = (cibilData) => {
  if (!cibilData || typeof cibilData !== "object") return null;
  const gcar =
    cibilData?.GetCustomerAssetsResponse?.GetCustomerAssetsSuccess?.Asset
      ?.TrueLinkCreditReport ||
    cibilData?.get_customer_assets_response?.get_customer_assets_success?.asset
      ?.true_link_credit_report ||
    cibilData?.TrueLinkCreditReport ||
    cibilData?.true_link_credit_report ||
    null;
  const borrower = gcar?.Borrower || gcar?.borrower || null;
  const cs = borrower?.CreditScore || borrower?.credit_score || null;
  const candidates = [
    cs?.riskScore,
    cs?.risk_score,
    cibilData?.credit_score,
    cibilData?.risk_score,
    cibilData?.riskScore,
    cibilData?.score,
  ];
  for (const c of candidates) {
    const n = Number(c);
    // CIBIL scores are 300-900; anything outside is not a usable score
    if (Number.isFinite(n) && n >= 300 && n <= 900) return n;
  }
  return null;
};

// apiData shape: { data: { cibilData, message, ... }, ... }
const parseDigiResponse = (apiData) => {
  const data =
    apiData?.data && typeof apiData.data === "object" ? apiData.data : null;
  const cibilData = data?.cibilData || null;
  return {
    hasResult: !!cibilData,
    cibilData,
    score: extractDigiScore(cibilData),
    bureauMessage: data?.message || apiData?.message || null,
    raw: apiData,
  };
};

// Auth failures are free (no Failed row, no charge) — everything else
// persists a Failed row for history.
const isDigiAuthFailure = (status, message) =>
  status === 401 || /authentication failed/i.test(String(message || ""));

const makeCibilRequest = async (
  { pan, name, mobile },
  { baseUrl, partnerId, secretKey, endpoint, timeout = DIGI_TIMEOUT_MS } = {},
) => {
  const url = `${String(baseUrl).replace(/\/$/, "")}${endpoint || DIGI_DEFAULT_ENDPOINT}`;
  const token = signDigiJwt(partnerId, secretKey);
  const payload = buildCibilPayload({ pan, name, mobile });
  return axios.post(url, payload, {
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "jwt-token": token,
    },
    timeout,
  });
};

module.exports = {
  DIGI_TIMEOUT_MS,
  DIGI_DEFAULT_ENDPOINT,
  signDigiJwt,
  buildCibilPayload,
  extractDigiScore,
  parseDigiResponse,
  isDigiAuthFailure,
  makeCibilRequest,
};
