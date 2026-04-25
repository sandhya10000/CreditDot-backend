// routes/adminRoutes.js

const express = require("express");
const router = express.Router();
const { createDummyAdmin } = require("../controllers/adminDumyController");

router.get("/create-admin", createDummyAdmin);

module.exports = router;
