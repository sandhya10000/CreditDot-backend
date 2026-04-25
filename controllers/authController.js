const User = require("../models/User");
const Franchise = require("../models/Franchise");
const Referral = require("../models/Referral");
const { generateToken } = require("../config/jwt");
const Joi = require("joi");
const {
  sendRegistrationEmail,
  sendAdminNotificationEmail,
  sendSelfRegistrationEmail,
  sendAccountCredentialsEmail,
  sendPasswordResetEmail,
} = require("../utils/emailService");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const googleSheetsService = require("../utils/googleSheetsService");

// Registration validation schema
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  state: Joi.string().required(),
  pincode: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required(),
  language: Joi.string().required(),
  password: Joi.string().min(6).required(),
  referralId: Joi.string().hex().length(24).optional(), // Validate as MongoDB ObjectId
});

// Login validation schema
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// Register a new franchise user
const register = async (req, res) => {
  try {
    // Validate request body
    const { error } = registerSchema.validate(req.body);
    if (error) {
      console.log("Validation error:", error.details); // Debug log
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const {
      name,
      email,
      phone,
      state,
      pincode,
      language,
      password,
      referralId,
    } = req.body; 

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User already exists with this email" });
    }

    // Create user with a temporary password if not provided
    const user = new User({
      name,
      email,
      phone,
      state,
      pincode,
      language,
      password: password || "temp_password", // Use provided password or temp password
      role: "franchise_user",
    });

    await user.save();

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncRegistrationData();
    } catch (syncError) {
      console.error(
        "Failed to sync registration data with Google Sheets:",
        syncError
      );
    }

    // Create franchise record
    const franchise = new Franchise({
      userId: user._id,
      businessName: name, // Use user's name as business name initially
      ownerName: name,
      email,
      phone,
    });

    await franchise.save();

    // Deactivate user and franchise until admin approves the registration
    user.isActive = false;
    franchise.isActive = false;
    await user.save();
    await franchise.save();

    // Check if this user was referred by someone using the referral ID from the frontend
    let referral = null;
    if (referralId) {
      // Find referral by ID and update it
      referral = await Referral.findById(referralId);
      if (referral && referral.referredEmail === email) {
        // Update referral status to registered
        referral.referredFranchiseId = franchise._id;
        referral.status = "registered";
        await referral.save();
      }
    } else {
      // Check if this user was referred by someone using email matching
      referral = await Referral.findOne({
        referredEmail: email,
        status: "pending",
      });
      if (referral) {
        // Update referral status to registered
        referral.referredFranchiseId = franchise._id;
        referral.status = "registered";
        await referral.save();
      }
    }

    // Send registration email to user
    try {
      await sendSelfRegistrationEmail(user, franchise);
    } catch (emailError) {
      console.error("Failed to send registration email to user:", emailError);
      // Don't fail the registration if email sending fails
    }

    // Send notification email to admin
    try {
      await sendAdminNotificationEmail(user);
    } catch (emailError) {
      console.error(
        "Failed to send registration notification to admin:",
        emailError
      );
      // Don't fail the registration if email sending fails
    }

    // If this user was referred, send a confirmation email to the referrer
    if (referral) {
      try {
        // We could implement this if needed, but for now we'll just log it
        console.log(
          `User ${email} registered through referral ${referral._id}`
        );
      } catch (emailError) {
        console.error(
          "Failed to send referral confirmation email:",
          emailError
        );
      }
    }

    // Generate token
    const token = generateToken({ id: user._id, role: user.role });

    // Set cookie
    const cookieOptions = {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    };

    res
      .status(201)
      .cookie("token", token, cookieOptions)
      .json({
        message:
          "User registered successfully. Please await admin approval. You will receive login credentials via email.",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
  } catch (error) {
    console.error("Registration error:", error); // Log the actual error
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Login user
const login = async (req, res) => {
  try {
    console.log("Login request body:", req.body); // Debug log

    // Validate request body
    const { error } = loginSchema.validate(req.body);
    if (error) {
      console.log("Validation error:", error.details); // Debug log
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const { email, password } = req.body;
    console.log("Login attempt for email:", email); // Debug log

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      console.log("User not found for email:", email); // Debug log
      return res.status(400).json({ message: "Invalid credentials" });
    }

    console.log("User found:", user.email);
    console.log("Stored password hash:", user.password);

    // Check if password is correct
    const isMatch = await user.comparePassword(password);
    console.log("Password match result:", isMatch);

    if (!isMatch) {
      console.log("Invalid password for user:", email); // Debug log
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log("User account deactivated:", email); // Debug log
      return res.status(400).json({ message: "Account is deactivated" });
    }

    // Generate token
    const token = generateToken({ id: user._id, role: user.role });

    // Set cookie
    const cookieOptions = {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    };

    res.cookie("token", token, cookieOptions).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error); // Debug log
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Logout user
const logout = async (req, res) => {
  res
    .cookie("token", "none", {
      expires: new Date(Date.now() + 10 * 1000), // 10 seconds
      httpOnly: true,
    })
    .json({ message: "User logged out successfully" });
};

// Forgot password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a temporary password
    const tempPassword = Math.random().toString(36).slice(-8);

    // Update user with the new password (will be hashed by pre-save hook)
    user.password = tempPassword;
    await user.save();

    // Send password reset email
    try {
      await sendAccountCredentialsEmail(user, tempPassword);
      res.json({
        message:
          "Password reset successful. Please check your email for the new password.",
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
      res.status(500).json({ message: "Failed to send password reset email" });
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Request password reset
const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Set token expiration (1 hour)
    const resetExpires = Date.now() + 3600000; // 1 hour

    // Save token and expiration to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    // Send password reset email
    try {
      await sendPasswordResetEmail(user, resetToken);
      res.json({
        message: "Password reset link sent to your email. Please check your inbox.",
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
      res.status(500).json({ message: "Failed to send password reset email" });
    }
  } catch (error) {
    console.error("Request password reset error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reset password with token
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Find user with this token and check if it's not expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Password reset token is invalid or has expired" });
    }

    // Set new password
    user.password = password;
    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({
      message: "Password has been reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  forgotPassword,
  requestPasswordReset,
  resetPassword,
};
