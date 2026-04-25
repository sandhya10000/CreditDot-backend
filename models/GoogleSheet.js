const mongoose = require('mongoose');

const googleSheetSchema = new mongoose.Schema({
  spreadsheetId: {
    type: String,
    required: true, 
    unique: true
  },
  credentials: {
    type: mongoose.Schema.Types.Mixed, // Store encrypted credentials
    required: false
  }, 
  tabs: {
    type: Map,
    of: {
      sheetId: String,
      enabled: { type: Boolean, default: true },
      lastSync: Date
    },
    default: {}
  },
  syncSettings: {
    autoSync: { type: Boolean, default: true },
    syncInterval: { type: Number, default: 300 }, // seconds
    twoWaySync: { type: Boolean, default: true }
  },
  isActive: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GoogleSheet', googleSheetSchema);