const axios = require("axios");
const { getFinpassConfig } = require("./finpassClient");

const PREFILL_BY_MOBILE_PATH = "/api/v1/services/prefill-by-mobile/fetch";

// Returns the raw Finpass body. Throws on transport/provider errors; a "no record"
// answer comes back as a body with no prefill data, which the caller treats as a mismatch.
const fetchPrefillByMobile = async (mobile) => {
  const cfg = getFinpassConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    const err = new Error("Finpass credentials not configured");
    err.code = "FINPASS_NOT_CONFIGURED";
    throw err;
  }

  const { data } = await axios.post(
    `${cfg.baseUrl}${PREFILL_BY_MOBILE_PATH}`,
    { mobile_number: mobile },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": cfg.apiKey,
        "X-API-Secret": cfg.apiSecret,
      },
      timeout: 30000,
    },
  );
  return data;
};

module.exports = { fetchPrefillByMobile };
