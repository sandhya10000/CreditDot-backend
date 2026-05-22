const express = require("express");

const auth = require("../middleware/auth");
const {
  addCustomerRemarks,
  getCustomerRemarks,
} = require("../controllers/Remark");
const router = express.Router();

router.post("/admin/addremark/customer", auth, addCustomerRemarks);
router.get("/addRemark/:customerId", getCustomerRemarks);

module.exports = router;
