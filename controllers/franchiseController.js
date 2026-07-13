const Franchise = require("../models/Franchise");
const User = require("../models/User");
const BusinessForm = require("../models/BusinessForm");
const Package = require("../models/Package");
const Joi = require("joi");

// Validation schema for updating franchise profile
const franchiseProfileSchema = Joi.object({
  businessName: Joi.string().min(2).max(100).required(),
  ownerName: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  address: Joi.object({
    street: Joi.string().allow(""),
    city: Joi.string().allow(""),
    state: Joi.string().allow(""),
    pincode: Joi.string().allow(""),
    country: Joi.string().allow(""),
  }),
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .allow("")
    .optional(),
  bankAccountNumber: Joi.string()
    .pattern(/^\d{9,18}$/)
    .allow("")
    .optional(),
  bankIfscCode: Joi.string()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .allow("")
    .optional(),
  certificateName: Joi.string().max(100).allow("").optional(),
  credits: Joi.number().integer().min(0).optional(),
  totalCreditsPurchased: Joi.number().integer().min(0).optional(),
  kycStatus: Joi.string()
    .valid("pending", "submitted", "approved", "rejected")
    .optional(),
  isActive: Joi.boolean().optional(),
  assignedPackages: Joi.array().items(Joi.string().allow(null)).optional(),
  allPackages: Joi.object({
    assigned: Joi.array().items(
      Joi.object({
        _id: Joi.string(),
        name: Joi.string(),
        price: Joi.number(),
        creditsIncluded: Joi.number(),
      }),
    ),
  }),
});

// Validation schema for PAN details
const panDetailsSchema = Joi.object({
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .required(),
});

// Validation schema for bank details
const bankDetailsSchema = Joi.object({
  bankAccountNumber: Joi.string()
    .pattern(/^\d{9,18}$/)
    .required(),
  bankIfscCode: Joi.string()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .required(),
});

// Get franchise profile
const getFranchiseProfile = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id }).populate(
      "userId",
      "name email phone",
    );

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    res.json(franchise);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//get single franchise profile

