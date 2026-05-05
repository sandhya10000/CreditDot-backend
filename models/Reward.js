const mongoose = require("mongoose");

const rewardSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },

    fileUrl: {
      type: String,
      required: [true, "File is required"],
    },

    fileType: {
      type: String, // image/png, application/pdf etc
    },

    validityDays: {
      type: Number,
      required: true,
      min: 1,
    },

    expiryDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Reward", rewardSchema);
