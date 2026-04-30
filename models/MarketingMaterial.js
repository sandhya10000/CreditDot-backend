const mongoose = require("mongoose");

const marketingSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    fileUrl: String,
    fileType: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("MarketingMaterial", marketingSchema);
