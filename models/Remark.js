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
    },
  },
  {
    timestamps: true,
  },
);
module.exports = mongoose.model("Remark", remarkSchema);
