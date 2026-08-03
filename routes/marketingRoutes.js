const express = require("express");
const router = express.Router();

const {
  uploadmarketingMaterial,
  getMarketingMaterials,
  deleteMarketingMaterial,
  getLanguages,
} = require("../controllers/marketingController");

const createUploader = require("../middleware/upload");

// uploads/marketing folder me save hoga
const upload = createUploader("marketing");

router.post("/upload", upload.single("file"), uploadmarketingMaterial);

// Returns the full language enum list so the frontend sidebar is dynamic
router.get("/languages", getLanguages);

router.get("/", getMarketingMaterials);
router.delete("/:id", deleteMarketingMaterial);

module.exports = router;
