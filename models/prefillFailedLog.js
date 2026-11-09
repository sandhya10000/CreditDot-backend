const mongoose = require("mongoose");
const prefillFailedLog = new mongoose.Schema(
  {
    // Where the failure came from
    source: {
      type: String,
      enum: ["prefill", "credit-report"],
      default: "prefill",
    },
    // Credit report bureau (cibil, equifax, ...) - credit-report source only
    bureau: {
      type: String,
    },
    mobile: {
      type: String,
      required: true,
    },
    name: {
      type: String,
    },
    pan: {
      type: String,
    },
    message: {
      type: String,
    },
    statusCode: {
      type: Number,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PrefillFailedLog", prefillFailedLog);
