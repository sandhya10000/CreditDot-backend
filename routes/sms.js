const express = require('express');
const router = express.Router();
const smsController = require('../controllers/smsController');
const { authenticateToken } = require('../middleware/auth');

// Public routes for OTP
router.post('/send-otp', smsController.sendOTP);
router.post('/verify-otp', smsController.verifyOTP);
router.post('/resend-otp', smsController.resendOTP);

module.exports = router;