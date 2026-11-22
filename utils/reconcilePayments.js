const BusinessForm = require("../models/BusinessForm");
const Transaction = require("../models/Transaction");
const cashfree = require("./cashfree");
const { assignCustomerId, settleBusinessFormOrder } = require("../controllers/businessController");
const { settlePackageOrder } = require("../controllers/paymentController");
const { syncOpenManualPayments } = require("../controllers/manualPaymentController");

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TWO_DAYS = 48 * 60 * 60 * 1000;

// Legacy: forms created before the Cashfree switch still finish on Razorpay.
// Created lazily so the server starts even after the Razorpay keys are removed.
let razorpayClient = null;
const legacyRazorpay = () => {
  if (!razorpayClient) {
    const Razorpay = require("razorpay");
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
};

// Cashfree business-form orders that are still pending (webhook or verify missed)
const reconcileCashfreeBusinessForms = async () => {
  const pendingForms = await BusinessForm.find({
    paymentStatus: "pending",
    cashfreeOrderId: { $exists: true, $ne: null },
    createdAt: { $lte: new Date(Date.now() - FIFTEEN_MINUTES) }, // older than 15min
  }).select("cashfreeOrderId");

  for (const form of pendingForms) {
    try {
      const order = await cashfree.getOrder(form.cashfreeOrderId);
      if (order.order_status === "PAID") {
        await settleBusinessFormOrder(form.cashfreeOrderId);
        console.log(`Reconciled: BusinessForm ${form._id} marked paid (Cashfree)`);
      } else if (["EXPIRED", "TERMINATED"].includes(order.order_status)) {
        await BusinessForm.updateOne(
          { _id: form._id, paymentStatus: "pending" },
          { $set: { paymentStatus: "failed" } },
        );
        console.log(`Reconciled: BusinessForm ${form._id} marked failed (${order.order_status})`);
      }
    } catch (err) {
      console.error(`Cashfree reconciliation failed for BusinessForm ${form._id}:`, err.message);
    }
  }
};

// Legacy Razorpay business-form orders
const reconcileRazorpayBusinessForms = async () => {
  const pendingForms = await BusinessForm.find({
    paymentStatus: "pending",
    razorpayOrderId: { $exists: true, $ne: null },
    createdAt: { $lte: new Date(Date.now() - FIFTEEN_MINUTES) }, // older than 15min
  });
  if (!pendingForms.length) return;

  const razorpay = legacyRazorpay();
  for (const form of pendingForms) {
    try {
      const order = await razorpay.orders.fetch(form.razorpayOrderId);
      if (order.status === "paid") {
        form.paymentStatus = "paid";
        await assignCustomerId(form);

        // Assuming payments for business forms have only one payment captured usually.
        // Get the payments for the order to update the razorpayPaymentId
        const payments = await razorpay.orders.fetchPayments(form.razorpayOrderId);
        if (payments && payments.items && payments.items.length > 0) {
          const capturedPayment = payments.items.find((p) => p.status === "captured");
          if (capturedPayment) {
            form.razorpayPaymentId = capturedPayment.id;
          }
        }

        await form.save();
        console.log(`Reconciled: BusinessForm ${form._id} marked paid`);
      } else if (order.status === "expired") {
        form.paymentStatus = "failed";
        await form.save();
        console.log(`Reconciled: BusinessForm ${form._id} marked failed (expired order)`);
      }
    } catch (err) {
      console.error(`Reconciliation failed for BusinessForm ${form._id}:`, err.message);
    }
  }
};

const reconcilePendingBusinessForms = async () => {
  try {
    await reconcileCashfreeBusinessForms();
    await reconcileRazorpayBusinessForms();
  } catch (error) {
    console.error("Error in reconcilePendingBusinessForms:", error.message);
  }
};

// Package purchases paid on Cashfree where the buyer never came back to verify
const reconcilePendingPackageTransactions = async () => {
  try {
    const now = Date.now();
    const pending = await Transaction.find({
      gateway: "cashfree",
      status: "created",
      createdAt: {
        $lte: new Date(now - FIFTEEN_MINUTES),
        $gte: new Date(now - TWO_DAYS),
      },
    }).select("orderId");

    for (const txn of pending) {
      try {
        const settled = await settlePackageOrder(txn.orderId);
        if (settled?.status === "paid") {
          console.log(`Reconciled: Transaction ${txn._id} marked paid (Cashfree)`);
        }
      } catch (err) {
        console.error(`Reconciliation failed for Transaction ${txn._id}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Error in reconcilePendingPackageTransactions:", error.message);
  }
};

const startPaymentReconciliation = () => {
  // Run every 30 minutes
  setInterval(reconcilePendingBusinessForms, 30 * 60 * 1000);
  setInterval(reconcilePendingPackageTransactions, 30 * 60 * 1000);
  console.log("Payment reconciliation cron started (runs every 30 minutes)");

  // Manual payment links: check open links every 30 seconds so the admin table updates on its own
  setInterval(syncOpenManualPayments, 30 * 1000);
  console.log("Manual payment sync started (runs every 30 seconds)");
};

module.exports = { startPaymentReconciliation };
