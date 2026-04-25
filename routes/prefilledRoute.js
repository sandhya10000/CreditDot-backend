const express = require("express");
const router = express.Router();
const prefillController = require("../controllers/prefillController");

// POST /api/prefill
router.post("/prefill", prefillController.prefillByMobile);

module.exports = router;
