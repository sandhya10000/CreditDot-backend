const Razorpay = require("razorpay");
const Joi = require("joi");
const ManualPayment = require("../models/ManualPayment");
const User = require("../models/User");
const { sendManualPaymentConfirmationEmail } = require("../utils/emailService");

const LINK_VALIDITY_SECONDS = 24 * 60 * 60;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  mobile: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({ "string.pattern.base": "Mobile must be a valid 10-digit number" }),
  email: Joi.string().trim().email().required(),
  city: Joi.string().trim().max(100).allow("", null),
  amount: Joi.number().min(1).max(1000000).required(),
  remarks: Joi.string().trim().max(500).allow("", null),
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// POST /api/admin/manual-payments
const createManualPayment = async (req, res) => {
  try {
    const { value, error } = createSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const expireBy = Math.floor(Date.now() / 1000) + LINK_VALIDITY_SECONDS;

    const link = await razorpay.paymentLink.create({
      amount: Math.round(value.amount * 100),
      currency: "INR",
      description: value.remarks || "Credit Dost payment",
      customer: {
        name: value.name,
        contact: value.mobile,
        email: value.email,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      expire_by: expireBy,
    });

    const doc = await ManualPayment.create({
      name: value.name,
      mobile: value.mobile,
      email: value.email,
      city: value.city || "",
      amount: value.amount,
      remarks: value.remarks || "",
      razorpayLinkId: link.id,
      shortUrl: link.short_url,
      expireBy: new Date(expireBy * 1000),
      createdBy: req.user?.id,
    });

    res.status(201).json({
      message: "Payment link created",
      payment: doc,
    });
  } catch (error) {
    console.error("Create manual payment error:", error);
    res.status(500).json({ message: "Failed to create payment link", error: error.message });
  }
};

// GET /api/admin/manual-payments
const listManualPayments = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const search = req.query.search?.trim() || "";
    const status = req.query.status;

    const filter = {};
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
        .lean(),
    ]);

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      payments,
    });
  } catch (error) {
    console.error("List manual payments error:", error);
    res.status(500).json({ message: "Failed to fetch manual payments", error: error.message });
  }
};

// Shared status mapping: Razorpay link status -> our status.
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
        ...(paymentId && { razorpayPaymentId: paymentId }),
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
    if (paymentId) doc.razorpayPaymentId = paymentId;
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

// POST /api/admin/manual-payments/:id/refresh
// Pulls the current status from Razorpay. Used when a webhook was missed.
const refreshManualPayment = async (req, res) => {
  try {
    const doc = await ManualPayment.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Payment not found" });

    const link = await razorpay.paymentLink.fetch(doc.razorpayLinkId);
    const paymentId = link.payments?.[0]?.payment_id;
    await applyLinkStatus(doc, link.status, paymentId);

    res.json({ payment: doc });
  } catch (error) {
    console.error("Refresh manual payment error:", error);
    res.status(500).json({ message: "Failed to refresh status", error: error.message });
  }
};

// POST /api/admin/manual-payments/:id/cancel
const cancelManualPayment = async (req, res) => {
  try {
    const doc = await ManualPayment.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Payment not found" });
    if (doc.status !== "created") {
      return res.status(400).json({ message: `Cannot cancel a ${doc.status} payment link` });
    }

    await razorpay.paymentLink.cancel(doc.razorpayLinkId);
    doc.status = "cancelled";
    await doc.save();

    res.json({ payment: doc });
  } catch (error) {
    console.error("Cancel manual payment error:", error);
    res.status(500).json({ message: "Failed to cancel payment link", error: error.message });
  }
};

// Background sync: checks open links with Razorpay so status updates even if a webhook is missed.
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
        const link = await razorpay.paymentLink.fetch(doc.razorpayLinkId);
        const paymentId = link.payments?.[0]?.payment_id;
        await applyLinkStatus(doc, link.status, paymentId);
      } catch (error) {
        console.error(`Manual payment sync failed for ${doc.razorpayLinkId}:`, error.message);
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
