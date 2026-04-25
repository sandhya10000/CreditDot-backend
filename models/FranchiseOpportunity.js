const mongoose = require('mongoose');

const franchiseOpportunitySchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  mobileNumber: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  profession: {
    type: String,
    required: true,
  },
  message: {
    type: String,
  },
  consent: {
    type: Boolean,
    required: true,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('FranchiseOpportunity', franchiseOpportunitySchema);