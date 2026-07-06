const mongoose = require("mongoose");

const businessFormSchema = new mongoose.Schema(
  {
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: false, // Make optional for public submissions
    },
    //below 3 fields added for admin
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    createdByRole: {
      type: String,
      enum: [
        "admin",
        "franchise_user",
        "relationship_manager",
        "credit_analyst",
      ],
    },
    entrySource: {
      type: String,
      enum: ["Franchise", "Direct Login"],
      default: "Direct Login",
    },
    //Add customer Id
    customerId: {
      type: String,
      unique: true,
      sparse: true,
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
    manualAmount: {
      type: Number,
      default: 0,
    },

    fullAddress: {
      type: String,
      required: true,
    },
    //upload document
    documents: {
      panCard: {
        type: String,
        default: "",
      },
      aadharFront: {
        type: String,
        default: "",
      },
      aadharBack: {
        type: String,
        default: "",
      },
      cancelCheque: {
        type: String,
        default: "",
      },
      bankProof: {
        type: String,
        default: "",
      },
      extraBankDoc: {
        type: String,
        default: "",
      },
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
    },

    ifscCode: {
      type: String,

      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("BusinessForm", businessFormSchema);
