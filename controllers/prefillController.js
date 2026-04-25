const axios = require("axios");

exports.prefillByMobile = async (req, res) => {
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
