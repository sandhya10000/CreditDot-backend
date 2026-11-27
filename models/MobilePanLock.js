const mongoose = require("mongoose");

// A mobile + PAN pair locked for franchise checks after the prefill details did not match
// the name, mobile and PAN the partner entered. Removed automatically when blockedUntil passes.
const mobilePanLockSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    pan: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    reason: {
      type: String,
      default: "",
    },
    blockedUntil: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  },
);

mobilePanLockSchema.index({ mobile: 1, pan: 1 }, { unique: true });

module.exports = mongoose.model("MobilePanLock", mobilePanLockSchema);
