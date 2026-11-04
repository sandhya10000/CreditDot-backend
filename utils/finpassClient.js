const axios = require("axios");

// Finpass multi-bureau fetch. Credentials come from .env (FINPASS_BASE_URL,
// FINPASS_API_KEY, FINPASS_API_SECRET) and are only used by the admin CIBIL option.
const FINPASS_MULTI_BUREAU_PATH = "/api/v1/services/multi-bureau/fetch";

const getFinpassConfig = () => ({
  baseUrl: String(process.env.FINPASS_BASE_URL || "https://api.finpass.ai").replace(/\/$/, ""),
  apiKey: process.env.FINPASS_API_KEY,
  apiSecret: process.env.FINPASS_API_SECRET,
});

// Requests a CIBIL report only (bureaus: ["cibil"])
const fetchCibilReport = async ({ pan, name, mobile, gender }) => {
  const cfg = getFinpassConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    const err = new Error("Finpass credentials not configured");
    err.code = "FINPASS_NOT_CONFIGURED";
    throw err;
  }

  const { data } = await axios.post(
    `${cfg.baseUrl}${FINPASS_MULTI_BUREAU_PATH}`,
    {
      pan,
      name,
      mobile_number: mobile,
      consent: "Y",
      gender,
      bureaus: ["cibil"],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": cfg.apiKey,
        "X-API-Secret": cfg.apiSecret,
      },
      timeout: 60000,
    },
  );
  return data;
};

// Pulls score, report link and the raw CIBIL data out of the Finpass response.
// Shape: body.data.results.cibil.{ credit_report_link, data: { credit_score, credit_report: [...] } }
const parseCibilResponse = (body) => {
  const root = body?.data ?? body ?? {};
  const cibilSection = root.results?.cibil ?? root.cibil ?? null;
  const cibilData = cibilSection?.data ?? {};
  const report = Array.isArray(cibilData.credit_report) ? cibilData.credit_report[0] : null;

  const rawScore =
    cibilData.credit_score ?? report?.scores?.[0]?.score ?? cibilSection?.score ?? null;
  const score = rawScore == null || rawScore === "" ? null : Number(rawScore) || null;

  const reportUrl = cibilSection?.credit_report_link ?? root.pdf_url ?? null;

  return { score, reportUrl, cibilData };
};

module.exports = {
  getFinpassConfig,
  fetchCibilReport,
  parseCibilResponse,
};
