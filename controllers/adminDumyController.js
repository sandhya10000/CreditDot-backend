// controllers/adminController.js

const User = require("../models/User");

const createDummyAdmin = async (req, res) => {
  try {
    // Check karo already admin hai ya nahi
    const existingAdmin = await User.findOne({ email: "admin@gmail.com" });

    if (existingAdmin) {
      return res.json({ message: "Admin already exists" });
    }

    // Admin create karo
    const admin = new User({
      name: "Super Admin",
      email: "admin@gmail.com",
      phone: "9999999999",
      state: "Delhi",
      pincode: "110001",
      language: "English",
      password: "admin123", // auto hash hoga (aapke schema se)
      role: "admin",
      isActive: true,
      isVerified: true,
    });

    await admin.save();

    res.json({
      message: "Dummy admin created successfully",
      email: "admin@gmail.com",
      password: "admin123",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createDummyAdmin };
