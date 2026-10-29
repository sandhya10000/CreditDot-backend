const { string } = require("joi");
const mongoose = require("mongoose");
const reportDownloadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    userName: String,

    // Franchise the report belongs to, so Business Managers see their own downloads
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      index: true,
    },

    reportType: String, // credit report, franchise report etc

    fileName: String,

    downloadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ReportDownload", reportDownloadSchema);
