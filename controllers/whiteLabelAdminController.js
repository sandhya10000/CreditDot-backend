const CustomBrandedRequest = require("../models/CustomBrandedRequest");
const Franchise = require("../models/Franchise");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/admin/white-label/partners?page=&limit=&search=
// Lists partners who have paid for White Label Reports
const listWhiteLabelPartners = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const search = req.query.search?.trim() || "";

    const filter = { paymentStatus: "Paid" };

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const matchingFranchises = await Franchise.find({
        $or: [{ businessName: regex }, { franchiseCode: regex }],
      }).select("userId");
      filter.$or = [
        { requestId: regex },
        { email: regex },
        { phone: regex },
        { partnerId: { $in: matchingFranchises.map((f) => f.userId) } },
      ];
    }

    const [total, requests] = await Promise.all([
      CustomBrandedRequest.countDocuments(filter),
      CustomBrandedRequest.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const partnerIds = requests.map((r) => r.partnerId);
    const franchises = await Franchise.find({ userId: { $in: partnerIds } })
      .select("userId businessName franchiseCode ownerName")
      .lean();
    const franchiseByUser = new Map(franchises.map((f) => [String(f.userId), f]));

    const partners = requests.map((r) => {
      const f = franchiseByUser.get(String(r.partnerId)) || {};
      return {
        _id: r._id,
        partnerId: r.partnerId,
        requestId: r.requestId,
        businessName: f.businessName || "N/A",
        franchiseCode: f.franchiseCode || null,
        ownerName: f.ownerName || "",
        email: r.email,
        phone: r.phone,
        amount: r.amount,
        paymentId: r.paymentId,
        status: r.status,
        paidAt: r.updatedAt,
      };
    });

    res.status(200).json({ partners, total, page, limit });
  } catch (error) {
    console.error("Admin white label list error:", error);
    res.status(500).json({ message: "Failed to load White Label partners." });
  }
};

// GET /api/admin/white-label/partners/:partnerId/reports
// Placeholder: white-label report generation is not built yet, so this returns none.
const getWhiteLabelPartnerReports = async (req, res) => {
  res.status(200).json({ reports: [] });
};

module.exports = { listWhiteLabelPartners, getWhiteLabelPartnerReports };
