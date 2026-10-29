const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");
const requireFullAdmin = require("../middleware/fullAdmin");

const {
  getPermissionCatalog,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listStaff,
  getStaffProfile,
  assignStaff,
  changeStaffRole,
  updateStaffDetails,
  setStaffStatus,
  resendCredentials,
} = require("../controllers/staffController");

// Role and staff management is for full administrators only
const fullAdmin = [auth, rbac("admin"), requireFullAdmin];

//@route GET /api/admin/permissions
router.get("/permissions", ...fullAdmin, getPermissionCatalog);

//@route GET/POST /api/admin/roles
router.get("/roles", ...fullAdmin, listRoles);
router.post("/roles", ...fullAdmin, createRole);

//@route PUT/DELETE /api/admin/roles/:id
router.put("/roles/:id", ...fullAdmin, updateRole);
router.delete("/roles/:id", ...fullAdmin, deleteRole);

//@route GET/POST /api/admin/staff
router.get("/staff", ...fullAdmin, listStaff);
router.post("/staff", ...fullAdmin, assignStaff);

//@route GET /api/admin/staff/:id (profile + owned franchises)
router.get("/staff/:id", ...fullAdmin, getStaffProfile);

//@route PATCH /api/admin/staff/:id (name, email, phone) | /role | /status
router.patch("/staff/:id", ...fullAdmin, updateStaffDetails);
router.patch("/staff/:id/role", ...fullAdmin, changeStaffRole);
router.patch("/staff/:id/status", ...fullAdmin, setStaffStatus);

//@route POST /api/admin/staff/:id/resend-credentials
router.post("/staff/:id/resend-credentials", ...fullAdmin, resendCredentials);

module.exports = router;
