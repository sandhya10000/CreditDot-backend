const express = require('express');
const {
  getPackages,
  getAllPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
} = require('../controllers/packageController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/packages
// @desc    Get all active packages
// @access  Public
router.get('/', getPackages);

// @route   GET /api/packages/all
// @desc    Get all packages (admin only)
// @access  Private/Admin
router.get('/all', auth, rbac('admin'), getAllPackages);

// @route   GET /api/packages/:id
// @desc    Get package by ID
// @access  Public
router.get('/:id', getPackageById);

// @route   POST /api/packages
// @desc    Create new package
// @access  Private/Admin
router.post('/', auth, rbac('admin'), createPackage);

// @route   PUT /api/packages/:id
// @desc    Update package
// @access  Private/Admin
router.put('/:id', auth, rbac('admin'), updatePackage);

// @route   DELETE /api/packages/:id
// @desc    Delete package
// @access  Private/Admin
router.delete('/:id', auth, rbac('admin'), deletePackage);

module.exports = router;