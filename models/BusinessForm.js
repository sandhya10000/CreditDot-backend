const mongoose = require("mongoose");

const businessFormSchema = new mongoose.Schema(
  {
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: false, // Make optional for public submissions
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
    },
    customerPhone: {
      type: String,
      required: true,
    },
    panNumber: {
      type: String,
      required: true,
      uppercase: true,
    },
    aadharNumber: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: false, // Optional for existing forms
    },
    pincode: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      required: true,
    },
    occupation: {
      type: String,
      required: true,
    },
    monthlyIncome: {
      type: Number,
      required: true,
      min: 0,
    },
    fullAddress: {
      type: String,
      required: true,
    },
    whatsappNumber: {
      type: String,
      required: false,
    },
    creditScore: {
      type: String,
      required: false,
    },
    loanAmount: {
      type: String,
      required: false,
    },
    loanPurpose: {
      type: String,
      required: false,
    },
    selectedPackage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerPackage",
      required: false, // Make optional for public submissions
    },
    paymentId: {
      type: String,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    //add new field to know  business status from admin
    workStatus: {
      type: String,
      enum: ["Working", "Closed"],
      default: "Working",
    },

    closedAt: Date,

    adminRemark: String,
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    message: {
      type: String,
      required: false,
    },
    dob: {
      type: Date,
      required: true,
    },

    gender: {
      type: String,
      required: true,
      enum: ["Male", "Female", "Other"],
    },

    bankAccountNumber: {
      type: String,
      required: true,
    },

    ifscCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("BusinessForm", businessFormSchema);
