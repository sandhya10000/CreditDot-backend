const mongoose = require("mongoose");

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
      enum: [
        "dpd",
        "inquiries",
        "score_increase",
        "settlement",
        "write_off",
        "suit_filed",
        "post_write_off_closed",
        "fake_loans",
        "sma_removed",
      ],
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
