const crypto = require("crypto");
const cashfree = require("../utils/cashfree");
const { generateOrderId, normalizePhone } = cashfree;
const Transaction = require("../models/Transaction");
const Package = require("../models/Package");
const Franchise = require("../models/Franchise");
const User = require("../models/User");
const {
  sendPaymentSuccessEmail,
  sendAccountCredentialsEmail,
} = require("../utils/emailService");
const bcrypt = require("bcryptjs");
const { processReferralBonus } = require("../utils/referralUtils");

// Import the digital agreement controller to update package details
const {
  updateAgreementPackageDetails,
} = require("./digitalAgreementController");

const BusinessForm = require("../models/BusinessForm");
const ManualPayment = require("../models/ManualPayment");
const { applyLinkStatus } = require("./manualPaymentController");
const { assignCustomerId, settleBusinessFormOrder } = require("./businessController");
const { settleWhiteLabelOrder } = require("./whiteLabelController");

// Frontend pages Cashfree may send the buyer back to after a redirect-based payment
const RETURN_PATHS = ["/franchise/payment", "/franchise/upgrade-package", "/packages"];

// Create order (Cashfree)
const createOrder = async (req, res) => {
  try {
    const { packageId, returnPath } = req.body;
    const userId = req.user.id; // Get user ID from authenticated user

    // Validate user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validate package
    const pkg = await Package.findById(packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ message: "Package not found or inactive" });
    }

    // Cashfree requires a customer phone on every order
    let phone = normalizePhone(user.phone);
    if (!phone) {
      const franchise = await Franchise.findOne({ userId: user._id }).select("phone");
      phone = normalizePhone(franchise?.phone);
    }
    if (!phone) {
      return res.status(400).json({
        message: "A valid 10-digit phone number is required for payment. Please update your profile.",
      });
    }

    const GST_RATE = 18;

    const baseAmount = pkg.price;
    const gstAmount = (baseAmount * GST_RATE) / 100;
    const totalAmount = Math.round((baseAmount + gstAmount) * 100) / 100;

    const orderId = generateOrderId("PKG");
    const order = await cashfree.createOrder({
      orderId,
      amount: totalAmount,
      customer: { id: user._id, name: user.name, email: user.email, phone },
      returnPath: RETURN_PATHS.includes(returnPath) ? returnPath : RETURN_PATHS[0],
      note: `Package: ${pkg.name}`,
    });

    // Save transaction
    const transaction = new Transaction({
      userId: user._id,
      packageId: pkg._id,
      orderId,
      cfOrderId: order.cf_order_id ? String(order.cf_order_id) : undefined,
      amount: totalAmount,
      currency: "INR",
      status: "created",
      gateway: "cashfree",
      paymentMethod: "cashfree",
    });
    await transaction.save();

    res.json({
      orderId,
      paymentSessionId: order.payment_session_id,
      amount: totalAmount,
      currency: "INR",
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error("Error in createOrder:", error);
    res.status(500).json({ message: "Could not start payment", error: error.message });
  }
};

