const mongoose = require("mongoose");

// PANs temporarily blocked for franchise checks after a bureau rejected the
// PAN/name/mobile combination. Documents are removed automatically once
// blockedUntil has passed (TTL index).
const panBlockSchema = new mongoose.Schema(
  {
    pan: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    reason: {
      type: String,
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

module.exports = mongoose.model("PanBlock", panBlockSchema);
