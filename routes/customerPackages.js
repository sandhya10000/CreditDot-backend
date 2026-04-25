const express = require('express');
const {
  getCustomerPackages,
  getAllCustomerPackages,
  getCustomerPackageById,
  createCustomerPackage,
  updateCustomerPackage,
  deleteCustomerPackage,
} = require('../controllers/customerPackageController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/customer-packages
// @desc    Get all active customer packages
// @access  Public
router.get('/', getCustomerPackages);

// @route   GET /api/customer-packages/all
// @desc    Get all customer packages (admin only)
// @access  Private/Admin
router.get('/all', auth, rbac('admin'), getAllCustomerPackages);

// @route   GET /api/customer-packages/:id
// @desc    Get customer package by ID
// @access  Public
router.get('/:id', getCustomerPackageById);

// @route   POST /api/customer-packages
// @desc    Create new customer package (admin only)
// @access  Private/Admin
router.post('/', auth, rbac('admin'), createCustomerPackage);

// @route   PUT /api/customer-packages/:id
// @desc    Update customer package (admin only)
// @access  Private/Admin
router.put('/:id', auth, rbac('admin'), updateCustomerPackage);

// @route   DELETE /api/customer-packages/:id
// @desc    Delete customer package (admin only)
// @access  Private/Admin
router.delete('/:id', auth, rbac('admin'), deleteCustomerPackage);

module.exports = router;