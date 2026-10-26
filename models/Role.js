const mongoose = require("mongoose");
const { PERMISSION_KEYS } = require("../config/permissions");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    permissions: [
      {
        type: String,
        enum: PERMISSION_KEYS,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    // Business Manager role: users only see franchises they own
    limitToOwnFranchises: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Drop permission keys that no longer exist (retired sections), so older roles still save
roleSchema.pre("validate", function () {
  this.permissions = this.permissions.filter((key) => PERMISSION_KEYS.includes(key));
});

// Role names are unique regardless of case ("Credit Analyst" = "credit analyst")
roleSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

module.exports = mongoose.model("Role", roleSchema);
