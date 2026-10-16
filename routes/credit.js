const express = require("express");
const {
  checkCreditScore,
  checkCreditScorePublic, // Add the new public function
  getCreditReports,
  getAllCreditReports,
  getCreditReportById,
  getSurepassApiKey,
  updateSurepassApiKey,
  getIndiconnectKeys,
  updateIndiconnectKeys,
  getDigiKeys,
  updateDigiKeys,
  getSingleCreditReports,
  checkCreditScoreV2,
  getFranchiseReports,
  generateExperianReport,
} = require("../controllers/creditController");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const router = express.Router();

// @route   POST /api/credit/check
// @desc    Check credit score
// @access  Private/Franchise User
router.post("/check", auth, rbac("franchise_user", "admin"), checkCreditScore);

// @route   POST /api/credit/check-public
// @desc    Check credit score (public endpoint for Experian only)
// @access  Public
router.post("/check-public", checkCreditScorePublic);

// @route   GET /api/credit/reports
// @desc    Get credit reports for franchise
// @access  Private/Franchise User
router.get("/reports", auth, rbac("franchise_user", "admin"), getCreditReports);

// @route   GET /api/credit/reports/all
// @desc    Get all credit reports
// @access  Private/Admin
router.get("/reports/all", auth, rbac("admin"), getAllCreditReports);
// @route   GET /api/credit/reports/franchise/:franchiseId
// @desc    Get particular franchise credit reports
// @access  Private/Admin
router.get(
  "/reports/franchise/:franchiseId",
  auth,
  rbac("admin"),
  getFranchiseReports,
);

// @route   GET /api/credit/reports/:id
// @desc    Get credit report by ID
// @access  Private
router.get("/reports/:id", auth, getCreditReportById);

// @route   GET /api/credit/settings/api-key
// @desc    Get Surepass API key
// @access  Private/Admin
router.get("/settings/api-key", auth, rbac("admin"), getSurepassApiKey);

// @route   PUT /api/credit/settings/api-key
// @desc    Update Surepass API key
// @access  Private/Admin
router.put("/settings/api-key", auth, rbac("admin"), updateSurepassApiKey);

// @route   GET /api/credit/settings/indiconnect-keys
// @desc    Get IndiConnect keys (masked)
// @access  Private/Admin
router.get(
  "/settings/indiconnect-keys",
  auth,
  rbac("admin"),
  getIndiconnectKeys,
);

// @route   PUT /api/credit/settings/indiconnect-keys
// @desc    Update IndiConnect keys
// @access  Private/Admin
router.put(
  "/settings/indiconnect-keys",
  auth,
  rbac("admin"),
  updateIndiconnectKeys,
);

// @route   GET /api/credit/settings/digi-keys
// @desc    Get Digi CIBIL keys (masked)
// @access  Private/Admin
router.get("/settings/digi-keys", auth, rbac("admin"), getDigiKeys);

// @route   PUT /api/credit/settings/digi-keys
// @desc    Update Digi CIBIL keys
// @access  Private/Admin
router.put("/settings/digi-keys", auth, rbac("admin"), updateDigiKeys);

//@route GET  /api/credit/customer-report
//@desc  get single report with userId
//@access private/Admin
router.get(
  "/customer-report/:pan",
  auth,
  rbac("admin"),
  getSingleCreditReports,
);

//@route POST /api/credit-check-v2
//@desc post and check credit report according cibil type
//@access private/admin
router.post("/credit-check-v2", auth, rbac("admin"), checkCreditScoreV2);

// @route   POST /api/credit/generate-experian-report
// @desc    Experian Soft-Pull credit report (styled PDF)
// @access  Private/Franchise User
router.post(
  "/generate-experian-report",
  auth,
  rbac("franchise_user", "admin"),
  generateExperianReport,
);

module.exports = router;
