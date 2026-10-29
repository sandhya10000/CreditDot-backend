const User = require("../models/User");
const Franchise = require("../models/Franchise");
const generateFranchiseCode = require("../utils/generateFranchiseCode");
const Package = require("../models/Package");
const Lead = require("../models/Lead");
const Transaction = require("../models/Transaction");
const Payout = require("../models/Payout");
const Referral = require("../models/Referral");
const CreditReport = require("../models/CreditReport");
const Setting = require("../models/Setting");
const BusinessForm = require("../models/BusinessForm");
const KycRequest = require("../models/KycRequest");
const {
  scopeFilter,
  franchiseScope,
  scopeTransactions,
  isScoped,
} = require("../utils/franchiseScope");
const {
  sendLeadAssignmentEmail,
  sendAccountCredentialsEmail,
  sendAdminNotificationEmail,
  sendRegistrationApprovalEmail,
  sendRelationshipManagerEmail,
  sendCreditAnalystEmail,
  sendRegistrationRejectionEmail,
} = require("../utils/emailService");
const {
  updateAgreementPackageDetails,
} = require("./digitalAgreementController");
const googleSheetsService = require("../utils/googleSheetsService");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const ReportDownload = require("../models/ReportDownload");

// Configure CSV file upload
const csvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      cb(null, "leads-" + Date.now() + ".csv");
    },
  }),
  fileFilter: (req, file, cb) => {
    // Accept only CSV files
    if (file.mimetype === "text/csv" || file.originalname.match(/\.csv$/)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed!"), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Get dashboard statistics
// IST (UTC+5:30) helpers so month/year boundaries match what the admin sees in India
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istStart = (year, monthIndex, day = 1) =>
  new Date(Date.UTC(year, monthIndex, day) - IST_OFFSET_MS);

const currentIstYearMonth = () => {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
};

// Optional period filter for the package revenue cards: all (default) | month | year
const getRevenuePeriodRange = (query) => {
  const period = query.period;
  if (period !== "month" && period !== "year") return null;

  const current = currentIstYearMonth();
  const year = Number(query.year) || current.year;
  if (period === "year") {
    return { $gte: istStart(year, 0), $lt: istStart(year + 1, 0) };
  }
  const month = Number(query.month) || current.month;
  return { $gte: istStart(year, month - 1), $lt: istStart(year, month) };
};

const getDashboardStats = async (req, res) => {
  try {
    const periodRange = getRevenuePeriodRange(req.query);
    const periodMatch = periodRange ? { createdAt: periodRange } : {};

    // Business Managers see only their own franchises' figures (no-op for admins)
    const franchiseFilter = franchiseScope(req);
    const leadFilter = await scopeFilter(req);
    const txScope = await scopeTransactions(req);
    const bizFormFilter = await scopeFilter(req);

    const totalFranchises = await Franchise.countDocuments(franchiseFilter);
    const activeFranchises = await Franchise.countDocuments({
      ...franchiseFilter,
      isActive: true,
    });
    const pendingKycFranchises = await Franchise.countDocuments({
      ...franchiseFilter,
      kycStatus: "pending",
    });
    const totalPackages = await Package.countDocuments({ isActive: true });
    const totalLeads = await Lead.countDocuments(leadFilter);
    const totalTransactions = await Transaction.countDocuments({
      ...txScope,
      status: "paid",
    });

    // Calculate total revenue
    const revenueResult = await Transaction.aggregate([
      { $match: { ...txScope, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Current date and time
    const now = new Date();

    // Start of current month and year, in IST
    const istNow = currentIstYearMonth();
    const currentMonthStart = istStart(istNow.year, istNow.month - 1);
    const currentYearStart = istStart(istNow.year, 0);

    // Current month revenue
    const currentMonthRevenueResult = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: {
            $gte: currentMonthStart,
            $lte: now,
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const currentMonthRevenue = currentMonthRevenueResult[0]?.total || 0;

    // Current year revenue
    const currentYearRevenueResult = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: {
            $gte: currentYearStart,
            $lte: now,
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const currentYearRevenue = currentYearRevenueResult[0]?.total || 0;

    // Month-wise revenue
    const monthlyRevenue = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: { $lte: now },
        },
      },
      {
        $group: {
          _id: {
            year: {
              $year: {
                date: "$createdAt",
                timezone: "Asia/Kolkata",
              },
            },
            month: {
              $month: {
                date: "$createdAt",
                timezone: "Asia/Kolkata",
              },
            },
          },
          revenue: { $sum: "$amount" },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    // Year-wise revenue
    const yearlyRevenue = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: { $lte: now },
        },
      },
      {
        $group: {
          _id: {
            $year: {
              date: "$createdAt",
              timezone: "Asia/Kolkata",
            },
          },
          revenue: { $sum: "$amount" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Calculate revenue from franchise packages (regular packages)
    // Need to ensure these transactions are linked to active franchises/users
    const franchisePackageRevenueResult = await Transaction.aggregate([
      {
        $match: {
          ...periodMatch,
          $and: [txScope],
          $or: [
            {
              status: "paid",
            },
            {
              status: "created",
              packageId: { $exists: true, $ne: null },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: { "user.isActive": { $ne: false } } }, // Only count revenue from active users
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const franchisePackageRevenue =
      franchisePackageRevenueResult.length > 0
        ? franchisePackageRevenueResult[0].total
        : 0;

    // Calculate revenue from customer packages (business forms)
    // We need to get the revenue from paid business forms that are linked to existing franchises
    const paidBusinessForms = await BusinessForm.aggregate([
      {
        $match: {
          ...periodMatch,
          ...bizFormFilter,
          $or: [
            { paymentStatus: "paid" },
            { manualAmount: { $gt: 0 } }, //admin manual entries
          ],
        },
      },
      {
        $lookup: {
          from: "customerpackages",
          localField: "selectedPackage",
          foreignField: "_id",
          as: "package",
        },
      },
      // { $unwind: "$package" },
      // {
      //   $lookup: {
      //     from: "franchises",
      //     localField: "franchiseId",
      //     foreignField: "_id",
      //     as: "franchise",
      //   },
      // },
      // { $unwind: "$franchise" },
      // { $match: { "franchise._id": { $exists: true } } }, // Only count revenue from existing franchises

      // { $group: { _id: null, total: { $sum: "$package.price" } } },

      {
        $addFields: {
          packagePrice: {
            $ifNull: [{ $arrayElemAt: ["$package.price", 0] }, 0],
          },
          manualAmountValue: {
            $ifNull: ["$manualAmount", 0],
          },
        },
      },
      {
        $addFields: {
          finalAmount: {
            $add: ["$manualAmountValue", "$packagePrice"],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: "$finalAmount",
          },
        },
      },
    ]);

    const customerPackageRevenue =
      paidBusinessForms.length > 0 ? paidBusinessForms[0].total : 0;

    res.json({
      totalFranchises,
      activeFranchises,
      pendingKycFranchises,
      totalPackages,
      totalLeads,
      totalTransactions,
      totalRevenue,
      // New revenue fields
      currentMonthRevenue,
      currentYearRevenue,
      monthlyRevenue,
      yearlyRevenue,

      franchisePackageRevenue,
      customerPackageRevenue,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get recent activities for admin dashboard
const getRecentActivities = async (req, res) => {
  try {
    // Business Managers only see activity from their own franchises
    const scopedUserFilter = isScoped(req)
      ? { _id: { $in: (await Franchise.find(franchiseScope(req)).select("userId").lean()).map((f) => f.userId) } }
      : {};
    const txScope = await scopeTransactions(req);

    // Get recent user registrations
    const recentUsers = await User.find({ ...scopedUserFilter }, "name email createdAt")
      .sort({ createdAt: -1 })
      .limit(5);

    // Get recent transactions
    const recentTransactions = await Transaction.find({ ...txScope, status: "paid" })
      .populate("userId", "name")
      .populate("packageId", "name")
      .sort({ createdAt: -1 })
      .limit(5);

    // Get recent KYC submissions
    const recentKyc = await Franchise.find({
      ...franchiseScope(req),
      kycStatus: { $in: ["submitted", "approved", "rejected"] },
    })
      .populate("userId", "name")
      .sort({ kycSubmittedAt: -1 })
      .limit(5);

    // Combine and format activities
    const activities = [];

    recentUsers.forEach((user) => {
      activities.push({
        id: user._id,
        user: user.name,
        action: "Registered as franchise",
        time: user.createdAt,
        status: "completed",
        type: "registration",
      });
    });

    recentTransactions.forEach((transaction) => {
      activities.push({
        id: transaction._id,
        user: transaction.userId?.name || "Unknown User",
        action: `Purchased ${transaction.packageId?.name || "package"}`,
        time: transaction.createdAt,
        status: "completed",
        type: "transaction",
      });
    });

    recentKyc.forEach((franchise) => {
      activities.push({
        id: franchise._id,
        user: franchise.userId?.name || "Unknown User",
        action: "KYC submitted",
        time: franchise.kycSubmittedAt,
        status:
          franchise.kycStatus === "approved"
            ? "completed"
            : franchise.kycStatus === "rejected"
              ? "rejected"
              : "pending",
        type: "kyc",
      });
    });

    // Sort by time and limit to 5 most recent
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recentActivities = activities.slice(0, 5);

    res.json(recentActivities);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all users (admin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get user by ID (admin only)
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update user (admin only)
const updateUser = async (req, res) => {
  try {
    const { name, email, phone, isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, phone, isActive },
      { new: true, runValidators: true },
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Create lead (admin only)
const createLead = async (req, res) => {
  try {
    const {
      franchiseId,
      name,
      email,
      phone,
      address,
      creditScore,
      creditReportUrl,
      assignedTo,
      notes,
    } = req.body;

    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({
        message: "Name and phone are required",
      });
    }

    // Create new lead
    const lead = new Lead({
      franchiseId: franchiseId || undefined, // Make franchiseId optional
      name,
      email: email ? email.toLowerCase() : undefined,
      phone,
      address,
      creditScore,
      creditReportUrl,
      assignedTo,
      notes: notes
        ? [
          {
            note: notes,
            createdBy: req.user.id,
            createdAt: new Date(),
          },
        ]
        : undefined,
    });

    await lead.save();

    // Populate references
    await lead.populate("franchiseId", "businessName");
    await lead.populate("assignedTo", "name");

    res.status(201).json({
      message: "Lead created successfully",
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all leads (admin only)
const getAllLeads = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search?.trim() || "";
    const skip = (page - 1) * limit;
    const filter = {};
    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const leads = await Lead.find(filter)
      .populate("franchiseId", "businessName")
      .populate("assignedTo", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Lead.countDocuments(filter);

    res.status(200).json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      leads,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get lead by ID (admin only)
const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("franchiseId", "businessName")
      .populate("assignedTo", "name");

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update lead (admin only)
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate("franchiseId", "businessName")
      .populate("assignedTo", "name");

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    // Send email notification if franchiseId was updated (lead assigned)
    if (req.body.franchiseId) {
      try {
        // Get the franchise user
        const franchise = await Franchise.findById(req.body.franchiseId);
        if (franchise) {
          const franchiseUser = await User.findById(franchise.userId);
          if (franchiseUser) {
            // Get the admin user who made the assignment
            const adminUser = await User.findById(req.user.id);

            // Send assignment email
            await sendLeadAssignmentEmail(franchiseUser, lead, adminUser);
          }
        }
      } catch (emailError) {
        console.error("Failed to send lead assignment email:", emailError);
        // Don't fail the request if email sending fails
      }
    }

    res.json({
      message: "Lead updated successfully",
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete lead (admin only)
const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({
      message: "Lead deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Bulk upload leads from CSV file (admin only)
const bulkUploadLeads = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        message: "No CSV file uploaded",
      });
    }

    const results = [];
    const filePath = req.file.path;

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    // Validate and process leads
    const createdLeads = [];
    const errors = [];

    for (const [index, row] of results.entries()) {
      try {
        // Validate required fields
        if (!row.name || !row.phone) {
          errors.push(`Row ${index + 1}: Name and phone are required`);
          continue;
        }

        // Create lead object
        const leadData = {
          name: row.name,
          email: row.email ? row.email.toLowerCase() : undefined,
          phone: row.phone,
          address: {
            street: row.address || undefined,
            city: row.city || undefined,
            state: row.state || undefined,
            pincode: row.pincode || undefined,
          },
          creditScore: row.creditScore ? parseInt(row.creditScore) : undefined,
          creditReportUrl: row.creditReportUrl || undefined,
          status: "new", // Default status
        };

        // Create lead in database
        const lead = new Lead(leadData);
        await lead.save();

        // Populate references
        await lead.populate("franchiseId", "businessName");
        await lead.populate("assignedTo", "name");

        createdLeads.push(lead);
      } catch (error) {
        errors.push(`Row ${index + 1}: ${error.message}`);
      }
    }

    // Delete the uploaded file
    fs.unlinkSync(filePath);

    // Return response
    res.json({
      message: `${createdLeads.length} leads uploaded successfully`,
      createdLeads,
      errors,
      totalProcessed: results.length,
      successCount: createdLeads.length,
      errorCount: errors.length,
    });
  } catch (error) {
    // Delete the uploaded file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      message: "Server error during bulk upload",
      error: error.message,
    });
  }
};

// Get all transactions (admin only)
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("userId", "name email")
      .populate("franchiseId", "businessName")
      .populate("packageId", "name")
      .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get transaction by ID (admin only)
const getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate("userId", "name email")
      .populate("franchiseId", "businessName")
      .populate("packageId", "name");

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all payouts (admin only)
const getAllPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate("franchiseId", "businessName ownerName")
      .populate("processedBy", "name")
      .sort({ createdAt: -1 });

    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update payout status (admin only)
const updatePayout = async (req, res) => {
  try {
    const { status, remarks } = req.body;

    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      {
        status,
        remarks,
        processedAt: status === "completed" ? new Date() : undefined,
        processedBy: status === "completed" ? req.user.id : undefined,
      },
      { new: true, runValidators: true },
    )
      .populate("franchiseId", "businessName ownerName")
      .populate("processedBy", "name");

    if (!payout) {
      return res.status(404).json({ message: "Payout not found" });
    }

    res.json({
      message: "Payout updated successfully",
      payout,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all referrals (admin only)
const getAllReferrals = async (req, res) => {
  try {
    const referrals = await Referral.find()
      .populate("referrerFranchiseId", "businessName ownerName")
      .populate("referredFranchiseId", "businessName ownerName")
      .populate("packageId", "name")
      .sort({ createdAt: -1 });

    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get referral settings (admin only)
const getReferralSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: "referral_bonus_settings" });

    if (!settings) {
      return res.json({ value: [] });
    }

    // Populate package names in the settings
    const populatedSettings = [];
    for (const setting of settings.value) {
      const pkg = await Package.findById(setting.packageId);
      populatedSettings.push({
        ...setting,
        packageName: pkg ? pkg.name : "Unknown Package",
      });
    }

    res.json({ value: populatedSettings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update referral settings (admin only)
const updateReferralSettings = async (req, res) => {
  try {
    const { value } = req.body;

    let settings = await Setting.findOne({ key: "referral_bonus_settings" });

    if (settings) {
      settings.value = value;
      await settings.save();
    } else {
      settings = new Setting({
        key: "referral_bonus_settings",
        value,
        description: "Referral bonus percentages by package",
      });
      await settings.save();
    }

    res.json({
      message: "Referral settings updated successfully",
      settings,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all credit reports (admin only)
const getAllCreditReportsAdmin = async (req, res) => {
  try {
    const reports = await CreditReport.find()
      .populate("userId", "name email")
      .populate("franchiseId", "businessName")
      .sort({ createdAt: -1 });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get settings (admin only)
const getSettings = async (req, res) => {
  try {
    const settings = await Setting.find();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update setting (admin only)
const updateSetting = async (req, res) => {
  try {
    const { key, value, description } = req.body;

    let setting = await Setting.findOne({ key });

    if (setting) {
      setting.value = value;
      setting.description = description;
      await setting.save();
    } else {
      setting = new Setting({
        key,
        value,
        description,
      });
      await setting.save();
    }

    res.json({
      message: "Setting updated successfully",
      setting,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all franchises with credit information (admin only)
const getAllFranchisesWithCredits = async (req, res) => {
  try {
    const franchises = await Franchise.find({ isActive: true, isDeleted: { $ne: true } })
      .select("businessName credits totalCreditsPurchased kycStatus")
      .sort({ businessName: 1 });

    res.json(franchises);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Create franchise user by admin (admin only)
// =========================
// Credentials / invite helpers
// =========================

const { resolveBusinessManagerId } = require("../utils/franchiseScope");
const { assignNextManager } = require("../utils/assignBusinessManager");

const RESEND_COOLDOWN_MS = 60 * 1000;

// 10-char random hex password (always meets the 6-char schema minimum)
const generateTempPassword = () => crypto.randomBytes(5).toString("hex");

const markCredentialsSent = (userId) =>
  User.updateOne(
    { _id: userId },
    { $set: { credentialsSentAt: new Date() }, $inc: { credentialsSentCount: 1 } },
  );

// Soft-deleted accounts may still hold an email; rename them so the address
// can be reused (restore uses franchise.email, so this stays reversible)
const releaseEmailFromDeletedUsers = async (email, excludeUserId) => {
  const query = { email, isDeleted: true };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  const holders = await User.find(query);
  for (const holder of holders) {
    holder.email = `deleted_${Date.now()}_${holder.email.toLowerCase()}`;
    await holder.save();
  }
};

// Sends fresh credentials and only then changes the password, so a failed
// email never locks the partner out of their existing password.
const issueFranchiseCredentials = async (user, franchise) => {
  const newPassword = generateTempPassword();

  let info;
  try {
    info = await sendRegistrationApprovalEmail(user, franchise, newPassword, {
      isResend: true,
    });
  } catch (emailError) {
    console.error("Credentials email failed for", user.email, emailError);
    return { sent: false, error: emailError.message };
  }

  if (info && Array.isArray(info.rejected) && info.rejected.length > 0) {
    return { sent: false, error: "Recipient address was rejected by the mail server" };
  }

  user.password = newPassword;
  user.credentialsSentAt = new Date();
  user.credentialsSentCount = (user.credentialsSentCount || 0) + 1;
  await user.save();

  return { sent: true };
};

// Loads a franchise + its user and validates they are an active franchise partner
const loadFranchisePartner = async (franchiseId) => {
  if (!mongoose.Types.ObjectId.isValid(franchiseId)) {
    return { status: 404, message: "Franchise not found" };
  }
  const franchise = await Franchise.findById(franchiseId);
  if (!franchise || franchise.isDeleted) {
    return { status: 404, message: "Franchise not found" };
  }
  const user = await User.findById(franchise.userId);
  if (!user || user.isDeleted) {
    return { status: 404, message: "Franchise user not found" };
  }
  if (user.role !== "franchise_user" || (user.subRole && user.subRole !== "franchise")) {
    return { status: 400, message: "This action is only available for franchise partners" };
  }
  return { franchise, user };
};

// Copies the franchise credentials email to the creating Business Manager and the admin.
// Each copy is sent separately so one failing address does not block the other.
const sendFranchiseCopiesToManagerAndAdmin = async (req, user, franchise, tempPassword) => {
  if (!req.user?.scopedToOwnFranchises) return;

  const recipients = [req.user.email, process.env.ADMIN_EMAIL]
    .filter(Boolean)
    .map((email) => email.trim().toLowerCase());

  for (const to of new Set(recipients)) {
    try {
      await sendRegistrationApprovalEmail(user, franchise, tempPassword, { to });
    } catch (copyError) {
      console.error(`Franchise copy email to ${to} failed:`, copyError);
    }
  }
};

const createFranchiseUser = async (req, res) => {
  try {
    const { name, email, phone, alternatePhone, assignedPackages, role, subRole } = req.body;

    // Admin staff must be created from the Staff page so they get a role's permissions
    if (role === "admin") {
      return res.status(400).json({
        message: "Staff accounts are created from the Staff page and assigned a role",
      });
    }

    // Phone is required: partner WhatsApp messages are sent to this number
    if (!/^\d{10}$/.test(String(phone || ""))) {
      return res.status(400).json({ message: "Enter a valid 10-digit phone number" });
    }

    // Optional alternate mobile: validated only when given
    if (alternatePhone && !/^\d{10}$/.test(String(alternatePhone))) {
      return res.status(400).json({ message: "Enter a valid 10-digit alternate mobile number" });
    }

    // Default values
    const state = "Not Provided";
    const pincode = "000000";
    const language = "en";

    // Check existing user (active accounts block creation)
    const normalizedEmail = (email || "").trim().toLowerCase();
    const activeUser = await User.findOne({
      email: normalizedEmail,
      isDeleted: { $ne: true },
    });
    if (activeUser) {
      return res.status(400).json({
        message: "User already exists with this email",
      });
    }

    // Email held by a soft-deleted account — free it so the email can be reused
    await releaseEmailFromDeletedUsers(normalizedEmail);

    // Generate password
    const tempPassword = generateTempPassword();

    // Create user
    const user = new User({
      name,
      email: normalizedEmail,
      //phone,
      state,
      pincode,
      language,
      password: tempPassword,
      role: role || "franchise_user",
      subRole: subRole || "franchise",
      isActive: true,
      isVerified: true,
    });

    // SAVE USER
    await user.save();

    // Default franchise
    let franchise = null;

    // ONLY for franchise user
    if (user.role === "franchise_user") {
      const franchiseData = {
        userId: user._id,
        businessName: name,
        ownerName: name,
        email: normalizedEmail,

        phone,
        alternatePhone: alternatePhone || undefined,
        franchiseCode: null, // <-- add this
        // Business Manager who owns this partner (creator, or admin's pick)
        // Explicit pick (or a BM creating their own partner) wins; otherwise next in rotation
        businessManager:
          (await resolveBusinessManagerId(req, req.body.businessManagerId)) ||
          (await assignNextManager()),
        kycStatus: "pending",
        agreementSigned: true,
        agreementSignedAt: new Date(),
        //Login allow
        isActive: true,
      };

      // Packages
      if (
        assignedPackages &&
        Array.isArray(assignedPackages) &&
        assignedPackages.length > 0
      ) {
        franchiseData.assignedPackages = assignedPackages;

        const packages = await Package.find({
          _id: { $in: assignedPackages },
        });

        let totalCredits = 0;

        packages.forEach((pkg) => {
          totalCredits += pkg.creditsIncluded || 0;
        });

        const totalPrice = packages.reduce(
          (sum, pkg) => sum + (pkg.price || 0),
          0,
        );

        franchiseData.credits = totalCredits;
        franchiseData.totalCreditsPurchased = totalCredits;

        // Agreement update
        try {
          await updateAgreementPackageDetails(user._id, {
            price: `Rs. ${totalPrice}`,
            name: packages[0]?.name || "Package",
            credits: totalCredits,
          });
        } catch (agreementError) {
          console.error("Agreement update failed:", agreementError);
        }
      }

      franchise = new Franchise(franchiseData);

      await franchise.save();

      console.log("Franchise saved:", franchise);
    }

    // =========================
    // SEND EMAILS
    // =========================

    try {
      if (user.subRole === "relationship_manager") {
        await sendRelationshipManagerEmail(user, tempPassword);

        console.log("RM mail sent");
      } else if (user.subRole === "credit_analyst") {
        await sendCreditAnalystEmail(user, tempPassword);

        console.log("CA mail sent");
      } else if (user.subRole === "franchise") {
        await sendRegistrationApprovalEmail(user, franchise, tempPassword);
        await markCredentialsSent(user._id);

        console.log("Franchise mail sent");

        // Business Manager created this franchise: copy the email to the manager and admin
        await sendFranchiseCopiesToManagerAndAdmin(req, user, franchise, tempPassword);
      }
    } catch (emailError) {
      console.error("Mail sending failed:", emailError);
    }

    // Admin notification
    try {
      await sendAdminNotificationEmail(user);
    } catch (emailError) {
      console.error("Admin notification failed:", emailError);
    }

    // Google sheet sync
    try {
      const initialized = await googleSheetsService.initialize();

      if (initialized) {
        await googleSheetsService.syncRegistrationData();

        console.log("Google sheet synced");
      }
    } catch (syncError) {
      console.error("Google sheet sync failed:", syncError);
    }

    // FINAL RESPONSE
    return res.status(201).json({
      success: true,
      message: `${user.role} created successfully`,
      user,
      franchise,
    });
  } catch (error) {
    console.error("Create franchise user error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Add or deduct credits for a franchise (admin only)
const rechargeFranchiseCredits = async (req, res) => {
  try {
    const { franchiseId, credits, remarks, type = "add" } = req.body;

    if (type !== "add" && type !== "deduct") {
      return res.status(400).json({
        message: "Type must be either 'add' or 'deduct'",
      });
    }

    // Validate input
    if (!franchiseId || credits === undefined || credits <= 0) {
      return res.status(400).json({
        message: "Franchise ID and positive credits amount are required",
      });
    }

    // Find the franchise
    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    if (franchise.isDeleted) {
      return res.status(400).json({ message: "Franchise is deleted" });
    }

    if (type === "deduct" && franchise.credits < credits) {
      return res.status(400).json({
        message: `Insufficient credit balance. Available: ${franchise.credits}`,
      });
    }

    // Update credits
    const oldCredits = franchise.credits;
    if (type === "deduct") {
      franchise.credits -= credits;
    } else {
      franchise.credits += credits;
      franchise.totalCreditsPurchased += credits;
    }
    await franchise.save();

    const isDeduct = type === "deduct";

    // Log the transaction (optional)
    // Only create transaction if franchise has a valid userId
    if (franchise.userId) {
      const transaction = new Transaction({
        userId: franchise.userId,
        franchiseId: franchise._id,
        amount: 0, // Free recharge
        currency: "INR",
        status: "paid",
        paymentMethod: isDeduct ? "admin_deduct" : "admin_recharge",
        remarks:
          remarks ||
          (isDeduct
            ? `Admin credit deduct: ${credits} credits`
            : `Admin credit recharge: ${credits} credits`),
        metadata: {
          adminId: req.user.id,
          oldCredits,
          newCredits: franchise.credits,
          ...(isDeduct ? { creditsDeducted: credits } : { creditsAdded: credits }),
        },
      });

      try {
        await transaction.save();
      } catch (transactionError) {
        console.error("Error saving transaction:", transactionError);
        // If transaction fails, we still want to return success for the credit recharge
        // since the franchise was updated successfully
      }
    } else {
      console.warn(
        `Franchise ${franchise._id} has no userId, skipping transaction creation`,
      );
    }

    res.json({
      message: isDeduct
        ? "Credits deducted successfully"
        : "Credits recharged successfully",
      franchise: {
        id: franchise._id,
        businessName: franchise.businessName,
        credits: franchise.credits,
        totalCreditsPurchased: franchise.totalCreditsPurchased,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get credit recharge history (admin only)
const getCreditRechargeHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      paymentMethod: { $in: ["admin_recharge", "admin_deduct"] },
    })
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Calculate payouts for a franchise (admin only)
const calculateFranchisePayouts = async (req, res) => {
  try {
    const { franchiseId, periodStart, periodEnd } = req.body;

    // Validate input
    if (!franchiseId || !periodStart || !periodEnd) {
      return res.status(400).json({
        message: "Franchise ID, period start, and period end are required",
      });
    }

    // Validate dates
    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({
        message: "Invalid date format",
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        message: "Period start must be before period end",
      });
    }

    // Find the franchise and populate assigned packages
    const franchise = await Franchise.findById(franchiseId).populate(
      "assignedPackages",
      "name businessPayoutType businessPayoutPercentage businessPayoutFixedAmount",
    );
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Get the franchise's assigned package for payout calculation
    // For now, we'll use the first assigned package if multiple are assigned
    const franchisePackage =
      franchise.assignedPackages && franchise.assignedPackages.length > 0
        ? franchise.assignedPackages[0]
        : null;

    // Get business forms (customer packages sold) during the period
    const businessForms = await BusinessForm.find({
      franchiseId: franchiseId,
      paymentStatus: "paid",
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate(
      "selectedPackage",
      "name price creditsIncluded businessPayoutType businessPayoutPercentage businessPayoutFixedAmount",
    );

    console.log("Found business forms:", businessForms.length);
    console.log("Business forms data:", JSON.stringify(businessForms, null, 2));

    // Calculate business payout based on customer packages sold
    let totalBusinessPayout = 0;
    let creditsGenerated = 0;

    for (const form of businessForms) {
      if (form.selectedPackage) {
        console.log("Processing form:", form._id);
        console.log(
          "Selected package:",
          JSON.stringify(form.selectedPackage, null, 2),
        );

        creditsGenerated += form.selectedPackage.creditsIncluded || 0;

        // Calculate business payout based on the franchise's assigned package settings
        // The franchise's package determines their commission rate
        let payoutAmount = 0;

        // Use the franchise's package payout settings
        if (franchisePackage) {
          if (franchisePackage.businessPayoutType === "percentage") {
            const payoutPercentage =
              franchisePackage.businessPayoutPercentage !== undefined
                ? franchisePackage.businessPayoutPercentage
                : 20;
            payoutAmount =
              (form.selectedPackage.price * payoutPercentage) / 100;
            console.log(
              `Calculating percentage payout using franchise package ${franchisePackage.name}: ${form.selectedPackage.price} * ${payoutPercentage}% = ${payoutAmount}`,
            );
          } else {
            payoutAmount = franchisePackage.businessPayoutFixedAmount || 0;
            console.log(
              `Using fixed payout from franchise package ${franchisePackage.name}: ${payoutAmount}`,
            );
          }
        } else {
          // Fallback to customer package settings if no franchise package is assigned
          if (form.selectedPackage.businessPayoutType === "percentage") {
            const payoutPercentage =
              form.selectedPackage.businessPayoutPercentage !== undefined
                ? form.selectedPackage.businessPayoutPercentage
                : 20;
            payoutAmount =
              (form.selectedPackage.price * payoutPercentage) / 100;
            console.log(
              `Calculating percentage payout using customer package ${form.selectedPackage.name}: ${form.selectedPackage.price} * ${payoutPercentage}% = ${payoutAmount}`,
            );
          } else {
            payoutAmount = form.selectedPackage.businessPayoutFixedAmount || 0;
            console.log(
              `Using fixed payout from customer package ${form.selectedPackage.name}: ${payoutAmount}`,
            );
          }
        }

        totalBusinessPayout += payoutAmount;
        console.log(
          `Added payout for form ${form._id}: ${payoutAmount}, Total so far: ${totalBusinessPayout}`,
        );
      }
    }

    // Get credit reports generated during the period (as a measure of business done)
    const creditReports = await CreditReport.find({
      franchiseId: franchiseId,
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    });

    // Additional business metrics could be added here
    // For now, we'll use credit reports as a proxy for business activity

    // Calculate referral bonuses
    const referrals = await Referral.find({
      referrerFranchiseId: franchiseId,
      status: "credited",
      creditedAt: {
        $gte: startDate,
        $lte: endDate,
      },
    });

    let referralBonus = 0;
    referrals.forEach((referral) => {
      referralBonus += referral.bonusAmount || 0;
    });

    // Calculate total payout amount
    // Package business payout + referral bonuses
    const totalAmount = totalBusinessPayout + referralBonus;

    // Calculate TDS (2% of total amount)
    const tdsAmount = totalAmount * 0.02;

    // IMPORTANT: GST is NOT deducted from franchise payouts
    // Franchisees pay GST separately on their own services
    // Only TDS is deducted at source
    const gstAmount = 0; // No GST deduction

    // Calculate final payout amount after TDS deduction only
    const finalPayoutAmount = totalAmount - tdsAmount;

    // Create payout record
    const payout = new Payout({
      franchiseId: franchiseId,
      amount: totalBusinessPayout,
      periodStart: startDate,
      periodEnd: endDate,
      creditsGenerated: creditsGenerated,
      referralBonus: referralBonus,
      totalAmount: finalPayoutAmount,
      grossAmount: totalAmount,
      tdsAmount: tdsAmount,
      gstAmount: gstAmount, // Set to 0 (no GST deduction)
      tdsPercentage: 2,
      gstPercentage: 0, // No GST deduction
      status: "pending",
    });

    await payout.save();

    // Populate franchise details
    await payout.populate("franchiseId", "businessName ownerName");

    res.json({
      message: "Payout calculated successfully",
      payout,
      tdsDeducted: tdsAmount,
      gstDeducted: 0, // No GST deducted
      grossAmount: totalAmount,
      netAmount: finalPayoutAmount,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get payouts for a specific franchise (admin only)
const getFranchisePayouts = async (req, res) => {
  try {
    const { franchiseId } = req.params;

    const payouts = await Payout.find({ franchiseId })
      .populate("franchiseId", "businessName ownerName")
      .populate("processedBy", "name")
      .sort({ createdAt: -1 });

    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Approve franchise registration (admin only)
const approveRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedPackages } = req.body; // Get assigned packages from request body

    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Find user
    const user = await User.findById(franchise.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Activate user and franchise
    user.isActive = true;
    user.isVerified = true; // Mark as verified since admin approved this registration
    franchise.isActive = true;
    // Franchise ID is issued on approval if not already assigned
    if (!franchise.franchiseCode) {
      franchise.franchiseCode = await generateFranchiseCode();
    }

    // Assign packages and add credits if provided
    if (
      assignedPackages &&
      Array.isArray(assignedPackages) &&
      assignedPackages.length > 0
    ) {
      franchise.assignedPackages = assignedPackages;

      // Add credits from assigned packages
      const packages = await Package.find({ _id: { $in: assignedPackages } });
      let totalCredits = 0;
      packages.forEach((pkg) => {
        totalCredits += pkg.creditsIncluded || 0;
      });

      // Calculate total price of packages
      const totalPrice = packages.reduce(
        (sum, pkg) => sum + (pkg.price || 0),
        0,
      );

      // Add credits to franchise
      franchise.credits += totalCredits;
      franchise.totalCreditsPurchased += totalCredits;

      // Update digital agreement with package details
      try {
        await updateAgreementPackageDetails(user._id, {
          price: `Rs. ${totalPrice}`,
          name: packages[0]?.name || "Package",
          credits: totalCredits,
        });
      } catch (agreementError) {
        console.error(
          "Failed to update digital agreement with package details:",
          agreementError,
        );
      }
    }

    await user.save();
    await franchise.save();

    // Generate a temporary password for first-time activation
    const tempPassword = generateTempPassword();
    user.password = tempPassword;
    await user.save();

    // Send approval email to franchise user with login credentials
    try {
      // Log email configuration status for debugging
      console.log(
        "Attempting to send registration approval email to:",
        user.email,
      );
      console.log(
        "Temp password generated for approval:",
        tempPassword ? "Yes" : "No",
      );
      console.log("Assigned packages:", franchise.assignedPackages);

      await sendRegistrationApprovalEmail(user, franchise, tempPassword);
      await markCredentialsSent(user._id);
      console.log(
        "Successfully sent registration approval email to user:",
        user.email,
      );
    } catch (emailError) {
      console.error(
        "Failed to send registration approval email to user:",
        user.email,
        emailError,
      );
      console.error("Email error details:", {
        message: emailError.message,
        code: emailError.code,
        stack: emailError.stack,
      });
      // Don't fail the approval if email sending fails
    }

    // Trigger sync to Google Sheets for new registration
    try {
      const initialized = await googleSheetsService.initialize();
      if (initialized) {
        // Sync registration data to Google Sheets
        await googleSheetsService.syncRegistrationData();
        console.log(
          "Successfully synced approved franchise user to Google Sheets",
        );
      } else {
        console.error("Failed to initialize Google Sheets service for sync");
      }
    } catch (syncError) {
      console.error(
        "Failed to sync approved franchise user to Google Sheets:",
        syncError,
      );
      // Don't fail the approval if sync fails
    }

    res.json({
      message: "Registration approved successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reject franchise registration (admin only)
const rejectRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Find user
    const user = await User.findById(franchise.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Deactivate user and franchise
    user.isActive = false;
    franchise.isActive = false;
    await user.save();
    await franchise.save();

    // Send rejection email to franchise user
    try {
      await sendRegistrationRejectionEmail(user, franchise, rejectionReason);
    } catch (emailError) {
      console.error("Failed to send registration rejection email:", emailError);
      // Don't fail the rejection if email sending fails
    }

    res.json({
      message: "Registration rejected successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Soft-delete franchise (admin only) — data is preserved, franchise is marked deleted
const deleteFranchise = async (req, res) => {
  try {
    const { id } = req.params;

    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    if (franchise.isDeleted) {
      return res.status(400).json({ message: "Franchise is already deleted" });
    }

    // Soft-delete franchise (preserve all linked data: leads, business, reports, etc.)
    franchise.isDeleted = true;
    franchise.deletedAt = new Date();
    franchise.isActive = false;
    await franchise.save();

    // Soft-delete linked user (block login, keep record)
    // Rename email to free the unique address so the same email can register again
    if (franchise.userId) {
      const linkedUser = await User.findById(franchise.userId);
      if (linkedUser && !linkedUser.isDeleted) {
        linkedUser.isDeleted = true;
        linkedUser.deletedAt = new Date();
        linkedUser.isActive = false;
        // if (linkedUser.email && !linkedUser.email.startsWith("deleted_")) {
        //   linkedUser.email = `deleted_${Date.now()}_${linkedUser.email.toLowerCase()}`;
        // }
        await linkedUser.save();
      } else if (linkedUser) {
        linkedUser.isDeleted = true;
        linkedUser.deletedAt = new Date();
        linkedUser.isActive = false;
        await linkedUser.save();
      }
    }

    res.json({
      message: "Franchise is deleted",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Restore soft-deleted franchise (admin only)
const restoreFranchise = async (req, res) => {
  try {
    const { id } = req.params;

    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    if (!franchise.isDeleted) {
      return res.status(400).json({ message: "Franchise is not deleted" });
    }

    franchise.isDeleted = false;
    franchise.deletedAt = null;
    franchise.isActive = true;
    await franchise.save();

    if (franchise.userId) {
      const linkedUser = await User.findById(franchise.userId);
      if (linkedUser) {
        // Reclaim the original email (franchise.email was preserved on delete)
        const originalEmail = (franchise.email || "").toLowerCase();
        if (originalEmail) {
          const takenByOther = await User.findOne({
            email: originalEmail,
            _id: { $ne: linkedUser._id },
            isDeleted: { $ne: true },
          });
          if (takenByOther) {
            return res.status(400).json({
              message:
                "Cannot restore: this email is now used by another account",
            });
          }
          linkedUser.email = originalEmail;
        }
        linkedUser.isDeleted = false;
        linkedUser.deletedAt = null;
        linkedUser.isActive = true;
        await linkedUser.save();
      }
    }

    res.json({
      message: "Franchise restored successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update franchise certificate name (admin only)
const updateFranchiseCertificateName = async (req, res) => {
  try {
    const { franchiseId, certificateName } = req.body;

    // Validate input
    if (
      !franchiseId ||
      !certificateName ||
      certificateName.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Franchise ID and certificate name are required" });
    }

    // Find and update franchise
    const franchise = await Franchise.findByIdAndUpdate(
      franchiseId,
      { certificateName: certificateName.trim() },
      { new: true },
    );

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    res.json({
      message: "Certificate name updated successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get performance overview data for charts
const getPerformanceOverview = async (req, res) => {
  try {
    // Get date range from query parameters (default to last 30 days)
    const { period = "monthly", startDate, endDate } = req.query;

    let start, end;

    // Set date range based on period
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const now = new Date();
      switch (period) {
        case "weekly":
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "monthly":
          start = new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            now.getDate(),
          );
          break;
        case "quarterly":
          start = new Date(
            now.getFullYear(),
            now.getMonth() - 3,
            now.getDate(),
          );
          break;
        case "yearly":
          start = new Date(
            now.getFullYear() - 1,
            now.getMonth(),
            now.getDate(),
          );
          break;
        default:
          start = new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            now.getDate(),
          );
      }
      end = now;
    }

    // Format dates for aggregation
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Business Managers only see their own franchises' figures (no-op for admins)
    const txScope = await scopeTransactions(req);
    const leadScope = await scopeFilter(req);
    const franchiseScopeFilter = franchiseScope(req);

    // Get daily transaction data for revenue chart
    const revenueData = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": 1 },
      },
    ]);

    // Get daily lead data
    const leadData = await Lead.aggregate([
      {
        $match: {
          ...leadScope,
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": 1 },
      },
    ]);

    // Get franchise growth data
    const franchiseData = await Franchise.aggregate([
      {
        $match: {
          ...franchiseScopeFilter,
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": 1 },
      },
    ]);

    // Prepare chart data
    const chartData = [];

    // Create date range
    const dateRange = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      dateRange.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Map data to chart format
    dateRange.forEach((date) => {
      const dateStr = date.toISOString().split("T")[0];

      const revenue =
        revenueData.find((d) => d._id.date === dateStr)?.total || 0;
      const leads = leadData.find((d) => d._id.date === dateStr)?.count || 0;
      const franchises =
        franchiseData.find((d) => d._id.date === dateStr)?.count || 0;

      chartData.push({
        date: dateStr,
        revenue,
        leads,
        franchises,
      });
    });

    // Calculate totals and trends
    const totalRevenue = revenueData.reduce((sum, item) => sum + item.total, 0);
    const totalLeads = leadData.reduce((sum, item) => sum + item.count, 0);
    const totalFranchises = franchiseData.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    // Calculate previous period for trend comparison
    const prevStart = new Date(
      start.getTime() - (end.getTime() - start.getTime()),
    );
    const prevEnd = new Date(start);

    const prevRevenueData = await Transaction.aggregate([
      {
        $match: {
          ...txScope,
          status: "paid",
          createdAt: { $gte: prevStart, $lte: prevEnd },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const prevLeadData = await Lead.aggregate([
      {
        $match: {
          ...leadScope,
          createdAt: { $gte: prevStart, $lte: prevEnd },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
        },
      },
    ]);

    const prevTotalRevenue =
      prevRevenueData.length > 0 ? prevRevenueData[0].total : 0;
    const prevTotalLeads = prevLeadData.length > 0 ? prevLeadData[0].count : 0;

    const revenueGrowth = prevTotalRevenue
      ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
      : 0;
    const leadsGrowth = prevTotalLeads
      ? ((totalLeads - prevTotalLeads) / prevTotalLeads) * 100
      : 0;

    res.json({
      chartData,
      summary: {
        totalRevenue,
        totalLeads,
        totalFranchises,
        revenueGrowth: revenueGrowth.toFixed(2),
        leadsGrowth: leadsGrowth.toFixed(2),
      },
      period,
      startDate: start,
      endDate: end,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//Get report download data in admin side
const getDownloadStats = async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    //WEEK
    const startOfWeek = new Date();
    startOfWeek.setDate(today.getDate() - 7);

    //MONTH
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    //year
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    // Business Managers only see downloads by their own franchises' users (no-op for admins)
    // Business Managers see downloads of their own franchises' reports (no-op for admins)
    const downloadScope = await scopeFilter(req, "franchiseId");


    const todayCount = await ReportDownload.countDocuments({
      ...downloadScope,
      downloadedAt: { $gte: startOfDay },
    });

    const weeklyCount = await ReportDownload.countDocuments({
      ...downloadScope,
      downloadedAt: { $gte: startOfWeek },
    });
    const monthlyCount = await ReportDownload.countDocuments({
      ...downloadScope,
      downloadedAt: { $gte: startOfMonth },
    });
    const yearlyCount = await ReportDownload.countDocuments({
      ...downloadScope,
      downloadedAt: { $gte: startOfYear },
    });

    //latest downloads
    const latestDownloads = await ReportDownload.find(downloadScope)
      .sort({ downloadedAt: -1 })
      .limit(10);
    res.json({
      todayCount,
      weeklyCount,
      monthlyCount,
      yearlyCount,
      latestDownloads,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Resend invite / fresh login credentials to a franchise partner (admin only)
const resendFranchiseInvite = async (req, res) => {
  try {
    const result = await loadFranchisePartner(req.params.id);
    if (result.status) {
      return res.status(result.status).json({ message: result.message });
    }
    const { franchise, user } = result;

    if (!user.isActive || !franchise.isActive) {
      return res.status(400).json({
        message: "Franchise is inactive. Activate the franchise before sending credentials.",
      });
    }

    if (
      user.credentialsSentAt &&
      Date.now() - new Date(user.credentialsSentAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({
        message: "Credentials were just sent. Please wait a minute before resending.",
      });
    }

    const outcome = await issueFranchiseCredentials(user, franchise);
    if (!outcome.sent) {
      return res.status(502).json({
        message: `Email could not be sent to ${user.email}. Password was not changed.`,
        error: outcome.error,
      });
    }

    return res.json({
      message: `Login credentials sent to ${user.email}`,
      sentTo: user.email,
      credentialsSentAt: user.credentialsSentAt,
      credentialsSentCount: user.credentialsSentCount,
    });
  } catch (error) {
    console.error("Resend franchise invite error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Change a franchise partner's login email (User + Franchise kept in sync) (admin only)
const changeFranchiseEmail = async (req, res) => {
  try {
    const rawEmail = typeof req.body.newEmail === "string" ? req.body.newEmail : "";
    const newEmail = rawEmail.trim().toLowerCase();
    const sendCredentials = req.body.sendCredentials !== false;

    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address" });
    }

    const result = await loadFranchisePartner(req.params.id);
    if (result.status) {
      return res.status(result.status).json({ message: result.message });
    }
    const { franchise, user } = result;

    const oldEmail = (user.email || "").toLowerCase();
    if (newEmail === oldEmail) {
      return res.status(400).json({ message: "New email is the same as the current email" });
    }

    const takenByOther = await User.findOne({
      email: newEmail,
      isDeleted: { $ne: true },
      _id: { $ne: user._id },
    });
    if (takenByOther) {
      return res.status(409).json({ message: "Email already in use by another account" });
    }

    await releaseEmailFromDeletedUsers(newEmail, user._id);

    // Update User first; unique index catches a concurrent claim of the same email
    user.email = newEmail;
    try {
      await user.save();
    } catch (saveError) {
      if (saveError.code === 11000) {
        return res.status(409).json({ message: "Email already in use by another account" });
      }
      throw saveError;
    }

    const oldFranchiseEmail = franchise.email;
    franchise.email = newEmail;
    franchise.emailChangeHistory.push({
      oldEmail: oldFranchiseEmail || oldEmail,
      newEmail,
      changedBy: req.user._id,
      changedAt: new Date(),
    });
    try {
      await franchise.save();
    } catch (franchiseError) {
      // Roll back the login email so User and Franchise don't drift apart
      await User.updateOne({ _id: user._id }, { $set: { email: oldEmail } });
      throw franchiseError;
    }

    let credentialsSent = false;
    let warning;
    if (sendCredentials) {
      if (!user.isActive || !franchise.isActive) {
        warning = "Email updated, but credentials were not sent because the franchise is inactive.";
      } else {
        const outcome = await issueFranchiseCredentials(user, franchise);
        credentialsSent = outcome.sent;
        if (!outcome.sent) {
          warning = `Email updated, but credentials could not be sent to ${newEmail}. Use "Resend invite" to try again.`;
        }
      }
    }

    // Keep Google Sheets registration data in sync (non-blocking for the response)
    try {
      const initialized = await googleSheetsService.initialize();
      if (initialized) await googleSheetsService.syncRegistrationData();
    } catch (syncError) {
      console.error("Google sheet sync after email change failed:", syncError);
    }

    return res.json({
      message: credentialsSent
        ? `Email changed and login credentials sent to ${newEmail}`
        : "Email changed successfully",
      emailChanged: true,
      credentialsSent,
      warning,
      email: newEmail,
    });
  } catch (error) {
    console.error("Change franchise email error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  resendFranchiseInvite,
  changeFranchiseEmail,
  getDashboardStats,
  getRecentActivities,
  getAllUsers,
  getUserById,
  updateUser,
  createLead,
  getAllLeads,
  getLeadById,
  updateLead,
  deleteLead,
  getAllTransactions,
  getTransactionById,
  getAllPayouts,
  updatePayout,
  getAllReferrals,
  getReferralSettings,
  updateReferralSettings,
  getAllCreditReportsAdmin,
  getSettings,
  updateSetting,
  getAllFranchisesWithCredits,
  rechargeFranchiseCredits,
  getCreditRechargeHistory,
  calculateFranchisePayouts,
  getFranchisePayouts,
  bulkUploadLeads,
  csvUpload,
  createFranchiseUser,
  approveRegistration,
  rejectRegistration,
  deleteFranchise,
  restoreFranchise,
  updateFranchiseCertificateName,
  getPerformanceOverview,
  getDownloadStats,
};
