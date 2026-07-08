const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema(
  {
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
    // creditsIncluded: {
    //   type: Number,
    //   required: true,
    //   min: 0,
    // },
    creditsIncluded: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      validate: {
        validator: function (value) {
          // Diamond package
          if (this.name === "Diamond") {
            return (
              value === "Unlimited" || (typeof value === "number" && value >= 0)
            );
          }

          // Other packages
          return typeof value === "number" && value >= 0;
        },
        message: "Invalid creditsIncluded value",
      },
    },
    features: [
      {
        type: String,
      },
    ],
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
      enum: ["fixed", "percentage"],
      default: "percentage",
    },
    businessPayoutFixedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Note: Payouts are calculated on base price (price field), not including GST
  },
  {
    timestamps: true,
  },
);

// Set default value for features array
packageSchema.path("features").default(() => []);

module.exports = mongoose.model("Package", packageSchema);
