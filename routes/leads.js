const express = require('express');
const { getFranchiseLeads, updateLeadStatus } = require('../controllers/leadController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   GET /api/leads/franchise
// @desc    Get leads assigned to the franchise user
// @access  Private/Franchise User
router.get('/franchise', auth, rbac('franchise_user'), getFranchiseLeads);

// @route   PUT /api/leads/:leadId/status
// @desc    Update lead status by franchise user
// @access  Private/Franchise User
router.put('/:leadId/status', auth, rbac('franchise_user'), updateLeadStatus);

module.exports = router;