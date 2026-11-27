const mongoose = require("mongoose");
const WorkEntry = require("../models/WorkEntry");
const {
  validateEntry,
  summarizeEntries,
  isValidMonth,
} = require("../config/workTracking");

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (res, err) => {
  const status = err.name === "ValidationError" ? 400 : 500;
  return fail(res, status, err.message);
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

// Full administrators (no staffRole) can see everyone's entries.
// Staff only ever see and change their own.
const isFullAdmin = (user) => !user?.staffRole;

const toObjectIdOrNull = (value) =>
  value && mongoose.Types.ObjectId.isValid(value) ? value : null;

// Builds the Mongo filter for a month, applying staff scope and optional admin filters
const buildFilter = (req) => {
  const month = req.query.month || currentMonth();
  if (!isValidMonth(month)) return { error: "Month must be in YYYY-MM format" };

  const filter = { entryMonth: month };
  if (isFullAdmin(req.user)) {
    if (req.query.userId) {
      const userId = toObjectIdOrNull(req.query.userId);
      if (!userId) return { error: "Invalid user" };
      filter.user = userId;
    }
    if (req.query.roleId) {
      const roleId = toObjectIdOrNull(req.query.roleId);
      if (!roleId) return { error: "Invalid staff role" };
      filter.staffRole = roleId;
    }
  } else {
    filter.user = req.user._id;
  }
  return { filter, month };
};

// @route GET /api/work-tracking/entries?month=YYYY-MM&roleId=&userId=
const listEntries = async (req, res) => {
  try {
    const { filter, month, error } = buildFilter(req);
    if (error) return fail(res, 400, error);

    const entries = await WorkEntry.find(filter).sort({ entryDate: -1, createdAt: -1 });
    res.json({ success: true, month, data: entries });
  } catch (err) {
    handleError(res, err);
  }
};

// @route GET /api/work-tracking/summary?month=YYYY-MM&roleId=&userId=
// Totals for incentive calculation. Full admins also get a per-person breakdown.
const getSummary = async (req, res) => {
  try {
    const { filter, month, error } = buildFilter(req);
    if (error) return fail(res, 400, error);

    const entries = await WorkEntry.find(filter).sort({ entryDate: 1 });
    const summary = summarizeEntries(entries);

    if (isFullAdmin(req.user)) {
      const groups = new Map();
      for (const entry of entries) {
        const key = String(entry.user);
        if (!groups.has(key)) {
          groups.set(key, {
            userId: entry.user,
            userName: entry.userName,
            roleName: entry.roleName,
            entries: [],
          });
        }
        groups.get(key).entries.push(entry);
      }
      summary.byUser = [...groups.values()].map((group) => ({
        userId: group.userId,
        userName: group.userName,
        roleName: group.roleName,
        ...summarizeEntries(group.entries),
      }));
    }

    res.json({ success: true, month, data: summary });
  } catch (err) {
    handleError(res, err);
  }
};

// @route POST /api/work-tracking/entries
const createEntry = async (req, res) => {
  try {
    // Admins review incentives; only staff log their own entries
    if (isFullAdmin(req.user)) {
      return fail(res, 403, "Only staff members can add incentive entries");
    }
    const { errors, value } = validateEntry(req.body);
    if (errors.length) return fail(res, 400, errors.join(". "));

    const entry = await WorkEntry.create({
      ...value,
      user: req.user._id,
      staffRole: req.user.staffRole || null,
      userName: req.user.name || "",
      roleName: req.user.staffRoleName || "Admin",
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    handleError(res, err);
  }
};

// Only the person who logged an entry may change or delete it
const findOwnEntry = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return { status: 400, message: "Invalid entry id" };
  const entry = await WorkEntry.findById(req.params.id);
  if (!entry) return { status: 404, message: "Entry not found" };
  if (String(entry.user) !== String(req.user._id)) {
    return { status: 403, message: "You can only change your own entries" };
  }
  return { entry };
};

// @route PUT /api/work-tracking/entries/:id
const updateEntry = async (req, res) => {
  try {
    const { entry, status, message } = await findOwnEntry(req);
    if (!entry) return fail(res, status, message);

    const { errors, value } = validateEntry(req.body);
    if (errors.length) return fail(res, 400, errors.join(". "));

    Object.assign(entry, value);
    await entry.save();
    res.json({ success: true, data: entry });
  } catch (err) {
    handleError(res, err);
  }
};

// @route DELETE /api/work-tracking/entries/:id
const deleteEntry = async (req, res) => {
  try {
    const { entry, status, message } = await findOwnEntry(req);
    if (!entry) return fail(res, status, message);

    await entry.deleteOne();
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    handleError(res, err);
  }
};

module.exports = {
  listEntries,
  getSummary,
  createEntry,
  updateEntry,
  deleteEntry,
};
