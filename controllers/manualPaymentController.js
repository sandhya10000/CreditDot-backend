const Joi = require("joi");
const cashfree = require("../utils/cashfree");
const ManualPayment = require("../models/ManualPayment");
const User = require("../models/User");
const { sendManualPaymentConfirmationEmail } = require("../utils/emailService");
const { isScoped } = require("../utils/franchiseScope");

// Business Managers only see payment links they created (no franchise link exists here)
const ownScope = (req) => (isScoped(req) ? { createdBy: req.user._id } : {});

const LINK_VALIDITY_SECONDS = 24 * 60 * 60;

// New links are always created on Razorpay. Cashfree is only used to refresh, cancel
// and sync links that were created on Cashfree earlier.
// Created lazily so the server starts even if the Razorpay keys are missing.
let razorpayClient = null;
const razorpay = () => {
  if (!razorpayClient) {
    const Razorpay = require("razorpay");
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
};

const isCashfree = (doc) => doc.gateway === "cashfree";
const linkIdOf = (doc) => (isCashfree(doc) ? doc.cashfreeLinkId : doc.razorpayLinkId);

// Mobile and gateway are no longer collected: links are Razorpay-only and the
// customer enters their phone on the Razorpay page
const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email().allow("", null),
  city: Joi.string().trim().max(100).allow("", null),
  amount: Joi.number().min(1).max(1000000).required(),
  remarks: Joi.string().trim().max(500).allow("", null),
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Admin" for full administrators; staff show their role name
const roleLabelOf = (user) => {
  if (!user) return "";
  if (user.staffRole?.name) return user.staffRole.name;
  if (user.role === "admin") return "Admin";
  return "";
};

// List rows carry the creator as { name, roleLabel } instead of a bare id
const withCreator = (payment) => ({
  ...payment,
  createdBy: payment.createdBy
    ? {
        _id: payment.createdBy._id,
        name: payment.createdBy.name || "",
        roleLabel: roleLabelOf(payment.createdBy),
      }
    : null,
});

// POST /api/admin/manual-payments
const createManualPayment = async (req, res) => {
  try {
    const { value, error } = createSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const expireBy = new Date(Date.now() + LINK_VALIDITY_SECONDS * 1000);
    const email = value.email || "";

    const link = await razorpay().paymentLink.create({
      amount: Math.round(value.amount * 100),
      currency: "INR",
      description: value.remarks || "Credit Dost payment",
      customer: {
        name: value.name,
        ...(email && { email }),
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      expire_by: Math.floor(expireBy.getTime() / 1000),
    });

    const doc = await ManualPayment.create({
      name: value.name,
      email,
      city: value.city || "",
      amount: value.amount,
      remarks: value.remarks || "",
      gateway: "razorpay",
      razorpayLinkId: link.id,
      shortUrl: link.short_url,
      expireBy,
      createdBy: req.user?.id,
    });

    res.status(201).json({
      message: "Payment link created",
      payment: doc,
    });
  } catch (error) {
    console.error("Create manual payment error:", error);
    // Razorpay SDK errors carry the reason in error.error.description
    res.status(500).json({
      message: "Failed to create payment link",
      error: error.error?.description || error.message,
    });
  }
};

// GET /api/admin/manual-payments
const listManualPayments = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const search = req.query.search?.trim() || "";
    const status = req.query.status;

    const filter = { ...ownScope(req) };
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [
        { name: regex },
        { mobile: regex },
        { email: regex },
        { city: regex },
      ];
    }
    if (["created", "paid", "partially_paid", "expired", "cancelled"].includes(status)) {
      filter.status = status;
    }

    const [total, payments] = await Promise.all([
      ManualPayment.countDocuments(filter),
      ManualPayment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: "createdBy",
          select: "name role staffRole",
          populate: { path: "staffRole", select: "name" },
        })
        .lean(),
    ]);

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      payments: payments.map(withCreator),
    });
  } catch (error) {
    console.error("List manual payments error:", error);
    res.status(500).json({ message: "Failed to fetch manual payments", error: error.message });
  }
};

// Shared status mapping: gateway link status (lowercased) -> our status.
// Razorpay and Cashfree both lowercase to: paid, partially_paid, expired, cancelled
// (Cashfree "ACTIVE" / Razorpay "created" mean no change).
// Never downgrades a paid link.
const applyLinkStatus = async (doc, linkStatus, paymentId) => {
  if (doc.status === "paid") return doc;

  const mapped = {
    paid: "paid",
    partially_paid: "partially_paid",
    expired: "expired",
    cancelled: "cancelled",
  }[linkStatus];

  if (!mapped || doc.status === mapped) return doc;

  if (mapped === "paid") {
    // Atomic transition: only the caller that flips the status sends the confirmation,
    // so a webhook and a manual refresh cannot both email.
    const updated = await ManualPayment.findOneAndUpdate(
      { _id: doc._id, status: { $ne: "paid" } },
      {
        status: "paid",
        paidAt: doc.paidAt || new Date(),
        ...(paymentId && {
          [isCashfree(doc) ? "cashfreePaymentId" : "razorpayPaymentId"]: paymentId,
        }),
      },
      { new: true },
    );
    if (!updated) return ManualPayment.findById(doc._id);

    await sendPaymentConfirmations(updated);
    return updated;
  }

  doc.status = mapped;
  if (mapped === "partially_paid") {
    doc.paidAt = doc.paidAt || new Date();
    if (paymentId) doc[isCashfree(doc) ? "cashfreePaymentId" : "razorpayPaymentId"] = paymentId;
  }
  await doc.save();
  return doc;
};

