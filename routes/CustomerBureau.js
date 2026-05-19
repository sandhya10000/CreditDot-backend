const express = require("express");
const {
  saveBureauData,
  getBureauData,
} = require("../controllers/CustomerBureau");
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const router = express.Router();
//@route POST /api//customer/bureau/:customerId
//@desc post api to save bureau data by admin userId,password,mobile
//@access private/admin
router.post("/customer/bureau/:customerId", saveBureauData);
router.get("/bureau-data/:customerId", getBureauData);

module.exports = router;
