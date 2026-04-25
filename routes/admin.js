const express = require('express');
const {
  getDashboardStats,
  getRecentActivities,
  getAllUsers,
  getUserById,
  updateUser,
  createLead,
  getAllLeads,
  getLeadById,
  updateLead,
  deleteLead,
  getAllTransactions,
  getTransactionById,
  getAllPayouts,
  updatePayout,
  getAllReferrals,
  getReferralSettings,
  updateReferralSettings,
  getAllCreditReportsAdmin,
  getSettings,
  updateSetting,
  getAllFranchises,
  getFranchiseById,
  updateFranchise,
  activateFranchise,
  deactivateFranchise,
  createFranchiseUser,
  approveRegistration,
  rejectRegistration,
  deleteFranchise,
  updateFranchiseCertificateName,
  getPerformanceOverview,
  // Credit recharge functions
  getAllFranchisesWithCredits,
  rechargeFranchiseCredits,
  getCreditRechargeHistory,
  calculateFranchisePayouts,
  getFranchisePayouts,
  bulkUploadLeads,
  csvUpload,
} = require('../controllers/adminController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private/Admin
router.get('/dashboard', auth, rbac('admin'), getDashboardStats);

// @route   GET /api/admin/dashboard/activities
// @desc    Get recent activities for admin dashboard
// @access  Private/Admin
router.get('/dashboard/activities', auth, rbac('admin'), getRecentActivities);

// @route   GET /api/admin/dashboard/performance
// @desc    Get performance overview data for admin dashboard
// @access  Private/Admin
router.get('/dashboard/performance', auth, rbac('admin'), getPerformanceOverview);

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get('/users', auth, rbac('admin'), getAllUsers);

// @route   GET /api/admin/users/:id
// @desc    Get user by ID
// @access  Private/Admin
router.get('/users/:id', auth, rbac('admin'), getUserById);

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Private/Admin
router.put('/users/:id', auth, rbac('admin'), updateUser);

// @route   POST /api/admin/leads
// @desc    Create new lead
// @access  Private/Admin
router.post('/leads', auth, rbac('admin'), createLead);

// @route   POST /api/admin/leads/bulk-upload
// @desc    Bulk upload leads from CSV file
// @access  Private/Admin
router.post('/leads/bulk-upload', auth, rbac('admin'), csvUpload.single('csvFile'), bulkUploadLeads);

// @route   GET /api/admin/leads
// @desc    Get all leads
// @access  Private/Admin
router.get('/leads', auth, rbac('admin'), getAllLeads);

// @route   GET /api/admin/leads/:id
// @desc    Get lead by ID
// @access  Private/Admin
router.get('/leads/:id', auth, rbac('admin'), getLeadById);

// @route   PUT /api/admin/leads/:id
// @desc    Update lead
// @access  Private/Admin
router.put('/leads/:id', auth, rbac('admin'), updateLead);

// @route   DELETE /api/admin/leads/:id
// @desc    Delete lead
// @access  Private/Admin
router.delete('/leads/:id', auth, rbac('admin'), deleteLead);

// @route   GET /api/admin/transactions
// @desc    Get all transactions
// @access  Private/Admin
router.get('/transactions', auth, rbac('admin'), getAllTransactions);

// @route   GET /api/admin/transactions/:id
// @desc    Get transaction by ID
// @access  Private/Admin
router.get('/transactions/:id', auth, rbac('admin'), getTransactionById);

// @route   GET /api/admin/payouts
// @desc    Get all payouts
// @access  Private/Admin
router.get('/payouts', auth, rbac('admin'), getAllPayouts);

// @route   PUT /api/admin/payouts/:id
// @desc    Update payout
// @access  Private/Admin
router.put('/payouts/:id', auth, rbac('admin'), updatePayout);

// @route   POST /api/admin/payouts/calculate
// @desc    Calculate payout for a franchise
// @access  Private/Admin
router.post('/payouts/calculate', auth, rbac('admin'), calculateFranchisePayouts);

// @route   GET /api/admin/payouts/franchise/:franchiseId
// @desc    Get payouts for a specific franchise
// @access  Private/Admin
router.get('/payouts/franchise/:franchiseId', auth, rbac('admin'), getFranchisePayouts);

// @route   GET /api/admin/referrals
// @desc    Get all referrals
// @access  Private/Admin
router.get('/referrals', auth, rbac('admin'), getAllReferrals);

// @route   GET /api/admin/referral-settings
// @desc    Get referral settings
// @access  Private/Admin
router.get('/referral-settings', auth, rbac('admin'), getReferralSettings);

// @route   PUT /api/admin/referral-settings
// @desc    Update referral settings
// @access  Private/Admin
router.put('/referral-settings', auth, rbac('admin'), updateReferralSettings);

// @route   GET /api/admin/credit-reports
// @desc    Get all credit reports
// @access  Private/Admin
router.get('/credit-reports', auth, rbac('admin'), getAllCreditReportsAdmin);

// @route   GET /api/admin/franchises/credits
// @desc    Get all franchises with credit information
// @access  Private/Admin
router.get('/franchises/credits', auth, rbac('admin'), getAllFranchisesWithCredits);

// @route   POST /api/admin/franchises/recharge
// @desc    Recharge credits for a franchise
// @access  Private/Admin
router.post('/franchises/recharge', auth, rbac('admin'), rechargeFranchiseCredits);

// @route   GET /api/admin/credits/history
// @desc    Get credit recharge history
// @access  Private/Admin
router.get('/credits/history', auth, rbac('admin'), getCreditRechargeHistory);

// @route   GET /api/admin/settings
// @desc    Get all settings
// @access  Private/Admin
router.get('/settings', auth, rbac('admin'), getSettings);

// @route   PUT /api/admin/settings
// @desc    Update setting
// @access  Private/Admin
router.put('/settings', auth, rbac('admin'), updateSetting);

// @route   POST /api/admin/franchises
// @desc    Create franchise user by admin
// @access  Private/Admin
router.post('/franchises', auth, rbac('admin'), createFranchiseUser);

// @route   PUT /api/admin/franchises/:id/approve-registration
// @desc    Approve franchise registration
// @access  Private/Admin
router.put('/franchises/:id/approve-registration', auth, rbac('admin'), approveRegistration);

// @route   PUT /api/admin/franchises/:id/reject-registration
// @desc    Reject franchise registration
// @access  Private/Admin
router.put('/franchises/:id/reject-registration', auth, rbac('admin'), rejectRegistration);

// @route   DELETE /api/admin/franchises/:id
// @desc    Delete franchise
// @access  Private/Admin
router.delete('/franchises/:id', auth, rbac('admin'), deleteFranchise);

// @route   PUT /api/admin/franchises/certificate-name
// @desc    Update franchise certificate name
// @access  Private/Admin
router.put('/franchises/certificate-name', auth, rbac('admin'), updateFranchiseCertificateName);

// Credit recharge routes

module.exports = router;