// Confirmation goes to the admin inbox and to the staff member who created the link
const sendPaymentConfirmations = async (doc) => {
  const recipients = new Map();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) recipients.set(adminEmail.toLowerCase(), "Admin");

  if (doc.createdBy) {
    const creator = await User.findById(doc.createdBy).select("name email").lean();
    if (creator?.email) {
      recipients.set(creator.email.toLowerCase(), creator.name || "Team member");
    }
  }

  const results = await Promise.allSettled(
    [...recipients.entries()].map(([to, recipientName]) =>
      sendManualPaymentConfirmationEmail({ to, recipientName, payment: doc }),
    ),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(
        `Manual payment confirmation to ${[...recipients.keys()][i]} failed:`,
        result.reason?.message,
      );
    }
  });
};

// Current link status + payment ID from whichever gateway created the link
const fetchLinkState = async (doc) => {
  if (isCashfree(doc)) {
    const link = await cashfree.getLink(doc.cashfreeLinkId);
    const status = String(link.link_status || "").toLowerCase();
    let paymentId;
    if (status === "paid" || status === "partially_paid") {
      try {
        const orders = await cashfree.getLinkOrders(doc.cashfreeLinkId);
        const paidOrder = (orders || []).find((o) => o.order_status === "PAID");
        if (paidOrder) {
          const payments = await cashfree.getOrderPayments(paidOrder.order_id);
          const success = (payments || []).find((pm) => pm.payment_status === "SUCCESS");
          if (success?.cf_payment_id) paymentId = String(success.cf_payment_id);
        }
      } catch (error) {
        console.error(`Cashfree link payment lookup failed for ${doc.cashfreeLinkId}:`, error.message);
      }
    }
    return { status, paymentId };
  }

  const link = await razorpay().paymentLink.fetch(doc.razorpayLinkId);
  return { status: link.status, paymentId: link.payments?.[0]?.payment_id };
};

// POST /api/admin/manual-payments/:id/refresh
// Pulls the current status from the gateway. Used when a webhook was missed.
const refreshManualPayment = async (req, res) => {
  try {
    const doc = await ManualPayment.findOne({ _id: req.params.id, ...ownScope(req) });
    if (!doc) return res.status(404).json({ message: "Payment not found" });

    const { status, paymentId } = await fetchLinkState(doc);
    const updated = await applyLinkStatus(doc, status, paymentId);

    res.json({ payment: updated || doc });
  } catch (error) {
    console.error("Refresh manual payment error:", error);
    res.status(500).json({ message: "Failed to refresh status", error: error.message });
  }
};

// POST /api/admin/manual-payments/:id/cancel
const cancelManualPayment = async (req, res) => {
  try {
    const doc = await ManualPayment.findOne({ _id: req.params.id, ...ownScope(req) });
    if (!doc) return res.status(404).json({ message: "Payment not found" });
    if (doc.status !== "created") {
      return res.status(400).json({ message: `Cannot cancel a ${doc.status} payment link` });
    }

    if (isCashfree(doc)) {
      await cashfree.cancelLink(doc.cashfreeLinkId);
    } else {
      await razorpay().paymentLink.cancel(doc.razorpayLinkId);
    }
    doc.status = "cancelled";
    await doc.save();

    res.json({ payment: doc });
  } catch (error) {
    console.error("Cancel manual payment error:", error);
    res.status(500).json({ message: "Failed to cancel payment link", error: error.message });
  }
};

// Background sync: checks open links with the gateway so status updates even if a webhook is missed.
// Same logic as the manual Refresh button, applied to every open link.
let syncRunning = false;
const syncOpenManualPayments = async () => {
  if (syncRunning) return; // skip overlapping runs
  syncRunning = true;
  try {
    const open = await ManualPayment.find({ status: "created" })
      .sort({ createdAt: 1 })
      .limit(50);

    for (const doc of open) {
      try {
        const { status, paymentId } = await fetchLinkState(doc);
        await applyLinkStatus(doc, status, paymentId);
      } catch (error) {
        console.error(`Manual payment sync failed for ${linkIdOf(doc)}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Manual payment sync error:", error.message);
  } finally {
    syncRunning = false;
  }
};

module.exports = {
  createManualPayment,
  listManualPayments,
  refreshManualPayment,
  cancelManualPayment,
  applyLinkStatus,
  syncOpenManualPayments,
};
