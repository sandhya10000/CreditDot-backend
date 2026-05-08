const { string } = require("joi");
const mongoose = require("mongoose");
const reportDownloadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    userName: String,

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
