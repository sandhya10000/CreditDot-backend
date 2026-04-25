const express = require('express');
const {
  checkCreditScore,
  checkCreditScorePublic, // Add the new public function
  getCreditReports,
  getAllCreditReports,
  getCreditReportById,
  getSurepassApiKey,
  updateSurepassApiKey,
} = require('../controllers/creditController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   POST /api/credit/check
// @desc    Check credit score
// @access  Private/Franchise User
router.post('/check', auth, rbac('franchise_user'), checkCreditScore);

// @route   POST /api/credit/check-public
// @desc    Check credit score (public endpoint for Experian only)
// @access  Public
router.post('/check-public', checkCreditScorePublic);

// @route   GET /api/credit/reports
// @desc    Get credit reports for franchise
// @access  Private/Franchise User
router.get('/reports', auth, rbac('franchise_user'), getCreditReports);

// @route   GET /api/credit/reports/all
// @desc    Get all credit reports
// @access  Private/Admin
router.get('/reports/all', auth, rbac('admin'), getAllCreditReports);

// @route   GET /api/credit/reports/:id
// @desc    Get credit report by ID
// @access  Private
router.get('/reports/:id', auth, getCreditReportById);

// @route   GET /api/credit/settings/api-key
// @desc    Get Surepass API key
// @access  Private/Admin
router.get('/settings/api-key', auth, rbac('admin'), getSurepassApiKey);

// @route   PUT /api/credit/settings/api-key
// @desc    Update Surepass API key
// @access  Private/Admin
router.put('/settings/api-key', auth, rbac('admin'), updateSurepassApiKey);

module.exports = router;