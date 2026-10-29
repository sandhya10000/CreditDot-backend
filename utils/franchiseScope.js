const mongoose = require("mongoose");
const Franchise = require("../models/Franchise");
const User = require("../models/User");
const Role = require("../models/Role");

// Business Managers (staff on a limitToOwnFranchises role) see only their own franchises.
// Admins (no staffRole) and other staff keep full visibility.
const isScoped = (req) => Boolean(req.user?.scopedToOwnFranchises);

// Franchise documents the caller owns (soft-deleted ones included, so history stays visible)
const ownedFranchiseIds = async (req) =>
  Franchise.find({ businessManager: req.user._id }).distinct("_id");

// Filter for models that reference a franchise (franchiseId, franchise, ...).
// Returns {} for unscoped callers, so it is safe to spread into any query.
const scopeFilter = async (req, field = "franchiseId") => {
  if (!isScoped(req)) return {};
  return { [field]: { $in: await ownedFranchiseIds(req) } };
};

// Filter for the Franchise collection itself
const franchiseScope = (req) => {
  if (!isScoped(req)) return {};
  return { businessManager: req.user._id };
};

// True when the caller may act on this franchise id (unscoped callers always may)
const ownsFranchise = async (req, franchiseId) => {
  if (!isScoped(req)) return true;
  if (!franchiseId || !mongoose.Types.ObjectId.isValid(franchiseId)) return false;
  return Boolean(
    await Franchise.exists({ _id: franchiseId, businessManager: req.user._id }),
  );
};

// Who should own a newly created franchise.
// A scoped manager always owns what they create. Admins may name an active
// Business Manager; anything else becomes unassigned (null).
const resolveBusinessManagerId = async (req, requestedId) => {
  if (isScoped(req)) return req.user._id;
  if (!requestedId || !mongoose.Types.ObjectId.isValid(requestedId)) return null;

  const manager = await User.findOne({
    _id: requestedId,
    staffRole: { $ne: null },
    isActive: true,
    isDeleted: { $ne: true },
  }).select("staffRole");
  if (!manager) return null;

  const role = await Role.findById(manager.staffRole).select("limitToOwnFranchises");
  return role?.limitToOwnFranchises ? manager._id : null;
};

module.exports = {
  isScoped,
  ownedFranchiseIds,
  scopeFilter,
  franchiseScope,
  ownsFranchise,
  resolveBusinessManagerId,
};
