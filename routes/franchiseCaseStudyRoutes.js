const express = require("express");
const router = express.Router();

const {
  createCaseStudy,
} = require("../controllers/franchiseCaseStudyController");

const createUploader = require("../middleware/upload");

// uploads/case-study folder me save hoga
const upload = createUploader("case-study");

router.post(
  "/",
  upload.fields([
    { name: "beforeWorking", maxCount: 1 },
    { name: "afterWorking", maxCount: 1 },
  ]),
  createCaseStudy,
);

module.exports = router;
