const mongoose = require("mongoose");
const BusinessForm = require("../models/BusinessForm");
const Franchise = require("../models/Franchise");
const {
  DAY_MS,
  AMC_STATUSES,
  todayIST,
  parseAmcDate,
  getAmcStatus,
  getAmcDaysLeft,
  amcStatusFilter,
} = require("../utils/amcStatus");

const MAX_TERM_DAYS = 5 * 366;

// Same search behaviour as Business MIS (getAllBusinessForms)
const buildSearchFilter = async (search, { includeFranchiseName = true } = {}) => {
  if (!search) return {};
  const regex = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const or = [
    { customerName: regex },
    { customerEmail: regex },
    { customerPhone: regex },
    { customerId: regex },
  ];
  if (includeFranchiseName) {
    const franchises = await Franchise.find({ businessName: regex }).select("_id");
    if (franchises.length > 0) {
      or.push({ franchiseId: { $in: franchises.map((f) => f._id) } });
    }
  }
  return { $or: or };
};

const listAmcCustomers = async (req, res, scopeFilter, options = {}) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 1000000);
  const search = req.query.search?.trim() || "";
  const amcStatus = req.query.amcStatus;
  const paymentStatus = req.query.paymentStatus;
  const today = todayIST();

  const baseFilter = {
    ...scopeFilter,
    "amc.isEnrolled": true,
    ...(await buildSearchFilter(search, options)),
  };

  const filter = { ...baseFilter };
  if (AMC_STATUSES.includes(amcStatus)) {
    Object.assign(filter, amcStatusFilter(amcStatus, today));
  }
  if (["pending", "paid"].includes(paymentStatus)) {
    filter["amc.paymentStatus"] = paymentStatus;
  }

  const [total, records, ...statusCounts] = await Promise.all([
    BusinessForm.countDocuments(filter),
    BusinessForm.find(filter)
      .select("-amc.updatedBy")
      .populate("selectedPackage", "name price")
      .populate("franchiseId", "businessName")
      .sort({ "amc.endDate": 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ...AMC_STATUSES.map((status) =>
      BusinessForm.countDocuments({ ...baseFilter, ...amcStatusFilter(status, today) }),
    ),
  ]);

  const counts = {};
  AMC_STATUSES.forEach((status, i) => {
    counts[status] = statusCounts[i];
  });

  res.json({
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    counts,
    amcData: records.map((record) => ({
      ...record,
      amcStatus: getAmcStatus(record.amc, today),
      amcDaysLeft: getAmcDaysLeft(record.amc, today),
    })),
  });
};

// GET /api/business/amc (admin)
const getAmcCustomers = async (req, res) => {
  try {
    await listAmcCustomers(req, res, {});
  } catch (error) {
    console.error("Get AMC customers error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// GET /api/business/franchise/amc (franchise, own customers only, read-only)
const getFranchiseAmcCustomers = async (req, res) => {
  try {
    if (!req.user.franchiseId) {
      return res.status(403).json({ message: "Franchise not found for this user" });
    }
    await listAmcCustomers(
      req,
      res,
      { franchiseId: req.user.franchiseId },
      { includeFranchiseName: false },
    );
  } catch (error) {
    console.error("Get franchise AMC customers error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Validates an AMC term from the request body. Returns { error } or { term }.
const validateAmcTerm = (body) => {
  const startDate = parseAmcDate(body.startDate);
  const endDate = parseAmcDate(body.endDate);
  if (!startDate || !endDate) {
    return { error: "Valid AMC From and To dates are required" };
  }
  if (endDate <= startDate) {
    return { error: "AMC To date must be after the From date" };
  }
  if ((endDate - startDate) / DAY_MS > MAX_TERM_DAYS) {
    return { error: "AMC period cannot be longer than 5 years" };
  }

  const amount = Number(body.amount);
  if (body.amount === "" || body.amount === null || body.amount === undefined || !Number.isFinite(amount) || amount < 0) {
    return { error: "AMC amount must be a number of 0 or more" };
  }

  const paymentStatus = body.paymentStatus || "pending";
  if (!["pending", "paid"].includes(paymentStatus)) {
    return { error: "Invalid AMC payment status" };
  }

  return {
    term: {
      startDate,
      endDate,
      amount: Math.round(amount * 100) / 100,
      paymentStatus,
      remarks: typeof body.remarks === "string" ? body.remarks.trim().slice(0, 500) : "",
    },
  };
};

// Loads a business form that is allowed to hold an AMC
const loadEligibleCustomer = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { status: 404, message: "Customer not found" };
  }
  const form = await BusinessForm.findById(id).select("paymentStatus customerId amc").lean();
  if (!form) return { status: 404, message: "Customer not found" };
  if (form.paymentStatus !== "paid" || !form.customerId) {
    return {
      status: 400,
      message: "Only paid Business MIS customers can be enrolled in AMC",
    };
  }
  return { form };
};

const resolvePaidAt = (newStatus, current) => {
  if (newStatus !== "paid") return null;
  return current?.paymentStatus === "paid" && current?.paidAt ? current.paidAt : new Date();
};

const historyEntry = (amc, endedReason, userId, cancelReason) => ({
  startDate: amc.startDate,
  endDate: amc.endDate,
  amount: amc.amount,
  paymentStatus: amc.paymentStatus,
  paidAt: amc.paidAt,
  remarks: amc.remarks,
  endedReason,
  cancelReason,
  closedBy: userId,
  closedAt: new Date(),
});

// $set / $push updates validate only the touched paths, so older customer
// records missing unrelated required fields can still be enrolled.
const updateAndReturn = (id, update) =>
  BusinessForm.findByIdAndUpdate(id, update, { new: true, runValidators: true })
    .populate("franchiseId", "businessName")
    .lean();

const withStatus = (record) => ({
  ...record,
  amcStatus: getAmcStatus(record.amc),
  amcDaysLeft: getAmcDaysLeft(record.amc),
});

// PUT /api/admin/business-forms/:id/amc — enroll, or edit the current term
const upsertAmc = async (req, res) => {
  try {
    const loaded = await loadEligibleCustomer(req.params.id);
    if (loaded.status) return res.status(loaded.status).json({ message: loaded.message });
    const current = loaded.form.amc;

    // Partial update for quick actions (e.g. "Mark Paid") on an enrolled AMC
    const body = current?.isEnrolled
      ? {
          startDate: current.startDate?.toISOString(),
          endDate: current.endDate?.toISOString(),
          amount: current.amount,
          paymentStatus: current.paymentStatus,
          remarks: current.remarks,
          ...req.body,
        }
      : req.body;

    const { error, term } = validateAmcTerm(body);
    if (error) return res.status(400).json({ message: error });

    const isNewEnrollment = !current?.isEnrolled;
    const updated = await updateAndReturn(req.params.id, {
      $set: {
        "amc.isEnrolled": true,
        "amc.startDate": term.startDate,
        "amc.endDate": term.endDate,
        "amc.amount": term.amount,
        "amc.paymentStatus": term.paymentStatus,
        "amc.paidAt": resolvePaidAt(term.paymentStatus, current),
        "amc.remarks": term.remarks,
        "amc.enrolledAt": isNewEnrollment ? new Date() : current.enrolledAt,
        "amc.updatedBy": req.user._id,
      },
    });

    res.json({
      message: isNewEnrollment ? "Customer enrolled in AMC" : "AMC updated successfully",
      data: withStatus(updated),
    });
  } catch (error) {
    console.error("Upsert AMC error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// POST /api/admin/business-forms/:id/amc/renew — archive current term, start a new one
const renewAmc = async (req, res) => {
  try {
    const loaded = await loadEligibleCustomer(req.params.id);
    if (loaded.status) return res.status(loaded.status).json({ message: loaded.message });
    const current = loaded.form.amc;

    if (!current?.isEnrolled) {
      return res.status(400).json({ message: "Customer is not enrolled in AMC" });
    }

    const { error, term } = validateAmcTerm(req.body);
    if (error) return res.status(400).json({ message: error });

    if (term.startDate <= new Date(current.startDate)) {
      return res.status(400).json({
        message: "Renewal From date must be after the current AMC From date",
      });
    }

    const updated = await updateAndReturn(req.params.id, {
      $push: { amcHistory: historyEntry(current, "renewed", req.user._id) },
      $set: {
        "amc.startDate": term.startDate,
        "amc.endDate": term.endDate,
        "amc.amount": term.amount,
        "amc.paymentStatus": term.paymentStatus,
        "amc.paidAt": term.paymentStatus === "paid" ? new Date() : null,
        "amc.remarks": term.remarks,
        "amc.updatedBy": req.user._id,
      },
    });

    res.json({ message: "AMC renewed successfully", data: withStatus(updated) });
  } catch (error) {
    console.error("Renew AMC error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// DELETE /api/admin/business-forms/:id/amc — cancel enrollment (kept in history)
const cancelAmc = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const form = await BusinessForm.findById(req.params.id).select("amc").lean();
    if (!form) return res.status(404).json({ message: "Customer not found" });
    if (!form.amc?.isEnrolled) {
      return res.status(400).json({ message: "Customer is not enrolled in AMC" });
    }

    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";

    await BusinessForm.updateOne(
      { _id: req.params.id },
      {
        $push: { amcHistory: historyEntry(form.amc, "cancelled", req.user._id, reason) },
        $set: { amc: { isEnrolled: false, updatedBy: req.user._id } },
      },
    );

    res.json({ message: "AMC cancelled successfully" });
  } catch (error) {
    console.error("Cancel AMC error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  validateAmcTerm,
  getAmcCustomers,
  getFranchiseAmcCustomers,
  upsertAmc,
  renewAmc,
  cancelAmc,
};
