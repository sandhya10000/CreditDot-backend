'use strict';

const mongoose = require('mongoose');

/**
 * BsaLayoutProfile Schema
 * Caches learned parsing layouts per bank / layout fingerprint.
 */
const bsaLayoutProfileSchema = new mongoose.Schema(
  {
    // SHA-256 of (IFSC prefix + normalized column headers + column x-bands)
    fingerprintHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    bankName: {
      type: String,
      required: true,
      index: true,
    },

    ifscPrefix: {
      type: String,
      default: '',
      index: true,
    },

    normalizedHeaders: {
      type: [String],
      default: [],
    },

    // Learned column bounding x-bands: [{ name: 'date', minX: 40, maxX: 90, centerX: 65 }]
    columnBands: [
      {
        name: { type: String, required: true },
        minX: { type: Number, required: true },
        maxX: { type: Number, required: true },
        centerX: { type: Number, default: 0 },
      },
    ],

    // Common date formats found in statements for this layout, e.g. ['DD/MM/YYYY', 'DD-MM-YYYY']
    dateFormats: {
      type: [String],
      default: ['DD/MM/YYYY'],
    },

    // Transaction amount layout & polarity convention
    amountConvention: {
      type: String,
      enum: ['SPLIT_DR_CR', 'SINGLE_SIGNED', 'SINGLE_UNSIGNED_BALANCE_DELTA'],
      default: 'SPLIT_DR_CR',
    },

    // Chronological order: ASC (oldest first) or DESC (latest first)
    sortOrder: {
      type: String,
      enum: ['ASC', 'DESC'],
      default: 'ASC',
    },

    // Balance representation (e.g., 'CR_DR_SUFFIX', 'SIGNED', 'STANDARD')
    balanceFormat: {
      type: String,
      default: 'STANDARD',
    },

    // Noise regex patterns to strip (e.g. repeated page footers, URL prints, report codes)
    noisePatterns: {
      type: [String],
      default: [],
    },

    // Success rate percentage (0 - 100)
    successRate: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },

    // Historical tally of times this layout was matched
    totalSeen: {
      type: Number,
      default: 1,
    },

    // Track total successes and failures for accurate successRate recalculation
    successfulParses: {
      type: Number,
      default: 1,
    },

    failedParses: {
      type: Number,
      default: 0,
    },

    // Additional layout / sample details
    sampleMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

bsaLayoutProfileSchema.index({ bankName: 1, ifscPrefix: 1 });
bsaLayoutProfileSchema.index({ successRate: -1 });

module.exports = mongoose.model('BsaLayoutProfile', bsaLayoutProfileSchema);

