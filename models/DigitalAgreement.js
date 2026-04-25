const mongoose = require('mongoose');

const digitalAgreementSchema = new mongoose.Schema({
  franchiseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Franchise',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Template PDF file path (shared template)
  templatePath: {
    type: String,
    required: true
  },
  // Generated PDF with user data (copy of template)
  generatedPdfPath: {
    type: String,
    required: true
  },
  // User's name filled in the PDF
  userName: {
    type: String,
    required: true
  },
  // Status of the agreement
  status: {
    type: String,
    enum: ['pending', 'downloaded', 'signed', 'completed', 'submitted', 'approved', 'rejected'],
    default: 'pending'
  },
  // Signed PDF file path (after eSign)
  signedPdfPath: {
    type: String,
    default: null
  },
  // Surepass eSign transaction ID
  transactionId: {
    type: String,
    default: null
  },
  // Rejection reason if status is rejected
  rejectionReason: {
    type: String,
    default: null
  },
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp on save
digitalAgreementSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('DigitalAgreement', digitalAgreementSchema);