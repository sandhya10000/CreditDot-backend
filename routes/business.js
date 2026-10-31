const express = require("express");
const createUploader = require("../middleware/upload");
const upload = createUploader("business-documents");

const {
  submitBusinessForm,
  verifyPayment,
  getFranchiseBusinessForms,
  getAllBusinessForms,
  updateBusinessWorkStatus,
  getSingleBusinessForm,
  uploadDocBusiness,
  getBusinessFormsByFranchise,
  updateBusinessForm,
  deleteBusinessForm,
  listAssignableRms,
  lookupConsultant,
  assignBusinessRm,
  getBusinessUnreadCounts,
  markBusinessFormRead,
  markBusinessFormsListRead,
} = require("../controllers/businessController");
const requireFullAdmin = require("../middleware/fullAdmin");
const {
  uploadAdminBusinessDocuments,
} = require("../controllers/businessDocumentController");
const {
  getBusinessFollowUps,
  setBusinessFollowUp,
  clearBusinessFollowUp,
} = require("../controllers/followUpController");
const {
  getAmcCustomers,
  getFranchiseAmcCustomers,
  upsertAmc,
  renewAmc,
  cancelAmc,
} = require("../controllers/amcController");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const router = express.Router();

// @route   POST /api/business/submit
// @desc    Submit business form and initiate payment (franchise user only)
// @access  Private/Franchise User
router.post(
  "/submit",
  auth,
  rbac("franchise_user", "admin"),

  submitBusinessForm,
);

// @route   POST /api/business/verify-payment
// @desc    Verify payment and update business form (franchise user only)
// @access  Private/Franchise User
router.post("/verify-payment", auth, rbac("franchise_user"), verifyPayment);

// @route   GET /api/business/franchise
// @desc    Get business forms for franchise user
// @access  Private/Franchise User

router.get(
  "/franchise",
  auth,
  rbac("franchise_user", "admin"),
  getFranchiseBusinessForms,
);
// @route   GET /api/business/franchise/amc
// @desc    Get the logged-in franchise's AMC customers (read-only)
// @access  Private/Franchise User
// NOTE: must stay above "/franchise/:_id" so "amc" isn't treated as an id
router.get(
  "/franchise/amc",
  auth,
  rbac("franchise_user"),
  getFranchiseAmcCustomers,
);

// @route   GET /api/business/franchise/:franchiseId
// @desc    Get business forms for franchise user
// @access  Private/Admin User
router.get("/franchise/:_id", auth, rbac("admin"), getBusinessFormsByFranchise);

// @route   GET /api/business/amc
// @desc    Get all AMC customers (admin only)
// @access  Private/Admin
router.get("/amc", auth, rbac("admin"), getAmcCustomers);
// @route   PUT /api/admin/business-forms/:id/amc
// @desc    Enroll customer in AMC or edit the current AMC term
// @access  Private/Admin
router.put("/admin/business-forms/:id/amc", auth, rbac("admin"), upsertAmc);

// @route   POST /api/admin/business-forms/:id/amc/renew
// @desc    Renew AMC (current term moves to history)
// @access  Private/Admin
router.post(
  "/admin/business-forms/:id/amc/renew",
  auth,
  rbac("admin"),
  renewAmc,
);

// @route   DELETE /api/admin/business-forms/:id/amc
// @desc    Cancel AMC enrollment (kept in history)
// @access  Private/Admin
router.delete("/admin/business-forms/:id/amc", auth, rbac("admin"), cancelAmc);

// @route   GET /api/business/all
// @desc    Get all business forms (admin only)
// @access  Private/Admin
router.get("/all", auth, rbac("admin"), getAllBusinessForms);

// @route   GET /api/business/unread-counts
// @desc    Paid business forms not yet opened by an admin (Business MIS badges)
router.get("/unread-counts", auth, rbac("admin"), getBusinessUnreadCounts);

// @route   PUT /api/business/admin/business-forms/mark-read?customerType=individual|business
// @desc    Marks every unread paid form of one type as seen (opening the Business MIS list)
router.put("/admin/business-forms/mark-read", auth, rbac("admin"), markBusinessFormsListRead);