// Applies a paid package purchase: credits, packages, referral, agreement, emails.
// Idempotent: only the caller that flips the transaction to "paid" runs the side effects,
// so verify, webhook and reconcile can all call it safely.
const fulfillPackageTransaction = async (transactionId, { paymentId } = {}) => {
  const transaction = await Transaction.findOneAndUpdate(
    { _id: transactionId, status: { $ne: "paid" } },
    {
      $set: {
        status: "paid",
        ...(paymentId && { paymentId, cfPaymentId: paymentId }),
      },
    },
    { new: true },
  );
  if (!transaction) {
    return { transaction: await Transaction.findById(transactionId), alreadyPaid: true };
  }

    // Update franchise credits and package access
    const franchise = await Franchise.findOne({ userId: transaction.userId });
    if (franchise) {
      const pkg = await Package.findById(transaction.packageId);
      if (pkg) {
        // Get the previous package before updating
        const previousPackageIds = [...franchise.assignedPackages];

        franchise.credits += pkg.creditsIncluded;
        franchise.totalCreditsPurchased += pkg.creditsIncluded;

        // Get all previous paid transactions for this user to identify previously purchased packages
        const previousTransactions = await Transaction.find({
          userId: transaction.userId,
          status: "paid",
          _id: { $ne: transaction._id }, // Exclude current transaction
        }).populate("packageId");

        // Identify package IDs that were added due to previous purchases
        const previouslyPurchasedPackageIds = previousTransactions
          .filter((tx) => tx.packageId) // Only transactions with packages
          .map((tx) => tx.packageId._id.toString());

        // Filter out previously purchased packages from assignedPackages
        // This prevents accumulation of old purchased packages when upgrading
        franchise.assignedPackages = franchise.assignedPackages.filter(
          (pkg) => !previouslyPurchasedPackageIds.includes(pkg.toString()),
        );

        // Add the newly purchased package
        const newPackageIdString = transaction.packageId.toString();
        if (
          !franchise.assignedPackages.some(
            (pkg) => pkg.toString() === newPackageIdString,
          )
        ) {
          franchise.assignedPackages.push(transaction.packageId);
        }

        await franchise.save();

        // Process referral bonus if applicable
        await processReferralBonus(franchise._id, pkg._id, pkg.price);

        // Update digital agreement with package details
        try {
          await updateAgreementPackageDetails(transaction.userId, {
            price: `Rs. ${pkg.price}`,
            name: pkg.name,
            credits: pkg.creditsIncluded,
          });
        } catch (agreementError) {
          console.error(
            "Failed to update digital agreement with package details:",
            agreementError,
          );
        }

        // Check if this is a package upgrade (user had previous packages)
        if (previousPackageIds.length > 0) {
          // Get the previous package that was replaced
          const previousPackage = await Package.findById(previousPackageIds[0]); // Assuming single package at a time

          // Add to package history
          franchise.packageHistory.push({
            packageName: pkg.name,
            packageId: pkg._id,
            price: pkg.price,
            creditsIncluded: pkg.creditsIncluded,
            upgradeDate: new Date(),
            transactionId: transaction._id,
          });

          // Save the updated franchise with package history
          await franchise.save();

          // Send package upgrade notification
          try {
            const {
              sendPackageUpgradeNotification,
            } = require("../utils/emailService");
            const user = await User.findById(transaction.userId);
            await sendPackageUpgradeNotification(
              user,
              franchise,
              previousPackage,
              pkg,
              transaction,
            );
          } catch (notificationError) {
            console.error(
              "Failed to send package upgrade notification:",
              notificationError,
            );
          }
        } else {
          // For first-time package purchase, add to package history
          franchise.packageHistory.push({
            packageName: pkg.name,
            packageId: pkg._id,
            price: pkg.price,
            creditsIncluded: pkg.creditsIncluded,
            upgradeDate: new Date(),
            transactionId: transaction._id,
          });

          // Save the updated franchise with package history
          await franchise.save();
        }
      }
    }

    // Get user details
    const user = await User.findById(transaction.userId);

    // If user doesn't have a password set (temporary password), generate and send credentials
    // Check if user has a temporary password by comparing with the hashed version
    if (user && (!user.password || (await isTempPassword(user.password)))) {
      // Generate a random password
      const generatedPassword = Math.random().toString(36).slice(-8);

      // Update user with the new password (will be hashed by pre-save hook)
      user.password = generatedPassword;
      await user.save();

      // Send account credentials email
      try {
        await sendAccountCredentialsEmail(user, generatedPassword);
      } catch (emailError) {
        console.error("Failed to send account credentials email:", emailError);
      }
    }

    // Send payment success email
    if (user) {
      const pkg = await Package.findById(transaction.packageId);
      if (pkg) {
        try {
          await sendPaymentSuccessEmail(user, transaction, pkg);
        } catch (emailError) {
          console.error("Failed to send payment success email:", emailError);
        }
      }
    }

  return { transaction, alreadyPaid: false };
};

// Checks a package order with Cashfree and fulfils it if paid. Used by webhook + reconcile.
const settlePackageOrder = async (orderId) => {
  const transaction = await Transaction.findOne({ orderId, gateway: "cashfree" });
  if (!transaction || transaction.status === "paid") return transaction;

  const { paid, cfPaymentId } = await cashfree.confirmOrderPaid(orderId, transaction.amount);
  if (!paid) return transaction;

  const result = await fulfillPackageTransaction(transaction._id, { paymentId: cfPaymentId });
  return result.transaction;
};

