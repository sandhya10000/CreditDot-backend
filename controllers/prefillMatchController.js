const MobilePanLock = require("../models/MobilePanLock");
const prefillFailedLog = require("../models/prefillFailedLog");
const { fetchPrefillByMobile } = require("../utils/finpassPrefillClient");
const { extractPrefillProfile, matchPrefill } = require("../utils/prefillMatch");

const LOCK_HOURS = 48;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const lockedMessage = (until) =>
  `Mobile number and PAN are locked until ${new Date(until).toLocaleString("en-IN")} because the details did not match our records.`;

// Active lock for this mobile + PAN pair, or null
const findActivePrefillLock = (mobile, pan) =>
  MobilePanLock.findOne({
    mobile: String(mobile).trim(),
    pan: String(pan).toUpperCase().trim(),
    blockedUntil: { $gt: new Date() },
  });

// Runs in the background of the CIBIL form when mobile, name and PAN are filled in.
// The UI never shows a processing state for this call.
// @route POST /api/credit/prefill-check  { mobile, name, pan }
const prefillCheck = async (req, res) => {
  const mobile = String(req.body.mobile || "").replace(/\D/g, "");
  const name = String(req.body.name || "").trim();
  const pan = String(req.body.pan || "").toUpperCase().trim();

  if (!/^[0-9]{10}$/.test(mobile)) {
    return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
  }
  if (name.length < 2) {
    return res.status(400).json({ message: "Enter the customer name" });
  }
  if (!PAN_REGEX.test(pan)) {
    return res.status(400).json({ message: "Enter a valid PAN number" });
  }

  const isAdmin = req.user?.role === "admin";

  // Already locked for this pair: no provider call
  if (!isAdmin) {
    const lock = await findActivePrefillLock(mobile, pan);
    if (lock) {
      return res.json({
        checked: true,
        matched: false,
        locked: true,
        lockedUntil: lock.blockedUntil,
        message: lockedMessage(lock.blockedUntil),
      });
    }
  }

  let body = null;
  try {
    body = await fetchPrefillByMobile(mobile);
  } catch (err) {
    const status = err.response?.status;
    // "No record" answers are a mismatch; anything else is a provider or platform problem
    if (status !== 404 && status !== 422) {
      console.error("Prefill provider error:", err.message);
      // Not a customer mismatch: no lock, no log, and the form stays usable
      return res.json({ checked: false, matched: false, locked: false, message: "Prefill unavailable" });
    }
  }

  const result = matchPrefill({ name, mobile, pan }, extractPrefillProfile(body));

  if (result.matched) {
    return res.json({ checked: true, matched: true, locked: false });
  }

  // Admins can run the check but are never locked
  if (isAdmin) {
    return res.json({ checked: true, matched: false, locked: false, message: result.reason });
  }

  const blockedUntil = new Date(Date.now() + LOCK_HOURS * 60 * 60 * 1000);
  try {
    await MobilePanLock.updateOne(
      { mobile, pan },
      { $set: { reason: result.reason, blockedUntil } },
      { upsert: true },
    );
    await prefillFailedLog.create({
      source: "prefill",
      mobile,
      name,
      pan,
      message: result.reason,
      statusCode: body?.status_code ?? null,
      userId: req.user?.id || null,
      franchiseId: req.user?.franchiseId || null,
    });
  } catch (err) {
    console.error("Prefill lock/log save failed:", err.message);
  }

  return res.json({
    checked: true,
    matched: false,
    locked: true,
    lockedUntil: blockedUntil,
    message: lockedMessage(blockedUntil),
  });
};

// Lock status for a mobile + PAN pair, read from the database only. The provider is never
// called, so the form can show a locked pair as soon as it is entered.
// @route GET /api/credit/prefill-lock?mobile=&pan=
const prefillLockStatus = async (req, res) => {
  const mobile = String(req.query.mobile || "").replace(/\D/g, "");
  const pan = String(req.query.pan || "").toUpperCase().trim();

  if (!/^[0-9]{10}$/.test(mobile) || !PAN_REGEX.test(pan)) {
    return res.status(400).json({ message: "Enter a valid mobile number and PAN" });
  }

  // Admins are never locked (see prefillCheck)
  if (req.user?.role === "admin") {
    return res.json({ locked: false });
  }

  const lock = await findActivePrefillLock(mobile, pan);
  if (!lock) {
    return res.json({ locked: false });
  }
  return res.json({
    locked: true,
    lockedUntil: lock.blockedUntil,
    message: lockedMessage(lock.blockedUntil),
  });
};

module.exports = { prefillCheck, prefillLockStatus, findActivePrefillLock, lockedMessage };
