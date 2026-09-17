const Razorpay = require("razorpay");
const BusinessForm = require("../models/BusinessForm");
const { assignCustomerId } = require("../controllers/businessController");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const reconcilePendingBusinessForms = async () => {
  try {
    const pendingForms = await BusinessForm.find({
      paymentStatus: "pending",
      razorpayOrderId: { $exists: true, $ne: null },
      createdAt: { $lte: new Date(Date.now() - 15 * 60 * 1000) }, // older than 15min
    });

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
              const capturedPayment = payments.items.find(p => p.status === 'captured');
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
  } catch (error) {
    console.error("Error in reconcilePendingBusinessForms:", error.message);
  }
};

const startPaymentReconciliation = () => {
    // Run every 30 minutes
    setInterval(reconcilePendingBusinessForms, 30 * 60 * 1000);
    console.log("Payment reconciliation cron started (runs every 30 minutes)");
};

module.exports = { startPaymentReconciliation };
