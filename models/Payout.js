const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  franchiseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Franchise',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  periodStart: {
    type: Date,
    required: true,
  },
  periodEnd: {
    type: Date,
    required: true,
  },
  creditsGenerated: {
    type: Number,
    required: true,
  },
  referralBonus: {
    type: Number,
    default: 0,
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  // New fields for TDS calculation
  grossAmount: {
    type: Number,
    required: false,
  },
  tdsAmount: {
    type: Number,
    required: false,
  },
  tdsPercentage: {
    type: Number,
    default: 2, // 2% TDS
  },
  gstAmount: {
    type: Number,
    required: false,
  },
  gstPercentage: {
    type: Number,
    default: 18, // 18% GST
    required: false,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  processedAt: {
    type: Date,
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  remarks: {
    type: String,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Payout', payoutSchema);