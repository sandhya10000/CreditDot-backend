const mongoose = require("mongoose");

const manualPaymentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // No longer collected on the form; kept for older links that have it
    mobile: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    city: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 1 },
    remarks: { type: String, trim: true, default: "" },
    // Set by gateway webhook / refresh, never entered by admin
    status: {
      type: String,
      enum: ["created", "paid", "partially_paid", "expired", "cancelled"],
      default: "created",
      index: true,
    },
    // New links use Razorpay; Cashfree fields are kept for older links
    gateway: { type: String, enum: ["razorpay", "cashfree"], default: "razorpay" },
    cashfreeLinkId: { type: String, unique: true, sparse: true },
    razorpayLinkId: { type: String, unique: true, sparse: true },
    shortUrl: { type: String, required: true },
    expireBy: { type: Date, required: true },
    paidAt: { type: Date },
    razorpayPaymentId: { type: String },
    cashfreePaymentId: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ManualPayment", manualPaymentSchema);
