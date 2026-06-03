const express = require("express");
const router = express.Router();

const {
  uploadmarketingMaterial,
  getMarketingMaterials,
  deleteMarketingMaterial,
} = require("../controllers/marketingController");

const createUploader = require("../middleware/upload");

// uploads/marketing folder me save hoga
const upload = createUploader("marketing");

router.post("/upload", upload.single("file"), uploadmarketingMaterial);

router.get("/", getMarketingMaterials);
router.delete("/:id", deleteMarketingMaterial);

module.exports = router;
