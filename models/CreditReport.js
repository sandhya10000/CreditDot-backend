const mongoose = require('mongoose');

const creditReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  franchiseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Franchise',
    required: false, // Make optional for public reports
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  },
  personId: {
    type: String, // Surepass person ID
  },
  name: {
    type: String,
    required: true,
  },
  mobile: {
    type: String,
  },
  address: {
    type: String,
  },
  gender: {
    type: String,
  },
  dob: {
    type: Date,
  },
  email: {
    type: String,
  },
  pan: {
    type: String,
  },
  aadhaar: {
    type: String,
  },
  score: {
    type: Number,
    min: 0,
    max: 999,
  },
  reportData: {
    type: mongoose.Schema.Types.Mixed, // Full Surepass response
  },
  reportUrl: {
    type: String,
  },
  localPath: {
    type: String,
  },
  isPublic: {
    type: Boolean,
    default: false,
  },
  bureau: {
    type: String,
    required: false, // Make optional for backward compatibility
  },
  occupation: {
    type: String,
  },
  city: {
    type: String,
  },
  state: {
    type: String,
  },
  language: {
    type: String,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CreditReport', creditReportSchema);