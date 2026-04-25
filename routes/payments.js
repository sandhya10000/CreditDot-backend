const express = require('express');
const {
  createOrder,
  verifyPayment,
  handleWebhook,
} = require('../controllers/paymentController');
const auth = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/payments/create-order
// @desc    Create Razorpay order
// @access  Private
router.post('/create-order', auth, createOrder);

// @route   POST /api/payments/verify-payment
// @desc    Verify Razorpay payment
// @access  Private
router.post('/verify-payment', auth, verifyPayment);

// @route   POST /api/payments/webhook
// @desc    Handle Razorpay webhook
// @access  Public
router.post('/webhook', handleWebhook);

module.exports = router;