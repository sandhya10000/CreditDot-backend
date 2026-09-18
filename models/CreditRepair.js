const mongoose = require('mongoose');

const creditRepairSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ["New", "Contacted", "In Progress", "Resolved"],
    default: "New",
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('CreditRepair', creditRepairSchema);