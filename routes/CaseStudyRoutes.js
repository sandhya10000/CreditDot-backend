const express = require("express");
const router = express.Router();

const {
  createCaseStudy,
  getCaseStudies,
  updateCaseStudy,
  deleteCaseStudy,
} = require("../controllers/CaseStudyController");

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
router.get("/", getCaseStudies);
router.put(
  "/:id",
  upload.fields([
    { name: "beforeWorking", maxCount: 1 },
    { name: "afterWorking", maxCount: 1 },
  ]),
  updateCaseStudy,
);
router.delete("/:id", deleteCaseStudy);

module.exports = router;
