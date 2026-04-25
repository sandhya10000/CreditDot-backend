const CustomerPackage = require("../models/CustomerPackage");
const Franchise = require("../models/Franchise");
const Transaction = require("../models/Transaction");
const Joi = require("joi");

// Validation schema for creating/updating customer packages
const customerPackageSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().required(),
  price: Joi.number().min(0).required(),
  gstPercentage: Joi.number().min(0).max(100).optional(),
  creditsIncluded: Joi.number().min(0).required(),
  features: Joi.array().items(Joi.string()),
  isActive: Joi.boolean(),
  sortOrder: Joi.number(),
  // Business payout settings
  businessPayoutPercentage: Joi.number().min(0).max(100),
  businessPayoutType: Joi.string().valid("fixed", "percentage"),
  businessPayoutFixedAmount: Joi.number().min(0),
  // Available for specific franchise packages
  availableForPackages: Joi.array().items(
    Joi.string().pattern(/^[0-9a-fA-F]{24}$/)
  ), // MongoDB ObjectId pattern
});

// Get all active customer packages
const getCustomerPackages = async (req, res) => {
  try {
    let packages = await CustomerPackage.find({ isActive: true }).sort({
      sortOrder: 1,
    });

    // If user is authenticated as a franchise user, filter packages based on their franchise package
    if (req.user && req.user.role === "franchise_user") {
      // Get the franchise details
      const franchise = await Franchise.findOne({ userId: req.user.id });

      if (franchise) {
        // Get the most recent paid transaction to determine current package
        const latestTransaction = await Transaction.findOne({
          userId: req.user.id,
          status: "paid",
        })
        .populate("packageId")
        .sort({ createdAt: -1 }); // Sort by most recent first

        let accessiblePackageIds = [];

        // Use either the purchased package (if exists) or fall back to assigned packages
        if (latestTransaction && latestTransaction.packageId) {
          // Use only the most recently purchased package
          accessiblePackageIds = [latestTransaction.packageId._id.toString()];
        } else {
          // Fall back to assigned packages if no purchase history
          accessiblePackageIds = franchise.assignedPackages.map((pkg) =>
            pkg.toString()
          );
        };

        // Filter customer packages based on availableForPackages field
        // If availableForPackages is empty/undefined, it means available to all
        packages = packages.filter((pkg) => {
          if (
            !pkg.availableForPackages ||
            pkg.availableForPackages.length === 0
          ) {
            // If no restrictions, make available to all
            return true;
          }
          // Convert ObjectId array to string array for comparison
          const allowedPackageIds = pkg.availableForPackages.map((id) =>
            id.toString()
          );
          // Check if any of the accessible packages match the allowed packages
          return allowedPackageIds.some((allowedPackageId) =>
            accessiblePackageIds.includes(allowedPackageId)
          );
        });

        // Log for debugging
        console.log("Franchise ID:", franchise._id);
        console.log("Accessible Package IDs:", accessiblePackageIds);
        console.log("Filtered packages count:", packages.length);
      }
    }

    res.json(packages);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all customer packages (admin only)
const getAllCustomerPackages = async (req, res) => {
  try {
    const packages = await CustomerPackage.find().sort({ createdAt: -1 });
    res.json(packages);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get customer package by ID
const getCustomerPackageById = async (req, res) => {
  try {
    const package = await CustomerPackage.findById(req.params.id);

    if (!package) {
      return res.status(404).json({ message: "Package not found" });
    }

    res.json(package);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Create new customer package (admin only)
const createCustomerPackage = async (req, res) => {
  try {
    // Validate request body
    const { error } = customerPackageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const customerPackage = new CustomerPackage(req.body);
    await customerPackage.save();

    res.status(201).json({
      message: "Customer package created successfully",
      customerPackage,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update customer package (admin only)
const updateCustomerPackage = async (req, res) => {
  try {
    // Validate request body
    const { error } = customerPackageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const customerPackage = await CustomerPackage.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!customerPackage) {
      return res.status(404).json({ message: "Customer package not found" });
    }

    res.json({
      message: "Customer package updated successfully",
      customerPackage,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete customer package (admin only)
const deleteCustomerPackage = async (req, res) => {
  try {
    const customerPackage = await CustomerPackage.findByIdAndDelete(
      req.params.id
    );

    if (!customerPackage) {
      return res.status(404).json({ message: "Customer package not found" });
    }

    res.json({ message: "Customer package deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getCustomerPackages,
  getAllCustomerPackages,
  getCustomerPackageById,
  createCustomerPackage,
  updateCustomerPackage,
  deleteCustomerPackage,
};
