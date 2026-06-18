const mongoose = require("mongoose");

const marketingSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    fileUrl: String,
    fileType: String,
    language: {
      type: String,
      enum: [
        "Hindi",
        "English",
        "Tamil",
        "Telugu",
        "Bengali",
        "Malayalam",
        "Marathi",
        "Gujarati",
        "Kannada",
      ],
      required: true,
    },
  },

  { timestamps: true },
);

module.exports = mongoose.model("MarketingMaterial", marketingSchema);
