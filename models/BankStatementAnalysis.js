const mongoose = require("mongoose");

// Bank Statement Analyzer (CreditDost)
const bankStatementAnalysisSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fileName: { type: String, default: null },

    status: {
      type: String,
      enum: ["Processing", "Finalizing", "Success", "Failed"],
      default: "Processing",
      index: true,
    },

    // Generated PDF and HTML paths (private, served via auth-checked endpoint)
    localPath: { type: String, default: null },
    htmlPath: { type: String, default: null },

    accountHolderName: { type: String, default: null },
    bankName: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    statementFrom: { type: String, default: null },
    statementTo: { type: String, default: null },
    pageCount: { type: Number, default: null },

    // Financial & Reconciliation summary
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    totalCredits: { type: Number, default: 0 },
    totalDebits: { type: Number, default: 0 },
    reconciliationStatus: {
      type: String,
      enum: ["VERIFIED", "PARTIAL", "FAILED", null],
      default: null,
    },

    // Analytics payload (KPIs, scorecard, categorized totals, cash flows)
    analytics: { type: mongoose.Schema.Types.Mixed, default: null },

    // Narrative observations from AI or deterministic fallback
    narrative: {
      overall_summary: { type: String, default: null },
      key_strengths: [{ type: String }],
      key_concerns: [{ type: String }],
      lender_recommendations: [{ type: String }],
      spending_insight: { type: String, default: null },
    },

    failureReason: { type: String, default: null },
    errorCode: { type: String, default: null },
    failedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

bankStatementAnalysisSchema.index({ userId: 1, status: 1 });
bankStatementAnalysisSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("BankStatementAnalysis", bankStatementAnalysisSchema);
