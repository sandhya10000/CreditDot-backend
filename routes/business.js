const express = require("express");
const upload = require("../middleware/multer");
const {
  submitBusinessForm,
  verifyPayment,
  getFranchiseBusinessForms,
  getAllBusinessForms,
  closeBusinessCase,
  getSingleBusinessForm,
} = require("../controllers/businessController");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const router = express.Router();

// @route   POST /api/business/submit
// @desc    Submit business form and initiate payment (franchise user only)
// @access  Private/Franchise User
router.post(
  "/submit",
  auth,
  rbac("franchise_user"),

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
  rbac("franchise_user"),
  getFranchiseBusinessForms,
);

// @route   GET /api/business/all
// @desc    Get all business forms (admin only)
// @access  Private/Admin
router.get("/all", auth, rbac("admin"), getAllBusinessForms);

// @route PUT /api/admin/business/${id}/close
//@desc put all business forms(admin only)
//@access Private/Admin
router.put("/admin/business/:id/close", auth, rbac("admin"), closeBusinessCase);

// @route GET /api/business/customer/${customerId}
// @desc get all bissiness form adminonly
// @access private/Admin
router.get(
  "/business/customer/:customerId",
  auth,
  rbac("admin"),
  getSingleBusinessForm,
);

module.exports = router;
