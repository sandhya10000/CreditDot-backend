const mongoose = require('mongoose');

const creditRepairSchema = new mongoose.Schema({
  enquiryType: {
    type: String,
    enum: ["individual", "corporate"],
    default: "individual",
    index: true,
  },
  // Individual & Shared Contact Fields
  fullName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  mobileNumber: {
    type: String,
    required: true,
  },
  city: {
    type: String,
  },
  state: {
    type: String,
    required: true,
  },
  problemType: {
    type: String,
    required: true,
  },
  creditScore: {
    type: String,
  },
  message: {
    type: String,
  },
  language: {
    type: String,
  },
  occupation: {
    type: String,
  },
  income: {
    type: String,
  },

  // Corporate CMR Specific Fields
  companyName: {
    type: String,
  },
  entityType: {
    type: String, // Pvt Ltd, Public Ltd, LLP, Partnership, MSME / Proprietorship
  },
  designation: {
    type: String, // Director, CFO, Partner, Owner
  },
  gstNumber: {
    type: String,
  },
  turnoverRange: {
    type: String,
  },
  cmrRank: {
    type: String, // CMR-1 to CMR-10
  },

  status: {
    type: String,
    enum: ["New", "Contacted", "In Progress", "Resolved"],
    default: "New",
  },
  // Where the enquiry came from: website form or WhatsApp "Contact Support" button
  source: {
    type: String,
    enum: ["website", "whatsapp"],
    default: "website",
    index: true,
  },
  // Set when an admin opens the lead; drives the unread counts
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('CreditRepair', creditRepairSchema);