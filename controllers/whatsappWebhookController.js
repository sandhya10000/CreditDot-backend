const CreditReport = require("../models/CreditReport");
const CreditRepair = require("../models/CreditRepair");
const googleSheetsService = require("../utils/googleSheetsService");
const { sendCreditRepairFormEmail } = require("../utils/emailService");
const whatsappService = require("../utils/whatsappService");

const SUPPORT_BUTTON_TEXT = "contact support";

// Meta webhook format: entry[].changes[].value.messages[]
// Quick-reply taps arrive as type "button" (button.text/payload) or type "interactive" (button_reply.title).
// Falls back to flat fields for other providers.
const parseIncoming = (body = {}) => {
  const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg) {
    const text = msg.button?.text || msg.button?.payload || msg.interactive?.button_reply?.title || msg.interactive?.button_reply?.id || msg.text?.body || "";
    return { from: String(msg.from || ""), text: String(text).trim().toLowerCase() };
  }
  const from = body.from || body.sender || body.mobile || body.phone || body.data?.from || "";
  const button = body.button || body.data?.button || {};
  const text = button.text || button.payload || body.text || body.data?.text || "";
  return { from: String(from), text: String(text).trim().toLowerCase() };
};

// GET /api/webhooks/wasimple
// Meta sends a verification request when the URL is registered; echo hub.challenge back.
exports.verifyWasimpleWebhook = (req, res) => {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === secret) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
};

// POST /api/webhooks/wasimple
// Called by WaSimple when a customer taps the "Contact Support" button.
exports.handleWasimpleWebhook = async (req, res) => {
  // Always reply 200 quickly so the provider doesn't retry; errors are logged.
  res.status(200).json({ received: true });

  try {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (!secret || (req.headers["x-webhook-secret"] || req.query.secret) !== secret) {
      console.warn("WaSimple webhook rejected: bad or missing secret");
      return;
    }

    const { from, text } = parseIncoming(req.body);
    if (!from || !text.includes(SUPPORT_BUTTON_TEXT)) return;

    const mobile = from.replace(/\D/g, "").slice(-10);

    // Latest public report for this number that triggered the low-score prompt
    const report = await CreditReport.findOne({
      isPublic: true,
      mobile,
      lowScorePromptSentAt: { $ne: null },
    }).sort({ createdAt: -1 });

    if (!report) return;
    if (report.supportLeadId) return; // already created for this report (dedupe)

    const lead = await CreditRepair.create({
      fullName: report.name,
      email: report.email,
      mobileNumber: mobile,
      state: report.state || "Not provided",
      city: report.city,
      occupation: report.occupation,
      language: report.language,
      creditScore: String(report.score),
      problemType: "Low credit score (WhatsApp)",
      message: "Auto-created from free credit report; user tapped Contact Support on WhatsApp",
      status: "New",
    });

    report.supportLeadId = lead._id;
    await report.save();

    try {
      await sendCreditRepairFormEmail(lead);
    } catch (emailError) {
      console.error("Support lead email failed:", emailError.message);
    }

    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncCreditRepairData();
    } catch (syncError) {
      console.error("Support lead Sheets sync failed:", syncError.message);
    }

    await whatsappService.sendText({
      mobile,
      text: `Thanks for contacting CreditDost support, ${report.name}. Our team will contact you shortly.`,
    });
  } catch (error) {
    console.error("WaSimple webhook error:", error.response?.data || error.message);
  }
};
