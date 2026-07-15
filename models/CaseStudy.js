const mongoose = require("mongoose");

const CASE_STUDY_CATEGORIES = require("../config/caseStudyCategories");
const allowedCategories = CASE_STUDY_CATEGORIES.map(c => c.value);

const caseStudySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },

    description: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: allowedCategories,
    },

    beforeWorking: {
      type: String,
      required: true,
    },

    afterWorking: {
      type: String,
      required: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CaseStudy", caseStudySchema);
