const mongoose = require('mongoose');

const franchiseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  businessName: {
    type: String,
    required: true,
    trim: true,
  },
  ownerName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  phone: {
    type: String,
    required: true,
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: {
      type: String,
      default: 'India',
    },
  },
  kycStatus: {
    type: String,
    enum: ['pending', 'submitted', 'approved', 'rejected'],
    default: 'pending',
  },
  kycSubmittedAt: {
    type: Date,
  },
  kycApprovedAt: {
    type: Date,
  },
  kycRejectedAt: {
    type: Date,
  },
  kycRejectedReason: {
    type: String,
  },
  agreementSigned: {
    type: Boolean,
    default: false,
  },
  agreementSignedAt: {
    type: Date,
  },
  credits: {
    type: Number,
    default: 0,
  },
  totalCreditsPurchased: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Field to track assigned packages
  assignedPackages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package'
  }],
  // Custom certificate name for display on certificate
  certificateName: {
    type: String,
    trim: true,
  },
  // PAN details
  panNumber: {
    type: String,
    trim: true,
  },
  panDetails: {
    type: mongoose.Schema.Types.Mixed, // Store full PAN comprehensive response
  },
  // Bank details
  bankAccountNumber: {
    type: String,
    trim: true,
  },
  bankIfscCode: {
    type: String,
    trim: true,
  },
  bankDetails: {
    type: mongoose.Schema.Types.Mixed, // Store full bank verification response
  },
  
  // Package upgrade history
  packageHistory: [{
    packageName: String,
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package'
    },
    price: Number,
    creditsIncluded: Number,
    upgradeDate: {
      type: Date,
      default: Date.now
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction'
    }
  }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('Franchise', franchiseSchema);