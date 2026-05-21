const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  prefillByMobile,
  savePrefillFailure,
  getPrefillFailedLog,
} = require("../controllers/prefillController");

// POST /api/prefill
router.post("/prefill", prefillByMobile);
router.post("/save-prefill-failure", auth, savePrefillFailure);
router.get("/prefill-failed-logs", getPrefillFailedLog);
module.exports = router;
