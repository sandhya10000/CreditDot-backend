// AMC term status helpers.
// AMC dates are stored as UTC midnight of the calendar day the admin picked,
// and "today" is the current calendar day in India, also as UTC midnight —
// so all comparisons are whole-day comparisons with no timezone drift.

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 30;
const AMC_STATUSES = ["active", "expiring", "expired", "upcoming"];

// Current calendar day in IST, as a UTC-midnight Date
const todayIST = () => {
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  }); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00.000Z`);
};

// Parses "YYYY-MM-DD" (or an ISO string) into a UTC-midnight Date; null if invalid
const parseAmcDate = (value) => {
  if (!value) return null;
  const ymd = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const date = new Date(`${ymd}T00:00:00.000Z`);
  // Reject rollovers like 2025-02-30
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== ymd) {
    return null;
  }
  return date;
};

const getAmcStatus = (amc, today = todayIST()) => {
  if (!amc || !amc.isEnrolled || !amc.startDate || !amc.endDate) return null;
  const start = new Date(amc.startDate).getTime();
  const end = new Date(amc.endDate).getTime();
  const now = today.getTime();

  if (start > now) return "upcoming";
  if (end < now) return "expired";
  if (end - now <= EXPIRING_WINDOW_DAYS * DAY_MS) return "expiring";
  return "active";
};

// Days from today until the (inclusive) end date; negative once expired
const getAmcDaysLeft = (amc, today = todayIST()) => {
  if (!amc || !amc.endDate) return null;
  return Math.round((new Date(amc.endDate).getTime() - today.getTime()) / DAY_MS);
};

// Mongo filter (on top of isEnrolled) matching one status
const amcStatusFilter = (status, today = todayIST()) => {
  const expiringLimit = new Date(today.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
  switch (status) {
    case "upcoming":
      return { "amc.startDate": { $gt: today } };
    case "expired":
      return { "amc.endDate": { $lt: today } };
    case "expiring":
      return {
        "amc.startDate": { $lte: today },
        "amc.endDate": { $gte: today, $lte: expiringLimit },
      };
    case "active":
      return {
        "amc.startDate": { $lte: today },
        "amc.endDate": { $gt: expiringLimit },
      };
    default:
      return {};
  }
};

module.exports = {
  DAY_MS,
  AMC_STATUSES,
  todayIST,
  parseAmcDate,
  getAmcStatus,
  getAmcDaysLeft,
  amcStatusFilter,
};
