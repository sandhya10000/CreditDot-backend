// Throwaway live test for IndiConnect CIBIL (uses your .env, does NOT touch DB).
// Run: node testIndiconnect.js [pan] [name] [mobile] [providercode]
// Defaults: docs sample AFJPW8626A / Tukaram Waghmare / 9657551465
require("dotenv").config();
const client = require("./utils/indiconnectApiClient");
const axios = require("axios");

const pan = process.argv[2] || "AFJPW8626A";
const name = process.argv[3] || "Tukaram Waghmare";
const mobile = process.argv[4] || "9657551465";
const overridePc = process.argv[5] || null;

const codesToTry = overridePc
  ? [overridePc]
  : [
      process.env.INDICONNECT_CIBIL_PROVIDER_CODE,
      process.env.INDICONNECT_EXPERIAN_PROVIDER_CODE,
      process.env.INDICONNECT_CRIF_PROVIDER_CODE,
    ].filter(Boolean);

(async () => {
  console.log("BASE:", client.getBaseUrl());
  console.log("ENDPOINT:", client.getEndpoint(process.env.INDICONNECT_CIBIL_ENDPOINT || process.env.INDICONNECT_EXPERIAN_ENDPOINT));
  console.log("HAS service-key:", !!process.env.INDICONNECT_SERVICE_KEY);
  console.log("HAS indc:", !!process.env.INDICONNECT_SECRET_KEY, "HAS ac:", !!process.env.INDICONNECT_ACCESS_KEY);
  console.log("CODES TO TRY:", codesToTry.map((c) => `${c.slice(0, 3)}...${c.slice(-3)}`));

  for (const pc of codesToTry) {
    try {
      const baseUrl = client.getBaseUrl();
      const ep = client.getEndpoint(
        process.env.INDICONNECT_CIBIL_ENDPOINT ||
          process.env.INDICONNECT_EXPERIAN_ENDPOINT
      );
      const url = `${baseUrl}${ep}`;
      const headers = client.buildHeaders(pc);
      const payload = client.buildCibilPayload({ pan, name, mobile });
      console.log(`\n--- TRY providercode ${pc} ---`);
      const res = await axios.post(url, payload, { headers, timeout: 60000 });
      const parsed = client.parseCibilResponse(res.data);
      console.log("ok:", parsed.ok, "status:", parsed.status);
      console.log("txn_id:", parsed.txn_id);
      console.log("score:", parsed.score);
      console.log("htmlUrl:", parsed.htmlUrl ? parsed.htmlUrl.slice(0, 120) + "..." : null);
      console.log("message:", parsed.message);
      if (parsed.error) console.log("error:", JSON.stringify(parsed.error).slice(0, 500));
      if (parsed.ok && parsed.htmlUrl) {
        console.log("PASS with providercode", pc);
        break;
      }
    } catch (e) {
      console.log("FAIL:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 800));
    }
  }
})();
