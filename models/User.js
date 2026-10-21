const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      required: false,
      default: "",
    },
    state: {
      type: String,
      required: true,
    },
    pincode: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: false, // Make password optional for now
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["admin", "franchise_user"],
      default: "franchise_user",
    },
    subRole: {
      type: String,
      enum: [
        "super_admin",
        "relationship_manager",
        "credit_analyst",
        "franchise",
      ],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    relationshipManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RelationshipManager",
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    // Invite / credentials tracking
    lastLoginAt: {
      type: Date,
      default: null,
    },
    credentialsSentAt: {
      type: Date,
      default: null,
    },
    credentialsSentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ email: 1, isDeleted: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

// Hash password before saving
userSchema.pre("save", async function (next) {
  // Only hash the password if it's provided and modified
  if (!this.isModified("password") || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  // If no password is set, return false
  if (!this.password) {
    return false;
  }

  try {
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    return isMatch;
  } catch (error) {
    console.error("Password comparison error:", error);
    return false;
  }
};

module.exports = mongoose.model("User", userSchema);
