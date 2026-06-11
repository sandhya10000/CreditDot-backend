const axios = require("axios");
const prefillFailedLog = require("../models/prefillFailedLog");
const prefillByMobile = async (req, res) => {
  const { mobile } = req.body;

  // 🔹 Basic validation
  if (!mobile || mobile.length !== 10) {
    return res.status(400).json({
      success: false,
      message: "Invalid mobile number",
    });
  }

  try {
    const response = await axios.post(
      "https://kyc-api.surepass.io/api/v1/prefill/prefill-by-mobile",
      {
        mobile: mobile,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SUREPASS_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    return res.status(200).json(response.data);
  } catch (apiError) {
    const status = apiError?.response?.status;

    if (apiError.code === "ETIMEDOUT" || apiError.code === "ECONNABORTED") {
      return res.status(422).json({
        message: "Request timeout",
        error: "TIMEOUT",
      });
    }

    if (status === 404) {
      return res.status(404).json({
        message: "No PAN record found",
      });
    }

    if (status === 429) {
      return res.status(429).json({
        message: "Too many requests",
      });
    }

    if (status === 401) {
      return res.status(401).json({
        message: "Invalid Surepass credentials",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Prefill API failed",
      error: apiError?.response?.data || apiError.message,
    });
  }
};
const savePrefillFailure = async (req, res) => {
  try {
    const { message, mobile, statusCode } = req.body;
    const log = new prefillFailedLog({
      message,
      mobile,
      statusCode,

      userId: req.user?.id || null,
      franchiseId: req.user?.franchiseId || null,
    });
    await log.save();
    return res.status(201).json({
      success: true,
      message: "Prefill failure saved successfully",
      data: log,
    });
  } catch (error) {
    console.error("Save Prefill Failure Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
const getPrefillFailedLog = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const failedReports = await prefillFailedLog
      .find()
      .populate("franchiseId", "name")
      .populate("userId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await prefillFailedLog.countDocuments();
    res.status(200).json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      reports: failedReports,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error,
    });
  }
};

module.exports = { getPrefillFailedLog, savePrefillFailure, prefillByMobile };
