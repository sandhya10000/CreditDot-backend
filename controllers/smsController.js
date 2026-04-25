const axios = require('axios');

// Generate a random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Temporary in-memory storage for OTPs (in production, use Redis or database)
let otpStore = {};

// Clean up expired OTPs periodically
setInterval(() => {
  const now = Date.now();
  for (const key in otpStore) {
    if (now - otpStore[key].timestamp > 10 * 60 * 1000) { // 10 minutes
      delete otpStore[key];
    }
  }
}, 60 * 1000); // Clean up every minute

// Send OTP via Amaze SMS API
exports.sendOTP = async (req, res) => {
  try {
    const { mobile, purpose } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required'
      });
    }

    // Validate mobile number format (10 digits)
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format'
      });
    }

    // Generate OTP
    const otp = generateOTP();

    // Store OTP in both session and in-memory store as fallback
    if (req.session) {
      req.session.smsOtp = otp;
      req.session.mobile = mobile;
      req.session.purpose = purpose || 'verification';
    }
    
    // Also store in in-memory store as fallback
    otpStore[mobile] = {
      otp: otp,
      purpose: purpose || 'verification',
      timestamp: Date.now()
    };

    // Prepare SMS data for Amaze SMS API
    const smsData = {
      key: process.env.AMAZE_SMS_API_KEY,
      from: process.env.AMAZE_SMS_SENDER_ID,
      to: mobile,
      body: `Your OTP for Credit Dost login is ${otp}. Do not share it with anyone.`,
      templateid: process.env.AMAZE_SMS_DLT_TEMPLATE_ID, // This might not be set in env
      entityid: process.env.AMAZE_SMS_ENTITY_ID || '1001199386649404058' // Default entity ID
    };

    // Make API call to Amaze SMS
    const response = await axios.get('https://api.amazesms.com/api/sms', {
      params: smsData
    });

    console.log('SMS API Response:', response.data);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        mobile: mobile,
        purpose: purpose || 'verification'
      }
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.'
    });
  }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and OTP are required'
      });
    }

    // Check both session and in-memory store for OTP
    let otpMatch = false;
    
    // Check session first (if available)
    if (req.session && req.session.smsOtp && req.session.mobile === mobile) {
      if (req.session.smsOtp === otp) {
        otpMatch = true;
        // Clear the OTP from session after successful verification
        delete req.session.smsOtp;
        delete req.session.mobile;
        delete req.session.purpose;
      }
    }
    
    // If session check didn't match, check in-memory store
    if (!otpMatch && otpStore[mobile]) {
      // Check if OTP matches and hasn't expired (10 minutes)
      if (otpStore[mobile].otp === otp && 
          Date.now() - otpStore[mobile].timestamp <= 10 * 60 * 1000) {
        otpMatch = true;
        // Remove the OTP from store after successful verification
        delete otpStore[mobile];
      }
    }

    if (otpMatch) {
      res.status(200).json({
        success: true,
        message: 'OTP verified successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid OTP or OTP expired'
      });
    }
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.'
    });
  }
};

// Resend OTP
exports.resendOTP = async (req, res) => {
  try {
    const { mobile, purpose } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required'
      });
    }

    // Generate new OTP
    const otp = generateOTP();

    // Update both session and in-memory store with new OTP
    if (req.session) {
      req.session.smsOtp = otp;
      req.session.mobile = mobile;
      req.session.purpose = purpose || 'verification';
    }
    
    // Also update in-memory store as fallback
    otpStore[mobile] = {
      otp: otp,
      purpose: purpose || 'verification',
      timestamp: Date.now()
    };

    // Prepare SMS data for Amaze SMS API
    const smsData = {
      key: process.env.AMAZE_SMS_API_KEY,
      from: process.env.AMAZE_SMS_SENDER_ID,
      to: mobile,
      body: `Your OTP for Credit Dost ${purpose || 'verification'} is ${otp}. Do not share it with anyone.`,
      templateid: process.env.AMAZE_SMS_DLT_TEMPLATE_ID, // This might not be set in env
      entityid: process.env.AMAZE_SMS_ENTITY_ID || '1001199386649404058' // Default entity ID
    };

    // Make API call to Amaze SMS
    const response = await axios.get('https://api.amazesms.com/api/sms', {
      params: smsData
    });

    console.log('Resend SMS API Response:', response.data);

    res.status(200).json({
      success: true,
      message: 'OTP resent successfully',
      data: {
        mobile: mobile,
        purpose: purpose || 'verification'
      }
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.'
    });
  }
};