const cashfree = require("../utils/cashfree");
const Joi = require("joi");
const Franchise = require("../models/Franchise");
const CustomBrandedRequest = require("../models/CustomBrandedRequest");

// White Label Reports: one-time ₹10,000 + GST via Cashfree, open to all franchise partners
const WHITE_LABEL_BASE_INR = 10000;
const WHITE_LABEL_GST_PERCENT = 18;
// Total charged including GST: 10,000 + 18% = 11,800
const WHITE_LABEL_PRICE_INR = Math.round(
  WHITE_LABEL_BASE_INR * (1 + WHITE_LABEL_GST_PERCENT / 100),
);

// Keep the last 10 digits so "+91 98765 43210" becomes a valid mobile
const normalizeMobile = (value) =>
  String(value || "").replace(/\D/g, "").slice(-10);

// Contact details the partner enters before paying
const contactSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email().required(),
  mobile: Joi.string()
    .trim()
    .custom((value, helpers) => {
      const normalized = normalizeMobile(value);
      return /^[6-9]\d{9}$/.test(normalized)
        ? normalized
        : helpers.error("any.invalid");
    })
    .required()
    .messages({ "any.invalid": "Mobile must be a valid 10-digit number" }),
});

// Looks up the partner's franchise. White Label is open to all franchise partners.
const getEligibleFranchise = async (userId) => {
  const franchise = await Franchise.findOne({ userId });
  return { franchise, eligible: Boolean(franchise) };
};

// POST /api/dashboard/white-label/order
// Body: { name, email, mobile } — creates a Cashfree order and an Unpaid request
const createWhiteLabelOrder = async (req, res) => {
  try {
    const { value: contact, error: contactError } = contactSchema.validate(
      req.body,
      { stripUnknown: true },
    );
    if (contactError) {
      return res.status(400).json({ message: contactError.details[0].message });
    }

    const { franchise, eligible } = await getEligibleFranchise(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }
    // One paid white-label request per partner
    const alreadyPaid = await CustomBrandedRequest.findOne({
      partnerId: req.user.id,
      paymentStatus: "Paid",
    });
    if (alreadyPaid) {
      return res.status(409).json({
        message: "You already have an active White Label Reports request.",
        requestId: alreadyPaid.requestId,
      });
    }

    const email = contact.email.toLowerCase();
    const mobile = contact.mobile;

    const orderId = cashfree.generateOrderId("WL");
    const order = await cashfree.createOrder({
      orderId,
      amount: WHITE_LABEL_PRICE_INR,
      customer: { id: req.user.id, name: contact.name, email, phone: mobile },
      returnPath: "/franchise/white-label-reports",
      note: "White Label Reports",
    });

    // Reuse the partner's unpaid row if they retry, so Unpaid rows don't pile up
    let request = await CustomBrandedRequest.findOne({
      partnerId: req.user.id,
      paymentStatus: "Unpaid",
    });
    if (request) {
      request.email = email;
      request.phone = mobile;
      request.orderId = orderId;
      request.paymentMethod = "CASHFREE";
      request.amount = WHITE_LABEL_PRICE_INR;
      request.status = "Pending";
      await request.save();
    } else {
      request = await CustomBrandedRequest.create({
        partnerId: req.user.id,
        email,
        phone: mobile,
        orderId,
        amount: WHITE_LABEL_PRICE_INR,
        paymentMethod: "CASHFREE",
        paymentStatus: "Unpaid",
        status: "Pending",
      });
    }

    res.status(200).json({
      orderId,
      paymentSessionId: order.payment_session_id,
      amount: WHITE_LABEL_PRICE_INR,
      currency: "INR",
      requestId: request.requestId,
    });
  } catch (error) {
    console.error("White label order error:", error);
    res.status(500).json({
      message: "Could not start online payment. Please try again.",
    });
  }
};

// Marks a white-label request paid and activates branding for the partner.
// Idempotent: only the caller that flips paymentStatus to "Paid" updates the franchise.
const markWhiteLabelPaid = async (requestId, { paymentId } = {}) => {
  const request = await CustomBrandedRequest.findOneAndUpdate(
    { _id: requestId, paymentStatus: { $ne: "Paid" } },
    {
      $set: {
        paymentId: paymentId || null,
        paymentStatus: "Paid",
        paymentMethod: "CASHFREE",
        amount: WHITE_LABEL_PRICE_INR,
        status: "Active",
      },
    },
    { new: true },
  );
  if (!request) {
    return { request: await CustomBrandedRequest.findById(requestId), alreadyPaid: true };
  }

  await Franchise.updateOne(
    { userId: request.partnerId },
    {
      $set: {
        brandingStatus: "paid",
        brandingPaidAt: new Date(),
        brandingAmount: WHITE_LABEL_PRICE_INR,
      },
    },
  );
  return { request, alreadyPaid: false };
};

// Checks a white-label order with Cashfree and activates it if paid. Used by webhook.
const settleWhiteLabelOrder = async (orderId) => {
  const request = await CustomBrandedRequest.findOne({ orderId });
  if (!request || request.paymentStatus === "Paid") return request;

  const { paid, cfPaymentId } = await cashfree.confirmOrderPaid(orderId, WHITE_LABEL_PRICE_INR);
  if (!paid) return request;

  const result = await markWhiteLabelPaid(request._id, { paymentId: cfPaymentId });
  return result.request;
};

// POST /api/dashboard/white-label/verify
// Body: { orderId } — status is read from Cashfree (no client-side signature)
// Idempotent: a retry after success returns the paid request.
const verifyWhiteLabelPayment = async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ message: "Payment details are required." });
    }

    const request = await CustomBrandedRequest.findOne({
      orderId,
      partnerId: req.user.id,
    });
    if (!request) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (request.paymentStatus === "Paid") {
      return res.status(200).json({
        message: "Payment already verified.",
        data: request,
      });
    }

    const { paid, status, cfPaymentId } = await cashfree.confirmOrderPaid(
      orderId,
      WHITE_LABEL_PRICE_INR,
    );
    if (!paid) {
      return res.status(400).json({ message: "Payment not completed.", status });
    }

    const result = await markWhiteLabelPaid(request._id, { paymentId: cfPaymentId });

    res.status(200).json({ message: "Payment verified successfully.", data: result.request });
  } catch (error) {
    console.error("White label verify error:", error);
    res.status(500).json({ message: "Payment verification failed." });
  }
};

// GET /api/dashboard/white-label/status
// Returns the partner's branding status and their current request (if any)
const getWhiteLabelStatus = async (req, res) => {
  try {
    const { franchise, eligible } = await getEligibleFranchise(req.user.id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    const request = await CustomBrandedRequest.findOne({
      partnerId: req.user.id,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      eligible,
      brandingStatus: franchise.brandingStatus || "not_purchased",
      brandingPaidAt: franchise.brandingPaidAt,
      request: request && request.paymentStatus === "Paid" ? request : null,
      basePrice: WHITE_LABEL_BASE_INR,
      gstPercent: WHITE_LABEL_GST_PERCENT,
      price: WHITE_LABEL_PRICE_INR,
    });
  } catch (error) {
    console.error("White label status error:", error);
    res.status(500).json({ message: "Could not load White Label status." });
  }
};

module.exports = {
  createWhiteLabelOrder,
  verifyWhiteLabelPayment,
  getWhiteLabelStatus,
  markWhiteLabelPaid,
  settleWhiteLabelOrder,
};
