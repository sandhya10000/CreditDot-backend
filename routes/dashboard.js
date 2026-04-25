const express = require('express');
const {
  getFranchiseDashboard,
  getFranchiseLeads,
  createLead,
  getFranchiseLeadById,
  updateFranchiseLead,
  getFranchiseTransactions,
  getPackagesForPurchase,
  getFranchiseReferrals,
  createReferral,
  getFranchisePayouts,
} = require('../controllers/dashboardController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/dashboard
// @desc    Get franchise dashboard
// @access  Private/Franchise User
router.get('/', auth, rbac('franchise_user'), getFranchiseDashboard);

// @route   GET /api/dashboard/leads
// @desc    Get franchise leads
// @access  Private/Franchise User
router.get('/leads', auth, rbac('franchise_user'), getFranchiseLeads);

// @route   POST /api/dashboard/leads
// @desc    Create lead
// @access  Private/Franchise User
router.post('/leads', auth, rbac('franchise_user'), createLead);

// @route   GET /api/dashboard/leads/:id
// @desc    Get lead by ID
// @access  Private/Franchise User
router.get('/leads/:id', auth, rbac('franchise_user'), getFranchiseLeadById);

// @route   PUT /api/dashboard/leads/:id
// @desc    Update lead
// @access  Private/Franchise User
router.put('/leads/:id', auth, rbac('franchise_user'), updateFranchiseLead);

// @route   GET /api/dashboard/transactions
// @desc    Get franchise transactions
// @access  Private/Franchise User
router.get('/transactions', auth, rbac('franchise_user'), getFranchiseTransactions);

// @route   GET /api/dashboard/packages
// @desc    Get packages for purchase
// @access  Private/Franchise User
router.get('/packages', auth, rbac('franchise_user'), getPackagesForPurchase);

// @route   GET /api/dashboard/referrals
// @desc    Get franchise referrals
// @access  Private/Franchise User
router.get('/referrals', auth, rbac('franchise_user'), getFranchiseReferrals);

// @route   POST /api/dashboard/referrals
// @desc    Create referral
// @access  Private/Franchise User
router.post('/referrals', auth, rbac('franchise_user'), createReferral);

// @route   GET /api/dashboard/payouts
// @desc    Get franchise payouts
// @access  Private/Franchise User
router.get('/payouts', auth, rbac('franchise_user'), getFranchisePayouts);

module.exports = router;