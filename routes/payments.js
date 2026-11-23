const express = require('express');
const {
  createOrder,
  verifyPayment,
  handleWebhook,
  handleCashfreeWebhook,
} = require('../controllers/paymentController');
const auth = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/payments/create-order
// @desc    Create Cashfree order for a package purchase
// @access  Private
router.post('/create-order', auth, createOrder);

// @route   POST /api/payments/verify-payment
// @desc    Verify Cashfree payment (status read from Cashfree)
// @access  Private
router.post('/verify-payment', auth, verifyPayment);

// @route   POST /api/payments/cashfree/webhook
// @desc    Handle Cashfree webhook (orders + payment links)
// @access  Public (signature checked)
router.post('/cashfree/webhook', handleCashfreeWebhook);

// @route   POST /api/payments/webhook
// @desc    Handle Razorpay webhook (legacy, for records created before the Cashfree switch)
// @access  Public
router.post('/webhook', handleWebhook);

module.exports = router;
