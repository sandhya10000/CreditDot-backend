const { required } = require("joi");
const mongoose = require("mongoose");

const bureauCredentialSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "",
    },

    password: {
      type: String,
      default: "",
    },

    mobile: {
      type: String,
      default: "",
    },
  },
  { _id: false },
);

const customerBureauSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    bureauCredentials: {
      cibil: {
        type: bureauCredentialSchema,
        default: () => ({}),
      },

      crif: {
        type: bureauCredentialSchema,
        default: () => ({}),
      },

      experian: {
        type: bureauCredentialSchema,
        default: () => ({}),
      },

      equifax: {
        type: bureauCredentialSchema,
        default: () => ({}),
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("customerBureau", customerBureauSchema);
