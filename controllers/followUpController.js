const mongoose = require("mongoose");
const BusinessForm = require("../models/BusinessForm");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDay = (value) => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateForm = (query) =>
  query
    .populate(
      "selectedPackage",
      "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
    )
    .populate("franchiseId", "businessName");

// GET /api/business/follow-ups
// Customers with a scheduled follow-up, sorted by the soonest date first.
// Query: page, limit, search, fromDate, toDate (YYYY-MM-DD), paymentStatus, customerType
const getBusinessFollowUps = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const search = req.query.search?.trim() || "";
    const { fromDate, toDate, paymentStatus, customerType } = req.query;

    const filter = { nextFollowUpDate: { $nin: [null, ""] } };

    if (paymentStatus && ["pending", "paid", "failed"].includes(paymentStatus)) {
      filter.paymentStatus = paymentStatus;
    }
    if (customerType === "business") {
      filter.customerType = "business";
    } else if (customerType === "individual") {
      filter.customerType = { $ne: "business" };
    }

    // Dates are YYYY-MM-DD strings, so string comparison orders them correctly
    if (fromDate || toDate) {
      const range = {};
      if (fromDate && isValidDay(fromDate)) range.$gte = fromDate;
      if (toDate && isValidDay(toDate)) range.$lte = toDate;
      if (Object.keys(range).length) filter.nextFollowUpDate = { ...filter.nextFollowUpDate, ...range };
    }

    if (search) {
      const pattern = escapeRegex(search);
      const matchingFranchises = await mongoose
        .model("Franchise")
        .find({ businessName: { $regex: pattern, $options: "i" } })
        .select("_id");

      filter.$or = [
        { customerName: { $regex: pattern, $options: "i" } },
        { customerEmail: { $regex: pattern, $options: "i" } },
        { customerPhone: { $regex: pattern, $options: "i" } },
        { customerId: { $regex: pattern, $options: "i" } },
      ];
      if (matchingFranchises.length) {
        filter.$or.push({ franchiseId: { $in: matchingFranchises.map((f) => f._id) } });
      }
    }

    const total = await BusinessForm.countDocuments(filter);
    const businessData = await populateForm(
      BusinessForm.find(filter)
        .sort({ nextFollowUpDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    );

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      businessData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// PUT /api/business/admin/business-forms/:id/follow-up
// Body: { nextFollowUpDate: "YYYY-MM-DD", note?: string }
const setBusinessFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { nextFollowUpDate, note = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Customer not found" });
    }
    if (!isValidDay(nextFollowUpDate)) {
      return res.status(400).json({ message: "Pick a valid follow-up date" });
    }

    const updated = await BusinessForm.findByIdAndUpdate(
      id,
      {
        $set: { nextFollowUpDate },
        $push: {
          followUpHistory: {
            followUpDate: nextFollowUpDate,
            note: String(note).trim().slice(0, 500),
            createdBy: {
              userId: req.user._id,
              name: req.user.name,
              role: req.user.staffRoleName || req.user.role,
            },
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      success: true,
      message: "Follow-up scheduled",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// DELETE /api/business/admin/business-forms/:id/follow-up
// Marks the follow-up as done. The history is kept.
const clearBusinessFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const updated = await BusinessForm.findByIdAndUpdate(
      id,
      { $set: { nextFollowUpDate: null } },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({ success: true, message: "Follow-up marked as done", data: updated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  getBusinessFollowUps,
  setBusinessFollowUp,
  clearBusinessFollowUp,
};
