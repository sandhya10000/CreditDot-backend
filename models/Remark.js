const mongoose = require("mongoose");
const remarkSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    createdBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },

      name: String,

      role: String,

      // Set when a staff member (not the super admin) wrote the remark
      staffCode: { type: String, default: null },
      roleName: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  },
);
module.exports = mongoose.model("Remark", remarkSchema);
