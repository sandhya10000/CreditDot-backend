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
    // Optional referral details for Individual customers (manual entry by admin/BM)
    consultant: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },
    // Business Manager ("RM") who owns this MIS entry; optional, admin can assign later
    assignedRm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    customerType: {
      type: String,
      enum: ["individual", "business"],
      default: "individual",
      index: true,
    },
    // Only filled for business customers (required when customerType is "business")
    businessDetails: {
      directorName: { type: String, trim: true },
      gstUsername: { type: String, trim: true },
      gstNumber: { type: String, trim: true, uppercase: true },
      companyType: { type: String, trim: true },
      companyPanNumber: { type: String, trim: true, uppercase: true },
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
    city: { type: String, required: true },
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

    // Set when an admin opens the customer; drives the Business MIS unread counts
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    //add new field to know  business status from admin
    workStatus: {
      type: String,
      enum: ["in_progress", "closed", "pending"],
      default: "in_progress",
    },

    // Issues the client raised at intake, so the team can work on them
    clientIssues: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
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

    // Annual Maintenance Contract (current term). Status (active / expiring /
    // expired / upcoming) is derived from the dates — see utils/amcStatus.js
    amc: {
      isEnrolled: { type: Boolean, default: false, index: true },
      startDate: Date, // UTC midnight of the chosen day
      endDate: Date, // inclusive, UTC midnight
      amount: { type: Number, min: 0 },
      paymentStatus: {
        type: String,
        enum: ["pending", "paid"],
        default: "pending",
      },
      paidAt: Date,
      remarks: { type: String, trim: true },
      enrolledAt: Date,
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    // Past AMC terms (renewed or cancelled)
    amcHistory: [
      {
        startDate: Date,
        endDate: Date,
        amount: Number,
        paymentStatus: String,
        paidAt: Date,
        remarks: String,
        endedReason: { type: String, enum: ["renewed", "cancelled"] },
        cancelReason: String,
        closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        closedAt: { type: Date, default: Date.now },
      },
    ],

    // Follow-up: next date to contact the customer (YYYY-MM-DD, local calendar day)
    nextFollowUpDate: {
      type: String,
      default: null,
      index: true,
    },
    // Every follow-up that was scheduled, newest last
    followUpHistory: [
      {
        followUpDate: { type: String, required: true },
        note: { type: String, trim: true, maxlength: 500, default: "" },
        createdBy: {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          name: String,
          role: String,
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

businessFormSchema.index({ "amc.isEnrolled": 1, "amc.endDate": 1 });

const BUSINESS_DETAIL_FIELDS = [
  "directorName",
  "gstUsername",
  "gstNumber",
  "companyType",
  "companyPanNumber",
];

businessFormSchema.pre("validate", function (next) {
  if (this.customerType === "business") {
    const missing = BUSINESS_DETAIL_FIELDS.filter(
      (field) => !this.businessDetails?.[field],
    );
    if (missing.length) {
      this.invalidate(
        "businessDetails",
        `Missing business details: ${missing.join(", ")}`,
      );
    }
  }
  next();
});

businessFormSchema.statics.BUSINESS_DETAIL_FIELDS = BUSINESS_DETAIL_FIELDS;

module.exports = mongoose.model("BusinessForm", businessFormSchema);
