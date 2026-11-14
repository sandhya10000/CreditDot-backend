const axios = require("axios");

// Finpass multi-bureau fetch. Credentials come from .env (FINPASS_BASE_URL,
// FINPASS_API_KEY, FINPASS_API_SECRET) and are only used by the admin CIBIL option.
const FINPASS_MULTI_BUREAU_PATH = "/api/v1/services/multi-bureau/fetch";

const getFinpassConfig = () => ({
  baseUrl: String(process.env.FINPASS_BASE_URL || "https://api.finpass.ai").replace(/\/$/, ""),
  apiKey: process.env.FINPASS_API_KEY,
  apiSecret: process.env.FINPASS_API_SECRET,
});

// Bureau keys Finpass accepts in the `bureaus` array (our internal names)
const FINPASS_BUREAUS = ["cibil", "crif", "experian", "equifax"];

// Requests one bureau's report (default CIBIL) from Finpass
const fetchBureauReport = async ({ pan, name, mobile, gender, bureau = "cibil" }) => {
  if (!FINPASS_BUREAUS.includes(bureau)) {
    throw new Error(`Finpass does not support bureau: ${bureau}`);
  }
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
      bureaus: [bureau],
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

// Pulls score, report link and the raw bureau data out of the Finpass response.
// Shape: body.data.results.<bureau>.{ credit_report_link, data: { credit_score, credit_report: [...] } }
const parseBureauResponse = (body, bureau = "cibil") => {
  const root = body?.data ?? body ?? {};
  const section = root.results?.[bureau] ?? root[bureau] ?? null;
  const bureauData = section?.data ?? {};
  const report = Array.isArray(bureauData.credit_report) ? bureauData.credit_report[0] : null;

  const rawScore =
    bureauData.credit_score ?? report?.scores?.[0]?.score ?? section?.score ?? null;
  const score = rawScore == null || rawScore === "" ? null : Number(rawScore) || null;

  const reportUrl = section?.credit_report_link ?? root.pdf_url ?? null;

  return { score, reportUrl, cibilData: bureauData };
};

// CIBIL-only wrappers kept for the existing CIBIL call sites
const fetchCibilReport = (params) => fetchBureauReport({ ...params, bureau: "cibil" });
const parseCibilResponse = (body) => parseBureauResponse(body, "cibil");

module.exports = {
  getFinpassConfig,
  fetchCibilReport,
  fetchBureauReport,
  parseCibilResponse,
  parseBureauResponse,
};