const getSingleFranchise = async (req, res) => {
  try {
    const { franchiseCode } = req.params;

    const franchise = await Franchise.findOne({ franchiseCode: franchiseCode })
      .populate("userId", "name email phone")
      .populate("assignedPackages", "name price creditsIncluded");

    if (!franchise) {
      return res.status(404).json({
        success: false,
        message: "Franchise not found",
      });
    }

    // const businesses = await BusinessForm.find({
    //   franchiseId: franchise._id,
    // });

    return res.status(200).json({
      success: true,
      data: {
        ...franchise.toObject(),
        // businessHistory: businesses,
      },
    });
  } catch (error) {
    console.error("Get franchise error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getSingleFranchise,
};
// Update franchise profile
const updateFranchiseProfile = async (req, res) => {
  try {
    // Validate request body
    const { error } = franchiseProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Update franchise
    Object.assign(franchise, req.body);
    await franchise.save();

    res.json({
      message: "Franchise profile updated successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getFranchiseList = async (req, res) => {
  try {
    const franchises = await Franchise.find()
      .populate("userId", "name email phone")
      .populate("assignedPackages", "name price creditsIncluded")
      .sort({ createdAt: -1 })
      .lean();

    const Transaction = require("../models/Transaction");
    const enhancedFranchises = await Promise.all(
      franchises.map(async (franchise) => {
        const transactions = await Transaction.find({
          franchiseId: franchise._id,
          status: "paid",
        })
          .populate("packageId")
          .lean();

        const purchasedPackages = transactions
          .filter((transaction) => transaction.packageId)
          .map((transaction) => transaction.packageId);

        const allPackages = {
          assigned: franchise.assignedPackages || [],
          purchased: purchasedPackages,
          all: [...(franchise.assignedPackages || []), ...purchasedPackages],
        };

        return {
          ...franchise,
          allPackages: allPackages,
          packageHistory: franchise.packageHistory || [],
        };
      }),
    );

    res.json(enhancedFranchises);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all franchises (admin only)
const getAllFranchises = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search?.trim() || "";
    const kycStatus = req.query.kycStatus?.trim() || "";
    const skip = (page - 1) * limit;
    const filter = {};
    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { ownerName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }
    if (kycStatus) {
      filter.kycStatus = kycStatus;
    }

    const franchises = await Franchise.find(filter)
      .populate("userId", "name email phone")
      .populate("assignedPackages", "name price creditsIncluded")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Franchise.countDocuments(filter);

    // Enhance each franchise with purchased packages information
    const Transaction = require("../models/Transaction");
    const enhancedFranchises = await Promise.all(
      franchises.map(async (franchise) => {
        const transactions = await Transaction.find({
          franchiseId: franchise._id,
          status: "paid",
        }).populate("packageId");

        const purchasedPackages = transactions
          .filter((transaction) => transaction.packageId) // Only valid transactions with package
          .map((transaction) => transaction.packageId);

        // Combine assigned and purchased packages for the response
        const allPackages = {
          assigned: franchise.assignedPackages,
          purchased: purchasedPackages,
          all: [...franchise.assignedPackages, ...purchasedPackages],
        };

        // Return franchise data with both assigned and purchased packages
        return {
          ...franchise,
          allPackages: allPackages,
          packageHistory: franchise.packageHistory || [],
        };
      }),
    );
    return res.status(200).json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      franchises: enhancedFranchises,
    });
    // res.json(enhancedFranchises);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get franchise by ID (admin only)
const getFranchiseById = async (req, res) => {
  try {
    const franchise = await Franchise.findById(req.params.id)
      .populate("userId", "name email phone")
      .populate("assignedPackages", "name price creditsIncluded");

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Get purchased packages from transactions
    const Transaction = require("../models/Transaction");
    const Package = require("../models/Package");

    const transactions = await Transaction.find({
      franchiseId: req.params.id,
      status: "paid",
    }).populate("packageId");

    const purchasedPackages = transactions
      .filter((transaction) => transaction.packageId) // Only valid transactions with package
      .map((transaction) => transaction.packageId);

    // Combine assigned and purchased packages for the response
    const allPackages = {
      assigned: franchise.assignedPackages,
      purchased: purchasedPackages,
      all: [...franchise.assignedPackages, ...purchasedPackages],
    };

    // Include package history in the response
    const responseData = {
      ...franchise.toObject(),
      allPackages: allPackages,
      packageHistory: franchise.packageHistory || [],
    };

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update franchise (admin only)
const updateFranchise = async (req, res) => {
  try {
    // Validate request body
    const { error } = franchiseProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const franchise = await Franchise.findById(req.params.id);
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Check if assignedPackages are being updated
    if (req.body.assignedPackages && Array.isArray(req.body.assignedPackages)) {
      // Calculate credits from assigned packages
      const packageIds = req.body.assignedPackages.filter((id) => id !== null);
      if (packageIds.length > 0) {
        const packages = await Package.find({ _id: { $in: packageIds } });
        let totalCredits = 0;
        packages.forEach((pkg) => {
          totalCredits += pkg.creditsIncluded || 0;
        });

        // Update the credits in the request body
        req.body.credits = totalCredits;
        req.body.totalCreditsPurchased = totalCredits;
        // Preserve totalCreditsPurchased - it should only increase when packages are purchased, not assigned
      } else {
        // If no packages assigned, set credits to 0
        req.body.credits = 0;
      }
    }

    // Update franchise with all fields including credits if applicable
    Object.assign(franchise, req.body);
    await franchise.save();

    // Populate references for response
    await franchise.populate("userId", "name email phone");
    await franchise.populate("assignedPackages", "name price creditsIncluded");

    res.json({
      message: "Franchise updated successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Deactivate franchise (admin only)
const deactivateFranchise = async (req, res) => {
  try {
    const franchise = await Franchise.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    ).populate("userId", "name email phone");

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Also deactivate user
    await User.findByIdAndUpdate(franchise.userId, { isActive: false });

    res.json({
      message: "Franchise deactivated successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Activate franchise (admin only)
const activateFranchise = async (req, res) => {
  try {
    const franchise = await Franchise.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true },
    ).populate("userId", "name email phone");

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Also activate user
    await User.findByIdAndUpdate(franchise.userId, { isActive: true });

    res.json({
      message: "Franchise activated successfully",
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Generate certificate data for franchise
const generateCertificate = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id }).populate(
      "userId",
      "name email phone",
    );

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Generate certificate data
    // Use certificateName if set, otherwise fallback to businessName
    const certificateName = franchise.certificateName || franchise.businessName;

    const certificateData = {
      franchiseName: certificateName,
      ownerName: franchise.ownerName,
      email: franchise.email,
      certificateId: `CD-${franchise._id
        .toString()
        .substring(0, 8)
        .toUpperCase()}`,
      date: new Date().toLocaleDateString("en-IN"),
      isValid: franchise.isActive,
    };

    res.json(certificateData);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Request certificate name update
const requestCertificateNameUpdate = async (req, res) => {
  try {
    const { requestedName } = req.body;

    // Validate input
    if (!requestedName || requestedName.trim().length === 0) {
      return res.status(400).json({ message: "Certificate name is required" });
    }

    // Find franchise
    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Update the requested name field (we'll add this to the model)
    franchise.certificateName = requestedName.trim();
    await franchise.save();

    res.json({
      message: "Certificate name updated successfully",
      certificateName: franchise.certificateName,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get PAN comprehensive details
const getPanDetails = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    res.json({
      panNumber: franchise.panNumber || "",
      panDetails: franchise.panDetails || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update PAN details
const updatePanDetails = async (req, res) => {
  try {
    // Validate request body
    const { error } = panDetailsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const { panNumber } = req.body;

    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    franchise.panNumber = panNumber.toUpperCase();
    await franchise.save();

    res.json({
      message: "PAN number updated successfully",
      panNumber: franchise.panNumber,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Fetch PAN comprehensive details from Surepass
const fetchPanComprehensive = async (req, res) => {
  try {
    const { panNumber } = req.body;

    // Validate PAN format
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panNumber || !panRegex.test(panNumber)) {
      return res.status(400).json({
        message:
          "Invalid PAN number format. Please enter a valid PAN number (e.g., ABCDE1234F)",
      });
    }

    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Get Surepass API key from credit controller
    const { getSurepassApiKeyValue } = require("./creditController");
    const apiKey = await getSurepassApiKeyValue();

    if (!apiKey) {
      return res
        .status(500)
        .json({ message: "Surepass API key not configured" });
    }

    // Import the Surepass API client
    const surepassClient = require("../utils/surepassApiClient");

    // Call Surepass PAN comprehensive API with correct parameter using rate-limited client
    const response = await surepassClient.makePanVerificationRequest(
      apiKey,
      "https://kyc-api.surepass.io/api/v1/pan/pan-comprehensive",
      { id_number: panNumber.toUpperCase() },
    );

    // Check if the API response indicates success
    if (!response.data.success) {
      return res.status(400).json({
        message: "PAN verification failed",
        error:
          response.data.message || "Invalid PAN number or verification failed",
      });
    }

    // Update franchise with PAN details
    franchise.panNumber = panNumber.toUpperCase();
    franchise.panDetails = response.data;
    await franchise.save();

    res.json({
      message: "PAN details fetched successfully",
      panDetails: response.data,
    });
  } catch (error) {
    console.error("Surepass PAN comprehensive error:", error.message);
    if (error.response) {
      // Handle Surepass API errors specifically
      if (error.response.status === 400) {
        return res.status(400).json({
          message: "Invalid PAN number or verification failed",
          error:
            error.response.data.message ||
            "Please check the PAN number and try again",
        });
      }
      return res.status(error.response.status).json({
        message: "Failed to fetch PAN details",
        error: error.response.data,
      });
    }
    res.status(500).json({
      message: "An error occurred while fetching PAN details",
      error: error.message,
    });
  }
};

// Get bank details
const getBankDetails = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    res.json({
      bankAccountNumber: franchise.bankAccountNumber || "",
      bankIfscCode: franchise.bankIfscCode || "",
      bankDetails: franchise.bankDetails || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update bank details
const updateBankDetails = async (req, res) => {
  try {
    // Validate request body
    const { error } = bankDetailsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const { bankAccountNumber, bankIfscCode } = req.body;

    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    franchise.bankAccountNumber = bankAccountNumber;
    franchise.bankIfscCode = bankIfscCode.toUpperCase();
    await franchise.save();

    res.json({
      message: "Bank details updated successfully",
      bankAccountNumber: franchise.bankAccountNumber,
      bankIfscCode: franchise.bankIfscCode,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Fetch bank verification details from Surepass
const fetchBankVerification = async (req, res) => {
  try {
    const { bankAccountNumber, bankIfscCode } = req.body;

    if (!bankAccountNumber || !bankIfscCode) {
      return res
        .status(400)
        .json({ message: "Bank account number and IFSC code are required" });
    }

    // Validate bank account number (should be numeric and 9-18 digits)
    if (!/^\d{9,18}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        message:
          "Invalid bank account number. Please enter a valid account number (9-18 digits)",
      });
    }

    // Validate IFSC code format
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(bankIfscCode)) {
      return res.status(400).json({
        message:
          "Invalid IFSC code format. Please enter a valid IFSC code (e.g., SBIN0002499)",
      });
    }

    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Get Surepass API key from credit controller
    const { getSurepassApiKeyValue } = require("./creditController");
    const apiKey = await getSurepassApiKeyValue();

    if (!apiKey) {
      return res
        .status(500)
        .json({ message: "Surepass API key not configured" });
    }

    // Import the Surepass API client
    const surepassClient = require("../utils/surepassApiClient");

    // Call Surepass bank verification API with correct parameters using rate-limited client
    const response = await surepassClient.makeBankVerificationRequest(
      apiKey,
      "https://kyc-api.surepass.io/api/v1/bank-verification",
      {
        id_number: bankAccountNumber,
        ifsc: bankIfscCode.toUpperCase(),
        ifsc_details: true,
      },
    );

    // Check if the API response indicates success
    if (!response.data.success) {
      return res.status(400).json({
        message: "Bank verification failed",
        error:
          response.data.message ||
          "Invalid bank details or verification failed",
      });
    }

    // Update franchise with bank details
    franchise.bankAccountNumber = bankAccountNumber;
    franchise.bankIfscCode = bankIfscCode.toUpperCase();
    franchise.bankDetails = response.data;
    await franchise.save();

    res.json({
      message: "Bank details verified successfully",
      bankDetails: response.data,
    });
  } catch (error) {
    console.error("Surepass bank verification error:", error.message);
    if (error.response) {
      // Handle Surepass API errors specifically
      if (error.response.status === 400) {
        return res.status(400).json({
          message: "Invalid bank details or verification failed",
          error:
            error.response.data.message ||
            "Please check the bank details and try again",
        });
      }
      if (error.response.status === 404) {
        return res.status(404).json({
          message: "Bank details not found",
          error:
            error.response.data.message ||
            "Please check the bank details and try again",
        });
      }
      return res.status(error.response.status).json({
        message: "Failed to verify bank details",
        error: error.response.data,
      });
    }
    res.status(500).json({
      message: "An error occurred while verifying bank details",
      error: error.message,
    });
  }
};
const getAllFranchisesList = async (req, res) => {
  try {
    const franchises = await Franchise.find({}, " _id businessName ownerName");
    res.status(200).json({
      success: true,
      data: franchises,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Export all matching franchises as a streamed CSV file.
 * Respects the same `search` and `kycStatus` query params as the paginated list,
 * but skips pagination so ALL matching records are exported.
 * Uses a Mongoose cursor + chunked writes to avoid loading everything into memory.
 */
const exportFranchisesCSV = async (req, res) => {
  try {
    const search = req.query.search?.trim() || "";
    const kycStatus = req.query.kycStatus?.trim() || "";

    // Build the same filter used by getAllFranchises
    const filter = {};
    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { ownerName:    { $regex: search, $options: "i" } },
        { email:        { $regex: search, $options: "i" } },
        { phone:        { $regex: search, $options: "i" } },
      ];
    }
    if (kycStatus) {
      filter.kycStatus = kycStatus;
    }

    // Set streaming CSV response headers
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="franchise_export_${timestamp}.csv"`
    );
    // Flush headers immediately so the browser starts the download
    res.flushHeaders?.();

    // CSV header row
    const csvHeaders = [
      "Franchise ID",
      "Business Name",
      "Owner Name",
      "Email",
      "Phone",
      "KYC Status",
      "Status",
      "Credits",
      "Total Credits Purchased",
      "PAN Number",
      "Bank Account Number",
      "IFSC Code",
      "Certificate Name",
      "Street",
      "City",
      "State",
      "Pincode",
      "Country",
      "Created Date",
    ];

    const escapeField = (value) => {
      const str = String(value ?? "");
      // Wrap in quotes, doubling any internal quotes
      return `"${str.replace(/"/g, '""')}"`;
    };

    const formatDate = (date) => {
      if (!date) return "";
      return new Date(date).toLocaleDateString("en-IN");
    };

    // Write the header row
    res.write(csvHeaders.map(escapeField).join(",") + "\n");

    // Stream records in batches of 100 to avoid memory spikes on large datasets
    const BATCH_SIZE = 100;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await Franchise.find(filter)
        .populate("userId", "name email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      for (const f of batch) {
        const row = [
          f.franchiseCode || "",
          f.businessName || "",
          f.ownerName || "",
          f.email || "",
          f.phone || "",
          f.kycStatus || "",
          f.isActive ? "Active" : "Inactive",
          f.credits ?? 0,
          f.totalCreditsPurchased ?? 0,
          f.panNumber || "",
          f.bankAccountNumber || "",
          f.bankIfscCode || "",
          f.certificateName || "",
          f.address?.street || "",
          f.address?.city || "",
          f.address?.state || "",
          f.address?.pincode || "",
          f.address?.country || "",
          formatDate(f.createdAt),
        ];
        res.write(row.map(escapeField).join(",") + "\n");
      }

      skip += batch.length;
      // If we got fewer than the batch size, we've reached the end
      if (batch.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    res.end();
  } catch (error) {
    console.error("CSV export error:", error);
    // If headers haven't been flushed yet, send a proper error response
    if (!res.headersSent) {
      return res.status(500).json({
        message: "Failed to export CSV",
        error: error.message,
      });
    }
    // Otherwise just end the stream (partial CSV is better than a hanging connection)
    res.end();
  }
};
module.exports = {
  getFranchiseProfile,
  updateFranchiseProfile,
  getAllFranchises,
  getFranchiseList,
  getFranchiseById,
  updateFranchise,
  deactivateFranchise,
  activateFranchise,
  generateCertificate,
  requestCertificateNameUpdate,
  // PAN and Bank verification functions
  getPanDetails,
  updatePanDetails,
  fetchPanComprehensive,
  getBankDetails,
  updateBankDetails,
  fetchBankVerification,
  getAllFranchisesList,
  getSingleFranchise,
  exportFranchisesCSV,
};
