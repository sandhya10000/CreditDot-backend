const express = require("express");
const router = express.Router();

const {
  uploadmarketingMaterial,
  getMarketingMaterials,
} = require("../controllers/marketingController");

const createUploader = require("../middleware/upload");

// uploads/marketing folder me save hoga
const upload = createUploader("marketing");

router.post("/upload", upload.single("file"), uploadmarketingMaterial);

router.get("/", getMarketingMaterials);

module.exports = router;
