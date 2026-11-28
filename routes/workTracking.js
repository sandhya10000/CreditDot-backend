const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");
const {
  listEntries,
  getSummary,
  createEntry,
  updateEntry,
  deleteEntry,
} = require("../controllers/workTrackingController");

// Admin role + "work_tracking" section (checked by rbac for staff roles)
const access = [auth, rbac("admin")];

//@route GET/POST /api/work-tracking/entries
router.get("/entries", ...access, listEntries);
router.post("/entries", ...access, createEntry);

//@route PUT/DELETE /api/work-tracking/entries/:id (owner only)
router.put("/entries/:id", ...access, updateEntry);
router.delete("/entries/:id", ...access, deleteEntry);

//@route GET /api/work-tracking/summary
router.get("/summary", ...access, getSummary);

module.exports = router;