// @route   PUT /api/business/admin/business-forms/:_id/read
// @desc    Marks a business form as opened by an admin
router.put("/admin/business-forms/:_id/read", auth, rbac("admin"), markBusinessFormRead);

// @route   GET /api/business/consultant-lookup?q=  (staff prefill for Individual Consultant)
// @access  Private/Admin + Business Managers
router.get("/consultant-lookup", auth, rbac("admin"), lookupConsultant);

// @route   GET /api/business/rms  (active Business Managers for "Assign to RM")
// @access  Private/Admin + Business Managers
router.get("/rms", auth, rbac("admin"), listAssignableRms);

// @route   PATCH /api/business/admin/business-forms/:id/rm
// @desc    Set or clear the RM on a Business MIS entry (full admin only)
// @access  Private/Full Admin
router.patch(
  "/admin/business-forms/:id/rm",
  auth,
  rbac("admin"),
  requireFullAdmin,
  assignBusinessRm,
);

// @route   PUT /api/business/admin/business-forms/:id/documents
// @desc    Admin uploads or replaces one or more customer documents
// @access  Private/Admin
router.put(
  "/admin/business-forms/:id/documents",
  auth,
  rbac("admin"),
  upload.fields([
    { name: "panCard", maxCount: 1 },
    { name: "aadharFront", maxCount: 1 },
    { name: "aadharBack", maxCount: 1 },
    { name: "cancelCheque", maxCount: 1 },
    { name: "bankProof", maxCount: 1 },
    { name: "extraBankDoc", maxCount: 1 },
  ]),
  uploadAdminBusinessDocuments,
);

// @route   GET /api/business/follow-ups
// @desc    Customers with a scheduled follow-up (search, date range, pagination)
// @access  Private/Admin
router.get("/follow-ups", auth, rbac("admin"), getBusinessFollowUps);

// @route   PUT /api/business/admin/business-forms/:id/follow-up
// @desc    Schedule the next follow-up date for a customer
// @access  Private/Admin
router.put(
  "/admin/business-forms/:id/follow-up",
  auth,
  rbac("admin"),
  setBusinessFollowUp,
);

// @route   DELETE /api/business/admin/business-forms/:id/follow-up
// @desc    Mark the current follow-up as done (history kept)
// @access  Private/Admin
router.delete(
  "/admin/business-forms/:id/follow-up",
  auth,
  rbac("admin"),
  clearBusinessFollowUp,
);

// @route PUT /api/admin/business/${id}/close
//@desc put all business forms(admin only)
//@access Private/Admin
// router.put("/admin/business/:id/close", auth, rbac("admin"), closeBusinessCase);
router.put(
  "/admin/business-forms/:id/work-status",
  auth,
  rbac("admin"),
  updateBusinessWorkStatus,
);

//@route DELETE api/admin/business-forms/:id"
// route
router.delete(
  "/admin/business-forms/:id",
  auth,
  rbac("admin"),
  deleteBusinessForm,
);
// @route GET /api/business/customer/${customerId}
// @desc get all bissiness form adminonly
// @access private/Admin
router.get(
  "/business/customer/:customerId",
  auth,
  rbac("admin"),
  getSingleBusinessForm,
);

//@route UPDATE /api/admin/business/update-form/:customerId
router.put("/admin/business/update-form/:customerId", updateBusinessForm);

// @route POST /api/franchise/uploadDocBusiness
//@desc post business document franchise
//@access private/franchise user
router.post(
  "/franchise/uploadDocBusiness",

  auth,

  rbac("franchise_user", "admin"),

  upload.fields([
    { name: "panCard", maxCount: 1 },
    { name: "aadharFront", maxCount: 1 },
    { name: "aadharBack", maxCount: 1 },
    { name: "cancelCheque", maxCount: 1 },
    { name: "bankProof", maxCount: 1 },
    { name: "extraBankDoc", maxCount: 1 },
  ]),

  uploadDocBusiness,
);

module.exports = router;
