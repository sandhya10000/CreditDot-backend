const express = require('express');
const {
  getFranchiseProfile,
  updateFranchiseProfile,
  getAllFranchises,
  getFranchiseById,
  updateFranchise,
  deactivateFranchise,
  activateFranchise,
  generateCertificate,
  requestCertificateNameUpdate,
  getPanDetails,
  updatePanDetails,
  fetchPanComprehensive,
  getBankDetails,
  updateBankDetails,
  fetchBankVerification,
} = require('../controllers/franchiseController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/franchises/profile
// @desc    Get franchise profile
// @access  Private/Franchise User
router.get('/profile', auth, rbac('franchise_user'), getFranchiseProfile);

// @route   PUT /api/franchises/profile
// @desc    Update franchise profile
// @access  Private/Franchise User
router.put('/profile', auth, rbac('franchise_user'), updateFranchiseProfile);

// @route   GET /api/franchises/certificate
// @desc    Generate certificate data
// @access  Private/Franchise User
router.get('/certificate', auth, rbac('franchise_user'), generateCertificate);

// @route   PUT /api/franchises/certificate/name
// @desc    Request certificate name update
// @access  Private/Franchise User
router.put('/certificate/name', auth, rbac('franchise_user'), requestCertificateNameUpdate);

// @route   GET /api/franchises/pan
// @desc    Get PAN details
// @access  Private/Franchise User
router.get('/pan', auth, rbac('franchise_user'), getPanDetails);

// @route   PUT /api/franchises/pan
// @desc    Update PAN number
// @access  Private/Franchise User
router.put('/pan', auth, rbac('franchise_user'), updatePanDetails);

// @route   POST /api/franchises/pan/fetch
// @desc    Fetch PAN comprehensive details from Surepass
// @access  Private/Franchise User
router.post('/pan/fetch', auth, rbac('franchise_user'), fetchPanComprehensive);

// @route   GET /api/franchises/bank
// @desc    Get bank details
// @access  Private/Franchise User
router.get('/bank', auth, rbac('franchise_user'), getBankDetails);

// @route   PUT /api/franchises/bank
// @desc    Update bank details
// @access  Private/Franchise User
router.put('/bank', auth, rbac('franchise_user'), updateBankDetails);

// @route   POST /api/franchises/bank/verify
// @desc    Verify bank details with Surepass
// @access  Private/Franchise User
router.post('/bank/verify', auth, rbac('franchise_user'), fetchBankVerification);

// @route   GET /api/franchises
// @desc    Get all franchises
// @access  Private/Admin
router.get('/', auth, rbac('admin'), getAllFranchises);

// @route   GET /api/franchises/:id
// @desc    Get franchise by ID
// @access  Private/Admin
router.get('/:id', auth, rbac('admin'), getFranchiseById);

// @route   PUT /api/franchises/:id
// @desc    Update franchise
// @access  Private/Admin
router.put('/:id', auth, rbac('admin'), updateFranchise);

// @route   PUT /api/franchises/:id/deactivate
// @desc    Deactivate franchise
// @access  Private/Admin
router.put('/:id/deactivate', auth, rbac('admin'), deactivateFranchise);

// @route   PUT /api/franchises/:id/activate
// @desc    Activate franchise
// @access  Private/Admin
router.put('/:id/activate', auth, rbac('admin'), activateFranchise);

module.exports = router;