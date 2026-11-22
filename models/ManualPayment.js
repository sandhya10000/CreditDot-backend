const mongoose = require("mongoose");

const manualPaymentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
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
    // New links use Cashfree; Razorpay fields are kept for older links
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
