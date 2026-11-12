const crypto = require("crypto");
const Razorpay = require("razorpay");
const Joi = require("joi");
const Franchise = require("../models/Franchise");
const CustomBrandedRequest = require("../models/CustomBrandedRequest");

// White Label Reports: one-time ₹10,000 + GST via Razorpay, open to all franchise partners
const WHITE_LABEL_BASE_INR = 10000;
const WHITE_LABEL_GST_PERCENT = 18;
// Total charged including GST: 10,000 + 18% = 11,800
const WHITE_LABEL_PRICE_INR = Math.round(
  WHITE_LABEL_BASE_INR * (1 + WHITE_LABEL_GST_PERCENT / 100),
);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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
// Body: { name, email, mobile } — creates a Razorpay order and an Unpaid request
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

    const order = await razorpay.orders.create({
      amount: WHITE_LABEL_PRICE_INR * 100,
      currency: "INR",
      receipt: `wl_${Date.now()}`,
      payment_capture: 1,
    });

    const email = contact.email.toLowerCase();
    const mobile = contact.mobile;

    // Reuse the partner's unpaid row if they retry, so Unpaid rows don't pile up
    let request = await CustomBrandedRequest.findOne({
      partnerId: req.user.id,
      paymentStatus: "Unpaid",
    });
    if (request) {
      request.email = email;
      request.phone = mobile;
      request.orderId = order.id;
      request.amount = WHITE_LABEL_PRICE_INR;
      request.status = "Pending";
      await request.save();
    } else {
      request = await CustomBrandedRequest.create({
        partnerId: req.user.id,
        email,
        phone: mobile,
        orderId: order.id,
        amount: WHITE_LABEL_PRICE_INR,
        paymentMethod: "RAZORPAY",
        paymentStatus: "Unpaid",
        status: "Pending",
      });
    }

    res.status(200).json({
      orderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      requestId: request.requestId,
      prefill: { name: contact.name, email, contact: mobile },
    });
  } catch (error) {
    console.error("White label order error:", error);
    res.status(500).json({
      message: "Could not start online payment. Please try again.",
    });
  }
};

// POST /api/dashboard/white-label/verify
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Idempotent: a retry after success returns the paid request.
const verifyWhiteLabelPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Payment details are required." });
    }

    const request = await CustomBrandedRequest.findOne({
      orderId: razorpay_order_id,
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

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) {
      return res
        .status(400)
        .json({ message: "Payment signature verification failed." });
    }

    request.paymentId = razorpay_payment_id;
    request.paymentStatus = "Paid";
    request.paymentMethod = "RAZORPAY";
    request.amount = WHITE_LABEL_PRICE_INR;
    request.status = "Active";
    await request.save();

    await Franchise.updateOne(
      { userId: req.user.id },
      {
        $set: {
          brandingStatus: "paid",
          brandingPaidAt: new Date(),
          brandingAmount: WHITE_LABEL_PRICE_INR,
        },
      },
    );

    res.status(200).json({ message: "Payment verified successfully.", data: request });
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
};
