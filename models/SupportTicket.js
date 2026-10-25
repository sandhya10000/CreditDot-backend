const mongoose = require("mongoose");

const CATEGORIES = [
  "CIBIL Report Issue",
  "AI Issue",
  "Technical Issue",
  "Reopen Case",
];
const STATUSES = ["Pending", "In Progress", "Resolved", "Closed"];
const PRIORITIES = ["Low", "Medium", "High"];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    originalName: String,
    mimeType: String,
    size: Number,
  },
  { _id: false },
);

const supportSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    category: {
      type: String,
      enum: CATEGORIES,
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: "Pending",
    },
    priority: {
      type: String,
      enum: PRIORITIES,
      default: "Medium",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    attachments: [attachmentSchema],
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

const SupportTicket = mongoose.model("Support", supportSchema);

SupportTicket.CATEGORIES = CATEGORIES;
SupportTicket.STATUSES = STATUSES;
SupportTicket.PRIORITIES = PRIORITIES;

module.exports = SupportTicket;
