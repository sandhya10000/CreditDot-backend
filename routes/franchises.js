const express = require("express");
const {
  getFranchiseProfile,
  updateFranchiseProfile,
  getAllFranchises,
  getFranchiseList,
  getFranchiseById,
  updateFranchise,
  deactivateFranchise,
  activateFranchise,
  generateCertificate,
  requestCertificateNameUpdate,
  getPanDetails,
  updatePanDetails,
  fetchPanComprehensive,
  getBankDetails,
  updateBankDetails,
  fetchBankVerification,
  getSingleFranchise,
  getAllFranchisesList,
  exportFranchisesCSV,
} = require("../controllers/franchiseController");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: All static / named routes MUST be declared BEFORE wildcard routes
// such as /:franchiseCode or /:id.  Express matches routes in registration
// order, so a wildcard registered first will swallow any later static path.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET (static) ─────────────────────────────────────────────────────────────

// @route   GET /api/franchises/profile
// @desc    Get franchise profile
// @access  Private/Franchise User
router.get("/profile", auth, rbac("franchise_user"), getFranchiseProfile);

// @route   GET /api/franchises/export-csv
// @desc    Export ALL matching franchises as a streamed CSV (no pagination).
//          Honours the same ?search= and ?kycStatus= filters as the list view.
// @access  Private/Admin
router.get("/export-csv", auth, rbac("admin"), exportFranchisesCSV);

// @route   GET /api/franchises/list
// @route   GET /api/franchises/
// @desc    Get all franchises (paginated)
// @access  Private/Admin
router.get("/list", auth, rbac("admin"), getFranchiseList);
router.get("/", auth, rbac("admin"), getAllFranchises);

// @route   GET /api/franchises/certificate
// @desc    Generate certificate data
// @access  Private/Franchise User
router.get("/certificate", auth, rbac("franchise_user"), generateCertificate);

// @route   GET /api/franchises/pan
// @desc    Get PAN details
// @access  Private/Franchise User
router.get("/pan", auth, rbac("franchise_user"), getPanDetails);

// @route   GET /api/franchises/bank
// @desc    Get bank details
// @access  Private/Franchise User
router.get("/bank", auth, rbac("franchise_user"), getBankDetails);

// @route   GET /api/franchises/admin/allFranchises-Namelist
// @desc    Get all franchise names (lightweight list)
// @access  Private/Admin
router.get(
  "/admin/allFranchises-Namelist",
  auth,
  rbac("admin"),
  getAllFranchisesList,
);

// ── PUT (static) ─────────────────────────────────────────────────────────────

// @route   PUT /api/franchises/profile
// @desc    Update franchise profile
// @access  Private/Franchise User
router.put("/profile", auth, rbac("franchise_user"), updateFranchiseProfile);

// @route   PUT /api/franchises/certificate/name
// @desc    Request certificate name update
// @access  Private/Franchise User
router.put(
  "/certificate/name",
  auth,
  rbac("franchise_user"),
  requestCertificateNameUpdate,
);
// @route GET api/franchise/single-data/franchiseCode
// @desc    Get franchise profile
// @access  Private/Franchise User
router.get(
  "/single-data/:franchiseCode",
  auth,
  rbac("admin"),
  getSingleFranchise,
);

// @route   PUT /api/franchises/pan
// @desc    Update PAN number
// @access  Private/Franchise User
router.put("/pan", auth, rbac("franchise_user"), updatePanDetails);

// @route   PUT /api/franchises/bank
// @desc    Update bank details
// @access  Private/Franchise User
router.put("/bank", auth, rbac("franchise_user"), updateBankDetails);

// ── POST (static) ────────────────────────────────────────────────────────────

// @route   POST /api/franchises/pan/fetch
// @desc    Fetch PAN comprehensive details from Surepass
// @access  Private/Franchise User
router.post("/pan/fetch", auth, rbac("franchise_user"), fetchPanComprehensive);

// @route   POST /api/franchises/bank/verify
// @desc    Verify bank details with Surepass
// @access  Private/Franchise User
router.post(
  "/bank/verify",
  auth,
  rbac("franchise_user"),
  fetchBankVerification,
);

// ─────────────────────────────────────────────────────────────────────────────
// Wildcard / parameterised routes — MUST come LAST
// ─────────────────────────────────────────────────────────────────────────────

// @route   GET /api/franchises/:franchiseCode
// @desc    Get single franchise by franchise code
// @access  Private/Admin
router.get("/:franchiseCode", auth, rbac("admin"), getSingleFranchise);

// @route   GET /api/franchises/:id
// @desc    Get franchise by MongoDB ID
// @access  Private/Admin
router.get("/:id", auth, rbac("admin"), getFranchiseById);

// @route   PUT /api/franchises/:id
// @desc    Update franchise
// @access  Private/Admin
router.put("/:id", auth, rbac("admin"), updateFranchise);

// @route   PUT /api/franchises/:id/deactivate
// @desc    Deactivate franchise
// @access  Private/Admin
router.put("/:id/deactivate", auth, rbac("admin"), deactivateFranchise);

// @route   PUT /api/franchises/:id/activate
// @desc    Activate franchise
// @access  Private/Admin
router.put("/:id/activate", auth, rbac("admin"), activateFranchise);

module.exports = router;
