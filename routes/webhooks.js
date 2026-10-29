const express = require("express");
const router = express.Router();
const { handleWasimpleWebhook, verifyWasimpleWebhook } = require("../controllers/whatsappWebhookController");

// Public endpoint for WaSimple/Meta callbacks, protected by WHATSAPP_WEBHOOK_SECRET
router.get("/wasimple", verifyWasimpleWebhook);
router.post("/wasimple", handleWasimpleWebhook);

module.exports = router;
