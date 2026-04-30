const express = require("express");
const multer = require("multer");
const router = express.Router();
const {
  uploadmarketingMaterial,
  getMarketingMaterials,
} = require("../controllers/marketingController");
const path = require("path");

const MarketingMaterial = require("../models/MarketingMaterial");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/marketing");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

router.post("/upload", upload.single("file"), uploadmarketingMaterial);
router.get("/", getMarketingMaterials);
module.exports = router;
