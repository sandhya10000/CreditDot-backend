// Throwaway live test for IndiConnect CRIF + Experian (uses .env, no DB writes).
// Run: node testIndiconnectBureaus.js [crif|experian|both] [pan] [name] [mobile]
// Defaults: docs samples (CRIF: Tukaram Waghmare/9657551465, Experian: AFJPW8626A)
require("dotenv").config();
const axios = require("axios");
const client = require("./utils/indiconnectApiClient");

const which = process.argv[2] || "both";
const pan = process.argv[3] || "AFJPW8626A";
const name = process.argv[4] || "Tukaram Waghmare";
const mobile = process.argv[5] || "9657551465";

const post = async (bureau, payload) => {
  const baseUrl = client.getBaseUrl();
  const epKey =
    bureau === "crif"
      ? process.env.INDICONNECT_CRIF_ENDPOINT
      : process.env.INDICONNECT_EXPERIAN_ENDPOINT;
  const ep = client.getEndpoint(epKey);
  const pc = client.getProviderCodeFor(bureau);
  const url = `${baseUrl}${ep}`;
  const headers = client.buildHeaders(pc);
  console.log(`\n--- ${bureau.toUpperCase()} -> ${url} (pc ${pc.slice(0, 3)}...${pc.slice(-3)}) ---`);
  const res = await axios.post(url, payload, { headers, timeout: 60000 });
  return res.data;
};

(async () => {
  console.log("HAS service-key:", !!process.env.INDICONNECT_SERVICE_KEY);
  console.log("HAS indc/ac:", !!process.env.INDICONNECT_SECRET_KEY, !!process.env.INDICONNECT_ACCESS_KEY);

  if (which === "crif" || which === "both") {
    try {
      const data = await post("crif", client.buildCrifPayload({ pan, name, mobile }));
      const p = client.parseCrifResponse(data);
      console.log("CRIF ok:", p.ok, "score:", p.score, "pdf:", p.reportUrl ? p.reportUrl.slice(0, 90) + "..." : null);
      console.log("CRIF bureau:", p.bureauStatus + "/" + p.bureauMessage, "txn:", p.txn_id);
      if (p.error) console.log("CRIF error:", JSON.stringify(p.error).slice(0, 300));
    } catch (e) {
      console.log("CRIF FAIL:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 500));
    }
  }

  if (which === "experian" || which === "both") {
    // Soft-Pull flow (inline input + myAppId), per Experian Credit Bureau_S doc
    try {
      const split = (() => {
        const parts = String(name).trim().split(/\s+/);
        return { firstName: parts[0], lastName: parts.slice(1).join(" ") || parts[0] };
      })();
      const query = client.buildExperianSpQuery({
        firstName: split.firstName,
        lastName: split.lastName,
        mobile,
        panNumber: pan,
        dob: "1996-12-09",
        pincode: "425508",
        consentIp: "127.0.0.1",
      });
      const baseUrl = client.getBaseUrl();
      const ep = client.getEndpoint(process.env.INDICONNECT_EXPERIAN_ENDPOINT);
      const pc = client.getProviderCodeFor("experian");
      const url = `${baseUrl}${ep}`;
      const headers = client.buildExperianSpHeaders(pc);
      const appId = process.env.INDICONNECT_EXPERIAN_MY_APP_ID;
      if (appId) headers.myAppId = appId;
      console.log(`\n--- EXPERIAN-SP -> ${url} (pc ${pc.slice(0, 3)}...${pc.slice(-3)}, app ${appId}) ---`);
      const res = await axios.post(url, { query, variables: {} }, { headers, timeout: 60000 });
      const p = client.parseExperianSpResponse(res.data);
      console.log("EXP-SP ok:", p.ok, "score:", p.score, "conf:", p.scoreConfidence, "match:", p.exactMatch);
      console.log("EXP-SP txn/report:", p.txn_id, "excel:", p.excelBase64 ? `${p.excelBase64.length} chars` : null);
      if (p.error) console.log("EXP-SP error:", JSON.stringify(p.error).slice(0, 300));
      console.log("EXP-SP guard:", client.indiconnectFailed(p));
    } catch (e) {
      console.log("EXP-SP FAIL:", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 500));
    }
  }
})();
