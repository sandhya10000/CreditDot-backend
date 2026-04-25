const express = require('express');
const { calculateEMI, generateEmiSchedule } = require('../controllers/emiController');

const router = express.Router();

// @route   POST /api/emi/calculate
// @desc    Calculate EMI
// @access  Public
router.post('/calculate', calculateEMI);

// @route   POST /api/emi/schedule
// @desc    Generate EMI schedule
// @access  Public
router.post('/schedule', generateEmiSchedule);

module.exports = router;