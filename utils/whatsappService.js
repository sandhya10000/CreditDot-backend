const axios = require("axios");

// WaSimple WhatsApp Business API client.
// Endpoint: POST {WHATSAPP_BASE_URL}/api/v1/whatsapp/sendMessage
// Auth: x-api-key header. Phone ID header is only needed when the account has multiple numbers.

const DEFAULT_BASE_URL = "https://app.wasimple.in";

// Mobile numbers are stored as 10 digits; WhatsApp needs country code, no "+".
const normalizeMobile = (mobile) => {
  const digits = String(mobile).replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
};

const sendTemplateMessage = async (payload) => {
  const baseUrl = (process.env.WHATSAPP_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey = process.env.WHATSAPP_API_KEY;

  if (!apiKey) {
    throw new Error("WHATSAPP_API_KEY is not configured");
  }

  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };
  if (process.env.WHATSAPP_PHONE_ID) {
    headers["x-phone-id"] = process.env.WHATSAPP_PHONE_ID;
  }

  const response = await axios.post(`${baseUrl}/api/v1/whatsapp/sendMessage`, payload, {
    headers,
    timeout: 30000,
  });
  return response.data;
};

// Sends the OTP using the Authentication template (body variable {{1}} = OTP).
exports.sendOtp = async (mobile, otp) => {
  return sendTemplateMessage({
    templateName: process.env.WHATSAPP_OTP_TEMPLATE || "otp_template",
    language: "en",
    to: normalizeMobile(mobile),
    templateVariables: [String(otp)],
  });
};

// Sends the report PDF using the Utility template with a Document header.
// templateVariables: [{{1}} = customer name, {{2}} = credit score]
exports.sendReportDocument = async ({ mobile, fileUrl, name, score }) => {
  return sendTemplateMessage({
    templateName: process.env.WHATSAPP_REPORT_TEMPLATE || "credit_report_template",
    language: "en",
    to: normalizeMobile(mobile),
    fileUrl,
    templateVariables: [String(name), String(score ?? "N/A")],
  });
};

// Sends the report as a text message with a "View Report" button.
// Body: {{1}} = name, {{2}} = score. Button URL: .../reports/{{1}} -> fileName.
exports.sendReportLink = async ({ mobile, name, score, fileName }) => {
  return sendTemplateMessage({
    templateName: process.env.WHATSAPP_REPORT_LINK_TEMPLATE || "credit_report_link",
    language: "en",
    to: normalizeMobile(mobile),
    templateVariables: [String(name), String(score ?? "N/A"), String(fileName)],
  });
};

// Sends the assigned RM's details to an approved partner (text-only template, no header).
exports.sendRmDetails = async ({ mobile, partnerName, rmName, rmMobile, rmEmail }) => {
  return sendTemplateMessage({
    templateName: process.env.WHATSAPP_RM_TEMPLATE || "rm_details_template",
    language: "en",
    to: normalizeMobile(mobile),
    templateVariables: [partnerName, rmName, rmMobile, rmEmail].map((v) => String(v || "N/A")),
  });
};

exports.normalizeMobile = normalizeMobile;
