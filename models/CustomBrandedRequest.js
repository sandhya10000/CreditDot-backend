const mongoose = require("mongoose");
const FranchiseCounter = require("./FranchiseCounter");

// Same shape as VerifyHub's CustomBrandedRequest. partnerId is the partner's User id.
const customBrandedRequestSchema = new mongoose.Schema(
  {
    // Human-readable ID (CR-1001, CR-1002, ...)
    requestId: {
      type: String,
      unique: true,
    },

    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Contact details collected at request time
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },

    // ── Payment fields ──
    orderId: { type: String, default: null, index: true, sparse: true },
    paymentId: { type: String, default: null },
    amount: { type: Number, default: null },
    paymentMethod: {
      type: String,
      enum: ["WALLET", "RAZORPAY"],
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ["Unpaid", "Paid"],
      default: "Unpaid",
    },

    // ── Request lifecycle ──
    status: {
      type: String,
      enum: ["Pending", "Active", "Completed", "Cancelled"],
      default: "Pending",
    },

    // ── Brand-desk setup (designer queue comes later) ──
    setupStatus: {
      type: String,
      enum: ["not_started", "in_progress", "done"],
      default: "not_started",
      index: true,
    },
    setupCompletedAt: { type: Date, default: null },
    setupCompletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    internalNotes: { type: String, default: "" },

    // ── Brand assets submitted by partner (form comes later) ──
    brandingDetails: {
      logoUrl: { type: String, default: "" },
      brandColors: { type: [String], default: [] },
      companyName: { type: String, default: "" },
      tagline: { type: String, default: "" },
      contactPhone: { type: String, default: "" },
      contactEmail: { type: String, default: "" },
      notes: { type: String, default: "" },
      submittedAt: { type: Date, default: null },
      revisionsUsed: { type: Number, default: 0 },
      revisionNotes: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

// Generate CR-XXXX before first save
customBrandedRequestSchema.pre("save", async function () {
  if (this.isNew && !this.requestId) {
    const counter = await FranchiseCounter.findByIdAndUpdate(
      "custom_branded_request_id",
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    this.requestId = "CR-" + String(1000 + counter.seq);
  }
});

module.exports =
  mongoose.models.CustomBrandedRequest ||
  mongoose.model("CustomBrandedRequest", customBrandedRequestSchema);