// Verify payment (Cashfree). Body: { orderId }
// Cashfree has no client-side signature, so the order status is read from Cashfree.
const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const transaction = await Transaction.findOne({ orderId, userId: req.user.id });
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.status === "paid") {
      return res.json({ message: "Payment verified successfully", transaction });
    }
    if (transaction.gateway !== "cashfree") {
      return res.status(400).json({ message: "Payment verification failed" });
    }

    const { paid, status, cfPaymentId } = await cashfree.confirmOrderPaid(
      orderId,
      transaction.amount,
    );
    if (!paid) {
      return res.status(400).json({ message: "Payment not completed", status });
    }

    const result = await fulfillPackageTransaction(transaction._id, { paymentId: cfPaymentId });

    res.json({
      message: "Payment verified successfully",
      transaction: result.transaction,
    });
  } catch (error) {
    console.error("Error in verifyPayment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Helper function to check if password is the temporary one
const isTempPassword = async (hashedPassword) => {
  try {
    // Compare the hashed password with the hashed version of 'temp_password'
    return await bcrypt.compare("temp_password", hashedPassword);
  } catch (error) {
    console.error("Error comparing temp password:", error);
    return false;
  }
};

// Webhook handler for Razorpay (legacy: only finishes orders/links created before the Cashfree switch)
const handleWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const shasum = crypto.createHmac("sha256", secret);
    // Razorpay signs the exact bytes it sent; prefer the raw body captured by express.json
    shasum.update(req.rawBody ?? JSON.stringify(req.body));
    const digest = shasum.digest("hex");

    if (digest !== req.headers["x-razorpay-signature"]) {
      return res
        .status(400)
        .json({ message: "Webhook signature verification failed" });
    }

    // Process event
    const event = req.body.event;
    const payload = req.body.payload;

    switch (event) {
      case "payment.captured":
        // Handle successful payment
        console.log("Payment captured:", payload);
        const paymentEntity = payload.payment?.entity;
        const orderId = paymentEntity?.order_id;

        if (orderId) {
          // Update BusinessForm if this order belongs to a business form
          const businessForm = await BusinessForm.findOne({
            razorpayOrderId: orderId,
          });
          if (businessForm && businessForm.paymentStatus !== "paid") {
            businessForm.paymentStatus = "paid";
            businessForm.razorpayPaymentId = paymentEntity.id;
            await assignCustomerId(businessForm);
            await businessForm.save();
            console.log(
              `Webhook: BusinessForm ${businessForm._id} marked as paid`,
            );
          }
        }
        break;

      case "payment.failed":
        // Handle failed payment
        console.log("Payment failed:", payload);
        break;

      case "payment_link.paid":
      case "payment_link.partially_paid":
      case "payment_link.expired":
      case "payment_link.cancelled": {
        // Manual Payments: status comes from the payment link, not the payment
        const linkId = payload.payment_link?.entity?.id;
        const linkPaymentId = payload.payment?.entity?.id;
        const doc = linkId
          ? await ManualPayment.findOne({ razorpayLinkId: linkId })
          : null;
        if (doc) {
          const statusFromEvent = event.replace("payment_link.", "");
          await applyLinkStatus(doc, statusFromEvent, linkPaymentId);
          console.log(`Webhook: ManualPayment ${doc._id} -> ${doc.status}`);
        } else {
          console.log("Webhook: no ManualPayment for link", linkId);
        }
        break;
      }

      default:
        console.log("Unhandled event:", event);
    }

    res.json({ message: "Webhook received" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Routes a Cashfree order to its flow by order ID prefix (see generateOrderId callers)
const settleCashfreeOrder = async (orderId) => {
  if (!orderId) return;
  if (orderId.startsWith("PKG_")) return settlePackageOrder(orderId);
  if (orderId.startsWith("BIZ_")) return settleBusinessFormOrder(orderId);
  if (orderId.startsWith("WL_")) return settleWhiteLabelOrder(orderId);
  console.log("Cashfree webhook: unknown order prefix", orderId);
};

// POST /api/payments/cashfree/webhook
const handleCashfreeWebhook = async (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  if (!cashfree.verifyWebhookSignature(req.rawBody, timestamp, signature)) {
    return res.status(401).json({ message: "Webhook signature verification failed" });
  }

  const { type, data } = req.body || {};
  try {
    switch (type) {
      case "PAYMENT_SUCCESS_WEBHOOK":
        // Each flow re-checks the order with Cashfree before fulfilling
        await settleCashfreeOrder(data?.order?.order_id);
        break;

      case "PAYMENT_FAILED_WEBHOOK":
      case "PAYMENT_USER_DROPPED_WEBHOOK":
        // A failed attempt does not close the order; the buyer can retry on the same order
        console.log(`Cashfree ${type}:`, data?.order?.order_id);
        break;

      case "PAYMENT_LINK_EVENT": {
        const linkId = data?.link_id;
        const doc = linkId ? await ManualPayment.findOne({ cashfreeLinkId: linkId }) : null;
        if (doc) {
          const paymentId = data?.order?.transaction_id
            ? String(data.order.transaction_id)
            : undefined;
          await applyLinkStatus(doc, String(data.link_status || "").toLowerCase(), paymentId);
          console.log(`Cashfree webhook: ManualPayment ${doc._id} -> ${data.link_status}`);
        } else {
          console.log("Cashfree webhook: no ManualPayment for link", linkId);
        }
        break;
      }

      default:
        console.log("Cashfree webhook: unhandled event", type);
    }

    res.json({ message: "Webhook received" });
  } catch (error) {
    // 500 makes Cashfree retry; every handler above is idempotent
    console.error("Cashfree webhook error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  handleWebhook,
  handleCashfreeWebhook,
  fulfillPackageTransaction,
  settlePackageOrder,
};
