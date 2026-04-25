const express = require('express');
const {
  submitKyc,
  getKycStatus,
  getKycByFranchiseId,
  getPendingKycRequests,
  approveKyc,
  rejectKyc,
  initializeDigiLocker  // Add the new function
} = require('../controllers/kycController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const { upload } = require('../utils/fileUpload');

const router = express.Router();

// @route   POST /api/kyc/submit
// @desc    Submit KYC documents
// @access  Private/Franchise User
router.post('/submit', auth, rbac('franchise_user'), upload.fields([
  { name: 'aadhaarFrontDocument', maxCount: 1 },
  { name: 'aadhaarBackDocument', maxCount: 1 },
  { name: 'panDocument', maxCount: 1 },
  { name: 'businessRegistrationDocument', maxCount: 1 }
]), submitKyc);

// @route   GET /api/kyc/status
// @desc    Get KYC status
// @access  Private/Franchise User
router.get('/status', auth, rbac('franchise_user'), getKycStatus);

// @route   GET /api/kyc/franchise/:franchiseId
// @desc    Get KYC request by franchise ID
// @access  Private/Admin
router.get('/franchise/:franchiseId', auth, rbac('admin'), getKycByFranchiseId);

// @route   GET /api/kyc/pending
// @desc    Get all pending KYC requests
// @access  Private/Admin
router.get('/pending', auth, rbac('admin'), getPendingKycRequests);

// @route   PUT /api/kyc/approve/:id
// @desc    Approve KYC request
// @access  Private/Admin
router.put('/approve/:id', auth, rbac('admin'), approveKyc);

// @route   PUT /api/kyc/reject/:id
// @desc    Reject KYC request
// @access  Private/Admin
router.put('/reject/:id', auth, rbac('admin'), rejectKyc);

// @route   POST /api/kyc/digilocker/init
// @desc    Initialize DigiLocker SDK for franchise user
// @access  Private/Franchise User
router.post('/digilocker/init', auth, rbac('franchise_user'), initializeDigiLocker);

module.exports = router;