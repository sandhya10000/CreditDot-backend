const Franchise = require("../models/Franchise");
const FranchiseCounter = require("../models/FranchiseCounter");
const Role = require("../models/Role");
const User = require("../models/User");

// Serial (round-robin) Business Manager assignment.
// The cursor stores the RM number (RM-3 -> 3) of the manager given the last partner.
// The next partner goes to the first active manager with a higher number, wrapping around.
const CURSOR_ID = "bmRoundRobin";
const MAX_ATTEMPTS = 10;

// Pure: managers sorted by num ascending, cursor = last num used (0 = none yet)
const nextInRotation = (managers, cursor) => {
  if (!managers.length) return null;
  return managers.find((m) => m.num > cursor) || managers[0];
};

// Active Business Managers, in RM-number order
const getEligibleManagers = async () => {
  const roles = await Role.find({ limitToOwnFranchises: true, isActive: true })
    .select("_id")
    .lean();
  if (!roles.length) return [];

  const users = await User.find({
    staffRole: { $in: roles.map((r) => r._id) },
    staffCode: { $ne: null },
    isActive: true,
    isDeleted: { $ne: true },
  })
    .select("name staffCode")
    .lean();

  return users
    .map((u) => ({ ...u, num: parseInt(String(u.staffCode).replace(/\D/g, ""), 10) }))
    .filter((m) => Number.isFinite(m.num))
    .sort((a, b) => a.num - b.num);
};

const readCursor = async () => {
  const doc = await FranchiseCounter.findById(CURSOR_ID).lean();
  return doc?.seq ?? 0;
};

// Compare-and-set: moves the cursor only if nobody else moved it since we read it
const advanceCursor = async (from, to) => {
  const res = await FranchiseCounter.updateOne({ _id: CURSOR_ID, seq: from }, { $set: { seq: to } });
  if (res.matchedCount === 1) return true;

  // First ever use: the cursor document does not exist yet
  if (from === 0) {
    try {
      await FranchiseCounter.create({ _id: CURSOR_ID, seq: to });
      return true;
    } catch (err) {
      if (err.code === 11000) return false; // created by a concurrent request
      throw err;
    }
  }
  return false;
};

// Returns the _id of the Business Manager for the next new partner, or null if none is active
const assignNextManager = async () => {
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const managers = await getEligibleManagers();
      if (!managers.length) return null;

      const cursor = await readCursor();
      const next = nextInRotation(managers, cursor);
      if (await advanceCursor(cursor, next.num)) return next._id;
    }
    console.error("Business Manager rotation: cursor kept changing, partner left unassigned");
    return null;
  } catch (err) {
    console.error("Business Manager assignment failed:", err.message);
    return null;
  }
};

// Bulk: gives every non-deleted partner without a manager a turn in the rotation (oldest first)
const assignUnassignedFranchises = async () => {
  const unassigned = await Franchise.find({
    businessManager: null,
    isDeleted: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();

  const managers = await getEligibleManagers();
  if (!managers.length) {
    return { error: "No active Business Managers", assigned: 0, managers: [] };
  }
  if (!unassigned.length) return { assigned: 0, managers: [] };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const managersNow = await getEligibleManagers();
    if (!managersNow.length) return { error: "No active Business Managers", assigned: 0, managers: [] };

    const cursor = await readCursor();

    // Plan the whole run in memory first
    const ops = [];
    const counts = new Map();
    let last = cursor;
    for (const franchise of unassigned) {
      const manager = nextInRotation(managersNow, last);
      ops.push({
        updateOne: {
          // businessManager: null keeps any manual assignment made in the meantime
          filter: { _id: franchise._id, businessManager: null },
          update: { $set: { businessManager: manager._id } },
        },
      });
      counts.set(String(manager._id), (counts.get(String(manager._id)) || 0) + 1);
      last = manager.num;
    }

    // Reserve the turns first; retry if someone else moved the cursor
    if (!(await advanceCursor(cursor, last))) continue;

    const result = await Franchise.bulkWrite(ops);
    return {
      assigned: result.modifiedCount,
      managers: managersNow
        .filter((m) => counts.has(String(m._id)))
        .map((m) => ({
          id: m._id,
          name: m.name,
          staffCode: m.staffCode,
          count: counts.get(String(m._id)),
        })),
    };
  }

  return { error: "Assignment was busy, please try again", assigned: 0, managers: [] };
};

module.exports = {
  nextInRotation,
  assignNextManager,
  assignUnassignedFranchises,
  getEligibleManagers,
};
