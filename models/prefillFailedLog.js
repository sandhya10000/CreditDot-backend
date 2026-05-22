const mongoose = require("mongoose");
const prefillFailedLog = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
    },
    message: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
    },
    statusCode: {
      type: Number,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PrefillFailedLog", prefillFailedLog);
