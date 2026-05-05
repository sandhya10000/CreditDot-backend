const express = require("express");
const router = express.Router();

const { uploadRewards, getRewards } = require("../controllers/Rewards");

const createUploader = require("../middleware/upload");

// uploads/marketing folder me save hoga
const upload = createUploader("rewards");

router.post("/upload", upload.single("file"), uploadRewards);

router.get("/", getRewards);

module.exports = router;
