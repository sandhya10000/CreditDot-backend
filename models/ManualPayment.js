const mongoose = require("mongoose");

const manualPaymentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    city: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 1 },
    remarks: { type: String, trim: true, default: "" },
    // Set by Razorpay webhook / refresh, never entered by admin
    status: {
      type: String,
      enum: ["created", "paid", "partially_paid", "expired", "cancelled"],
      default: "created",
      index: true,
    },
    razorpayLinkId: { type: String, required: true, unique: true },
    shortUrl: { type: String, required: true },
    expireBy: { type: Date, required: true },
    paidAt: { type: Date },
    razorpayPaymentId: { type: String },
    emailSentAt: { type: Date },
    emailError: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ManualPayment", manualPaymentSchema);
