const express = require("express");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");
const {
  createManualPayment,
  listManualPayments,
  refreshManualPayment,
  cancelManualPayment,
} = require("../controllers/manualPaymentController");

const router = express.Router();

// All routes are admin-only; staff need the "finance" permission (see config/permissions.js)
router.use(auth, rbac("admin"));

// @route   GET /api/admin/manual-payments
router.get("/", listManualPayments);

// @route   POST /api/admin/manual-payments
router.post("/", createManualPayment);

// @route   POST /api/admin/manual-payments/:id/refresh
router.post("/:id/refresh", refreshManualPayment);

// @route   POST /api/admin/manual-payments/:id/cancel
router.post("/:id/cancel", cancelManualPayment);

module.exports = router;
