// Manual test: sends credit_report_link_template to one number.
// Usage: node scripts/testReportLinkTemplate.js <mobile> <name> <score> <fileName>
// Example: node scripts/testReportLinkTemplate.js 7678126262 Karan 123 report.pdf
require("dotenv").config();
const axios = require("axios");

const [mobile, name, score, fileName] = process.argv.slice(2);
if (!mobile || !name || !score || !fileName) {
  console.error("Usage: node scripts/testReportLinkTemplate.js <mobile> <name> <score> <fileName>");
  process.exit(1);
}

const baseUrl = (process.env.WHATSAPP_BASE_URL || "https://app.wasimple.in").replace(/\/$/, "");
const headers = { "x-api-key": process.env.WHATSAPP_API_KEY, "Content-Type": "application/json" };
if (process.env.WHATSAPP_PHONE_ID) headers["x-phone-id"] = process.env.WHATSAPP_PHONE_ID;

const payload = {
  templateName: process.env.WHATSAPP_REPORT_LINK_TEMPLATE || "credit_report_link",
  language: process.env.WHATSAPP_LANGUAGE || "en",
  to: `91${mobile.replace(/\D/g, "").slice(-10)}`,
  templateVariables: [name, score, fileName],
};

axios
  .post(`${baseUrl}/api/v1/whatsapp/sendMessage`, payload, { headers, timeout: 30000 })
  .then((res) => console.log("Sent:", JSON.stringify(res.data, null, 2)))
  .catch((err) => console.error("Failed:", JSON.stringify(err.response?.data || err.message, null, 2)));
