const Package = require('../models/Package');
const Joi = require('joi');

// Validation schema for creating/updating packages
const packageSchema = Joi.object({
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
  businessPayoutType: Joi.string().valid('fixed', 'percentage'),
  businessPayoutFixedAmount: Joi.number().min(0),
});

// Get all active packages
const getPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all packages (admin only)
const getAllPackages = async (req, res) => {
  try {
    const packages = await Package.find().sort({ createdAt: -1 });
    res.json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get package by ID
const getPackageById = async (req, res) => {
  try {
    const package = await Package.findById(req.params.id);
    
    if (!package) {
      return res.status(404).json({ message: 'Package not found' });
    }
    
    res.json(package);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create new package (admin only)
const createPackage = async (req, res) => {
  try {
    // Validate request body
    const { error } = packageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: 'Validation error',
        details: error.details[0].message
      });
    }
    
    const package = new Package(req.body);
    await package.save();
    
    res.status(201).json({
      message: 'Package created successfully',
      package
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update package (admin only)
const updatePackage = async (req, res) => {
  try {
    // Validate request body
    const { error } = packageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: 'Validation error',
        details: error.details[0].message
      });
    }
    
    const package = await Package.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!package) {
      return res.status(404).json({ message: 'Package not found' });
    }
    
    res.json({
      message: 'Package updated successfully',
      package
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete package (admin only)
const deletePackage = async (req, res) => {
  try {
    const package = await Package.findByIdAndDelete(req.params.id);
    
    if (!package) {
      return res.status(404).json({ message: 'Package not found' });
    }
    
    res.json({ message: 'Package deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getPackages,
  getAllPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
};