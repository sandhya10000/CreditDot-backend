const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    originalName: String,
    mimeType: String,
    size: Number,
  },
  { _id: false },
);

const ticketReplySchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Support",
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorRole: {
      type: String,
      enum: ["admin", "franchise_user"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    attachments: [attachmentSchema],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("TicketReply", ticketReplySchema);
