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
  } catch (error) {
    console.error("Surepass API Error:", error?.response?.data);

    return res.status(500).json({
      success: false,
      message: "Prefill API failed",
      error: error?.response?.data || error.message,
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
    const failedReports = await prefillFailedLog
      .find()
      .populate("franchiseId", "name")
      .populate("userId", "name")
      .sort({ createdAt: -1 });
    console.log(failedReports);
    res.status(200).json({
      success: true,
      data: failedReports,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = { getPrefillFailedLog, savePrefillFailure, prefillByMobile };
