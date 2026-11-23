// Thin Cashfree Payment Gateway client (REST, no SDK).
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest
const axios = require("axios");
const crypto = require("crypto");

const API_VERSION = "2023-08-01";

const isProduction = () =>
  String(process.env.CASHFREE_ENV || "").trim().toLowerCase() === "production";

const baseURL = () =>
  isProduction()
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const client = () =>
  axios.create({
    baseURL: baseURL(),
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY,
    },
  });

// Re-throws Cashfree errors with their readable message
const call = async (fn) => {
  try {
    const { data } = await fn(client());
    return data;
  } catch (error) {
    const cfMessage = error.response?.data?.message;
    const wrapped = new Error(cfMessage || error.message);
    wrapped.status = error.response?.status;
    wrapped.cashfree = error.response?.data;
    throw wrapped;
  }
};

const trimSlash = (url) => (url || "").replace(/\/$/, "");

// Cashfree only accepts https callback URLs, so skip them on plain-http local setups
const httpsOnly = (url) => (url && url.startsWith("https://") ? url : undefined);

const webhookUrl = () =>
  httpsOnly(`${trimSlash(process.env.BACKEND_URL)}/api/payments/cashfree/webhook`);

// Frontend page Cashfree sends the buyer back to (used by redirect-based payment methods)
const returnUrlFor = (path) =>
  httpsOnly(`${trimSlash(process.env.FRONTEND_URL)}${path}?cf_order_id={order_id}`);

// Order IDs: letters, digits, "_" and "-", max 50 chars. The prefix routes webhooks.
const generateOrderId = (prefix) =>
  `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

// Keep the last 10 digits so "+91 98765 43210" becomes a valid mobile; null if invalid
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

// Cashfree takes rupees with up to 2 decimals
const toRupees = (amount) => Math.round(Number(amount) * 100) / 100;

// ---- Orders ----

const createOrder = ({ orderId, amount, customer, returnPath, note }) =>
  call((c) =>
    c.post("/orders", {
      order_id: orderId,
      order_amount: toRupees(amount),
      order_currency: "INR",
      customer_details: {
        customer_id: String(customer.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50),
        customer_name: customer.name || undefined,
        customer_email: customer.email || undefined,
        customer_phone: customer.phone,
      },
      order_meta: {
        return_url: returnPath ? returnUrlFor(returnPath) : undefined,
        notify_url: webhookUrl(),
      },
      order_note: note ? String(note).slice(0, 200) : undefined,
    }),
  );

const getOrder = (orderId) =>
  call((c) => c.get(`/orders/${encodeURIComponent(orderId)}`));

const getOrderPayments = (orderId) =>
  call((c) => c.get(`/orders/${encodeURIComponent(orderId)}/payments`));

// Source of truth for "was this order paid?" (Cashfree has no client-side signature)
const confirmOrderPaid = async (orderId, expectedAmount) => {
  const order = await getOrder(orderId);
  let paid = order.order_status === "PAID";

  if (paid && expectedAmount != null) {
    const diff = Math.abs(Number(order.order_amount) - toRupees(expectedAmount));
    if (diff > 0.01) {
      console.error(
        `Cashfree amount mismatch for ${orderId}: got ${order.order_amount}, expected ${expectedAmount}`,
      );
      paid = false;
    }
  }

  let cfPaymentId = null;
  if (paid) {
    try {
      const payments = await getOrderPayments(orderId);
      const success = (payments || []).find((p) => p.payment_status === "SUCCESS");
      cfPaymentId = success?.cf_payment_id ? String(success.cf_payment_id) : null;
    } catch (error) {
      console.error(`Cashfree payments fetch failed for ${orderId}:`, error.message);
    }
  }

  return { paid, status: order.order_status, cfPaymentId, order };
};

// ---- Payment links ----

const createLink = ({ linkId, amount, purpose, customer, expiresAt }) =>
  call((c) =>
    c.post("/links", {
      link_id: linkId,
      link_amount: toRupees(amount),
      link_currency: "INR",
      link_purpose: String(purpose || "Credit Dost payment").slice(0, 500),
      customer_details: {
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
      },
      link_partial_payments: false,
      link_expiry_time: expiresAt.toISOString(),
      link_notify: { send_sms: false, send_email: false },
      link_auto_reminders: false,
      link_meta: { notify_url: webhookUrl() },
    }),
  );

const getLink = (linkId) =>
  call((c) => c.get(`/links/${encodeURIComponent(linkId)}`));

const getLinkOrders = (linkId) =>
  call((c) => c.get(`/links/${encodeURIComponent(linkId)}/orders`));

const cancelLink = (linkId) =>
  call((c) => c.post(`/links/${encodeURIComponent(linkId)}/cancel`));

// ---- Webhooks ----

// signature = base64(HMAC_SHA256(timestamp + rawBody, secret key))
const verifyWebhookSignature = (rawBody, timestamp, signature) => {
  if (!rawBody || !timestamp || !signature || !process.env.CASHFREE_SECRET_KEY) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
    .update(String(timestamp) + rawBody.toString("utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = {
  API_VERSION,
  generateOrderId,
  normalizePhone,
  createOrder,
  getOrder,
  getOrderPayments,
  confirmOrderPaid,
  createLink,
  getLink,
  getLinkOrders,
  cancelLink,
  verifyWebhookSignature,
};
