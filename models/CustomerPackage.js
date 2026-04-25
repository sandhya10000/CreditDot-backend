const mongoose = require('mongoose');

const customerPackageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: { 
    type: String,
    required: true,
  }, 
  price: { 
    type: Number,
    required: true,    
    min: 0,
  },
  gstPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  creditsIncluded: {
    type: Number,
    required: true,
    min: 0,
  },
  features: [{ 
    type: String,
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  // Business payout settings
  businessPayoutPercentage: {
    type: Number,
    default: 20, // Default 20% payout
    min: 0,
    max: 100,
  },
  businessPayoutType: {
    type: String,
    enum: ['fixed', 'percentage'],
    default: 'percentage',
  },
  businessPayoutFixedAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Note: Payouts are calculated on base price (price field), not including GST
  // Franchise packages that can access this customer package
  availableForPackages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
  }],
}, {
  timestamps: true,
});

// Set default value for features array
customerPackageSchema.path('features').default(() => []);

module.exports = mongoose.model('CustomerPackage', customerPackageSchema);