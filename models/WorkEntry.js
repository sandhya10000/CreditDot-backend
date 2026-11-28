const mongoose = require("mongoose");
const { CATEGORY_KEYS, FRANCHISE_TIERS } = require("../config/workTracking");

// One logged working / business entry (Monthly Working & Business Tracking)
const workEntrySchema = new mongoose.Schema(
  {
    // Staff member who logged the entry
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Snapshot of the staff role at the time of entry, so monthly reports stay
    // accurate if the person's role changes later
    staffRole: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
    },
    userName: { type: String, trim: true, default: "" },
    roleName: { type: String, trim: true, default: "" },

    // Manually chosen transaction/working date (not restricted to today)
    entryDate: { type: Date, required: true },
    // "YYYY-MM" derived from the chosen date, used for monthly grouping
    entryMonth: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },

    category: {
      type: String,
      enum: CATEGORY_KEYS,
      required: true,
    },
    franchiseTier: {
      type: String,
      enum: [...FRANCHISE_TIERS, null],
      default: null,
    },

    // What the user typed (the amount before GST interpretation)
    amount: { type: Number, required: true, min: 0 },
    // Stored breakdown, always computed on the server
    baseAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    // "with_gst" / "without_gst" for GST categories, null for franchise
    gstMode: {
      type: String,
      enum: ["with_gst", "without_gst", null],
      default: null,
    },

    notes: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true },
);

workEntrySchema.index({ entryMonth: 1, staffRole: 1 });
workEntrySchema.index({ entryMonth: 1, user: 1 });

module.exports = mongoose.model("WorkEntry", workEntrySchema);
