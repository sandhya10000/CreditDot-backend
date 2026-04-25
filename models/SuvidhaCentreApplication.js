const mongoose = require('mongoose');

const suvidhaCentreApplicationSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  mobileNumber: {
    type: String,
    required: true,
  },
  whatsappNumber: {
    type: String,
    required: false,
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
  pincode: {
    type: String,
    required: true,
  },
  occupation: {
    type: String,
    required: true,
  },
  financeExperience: {
    type: String,
    required: true,
  },
  smartphoneLaptop: {
    type: String,
    required: true,
  },
  communication: {
    type: String,
    required: true,
  },
  investmentReadiness: {
    type: String,
    required: true,
  },
  consent: {
    type: Boolean,
    required: true,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('SuvidhaCentreApplication', suvidhaCentreApplicationSchema);