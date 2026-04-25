const mongoose = require('mongoose');

const kycRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  franchiseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Franchise',   
    required: true,
  },
  aadhaarNumber: {
    type: String,
    required: true,
  },
  panNumber: {
    type: String,
    required: true,
  },
  aadhaarFrontDocument: {
    type: String, // URL to document
  },
  aadhaarBackDocument: {
    type: String, // URL to document
  },
  panDocument: {
    type: String, // URL to document
  },
  businessRegistrationDocument: {
    type: String, // URL to document
  },
  // New fields for DigiLocker submissions
  isDigiLockerSubmission: {
    type: Boolean,
    default: false,
  },
  submissionMethod: {
    type: String,
    enum: ['manual', 'digilocker', 'google-drive-links', 'file-upload'],
    default: 'manual',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  reviewedAt: {
    type: Date,
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  rejectionReason: {
    type: String,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('KycRequest', kycRequestSchema);