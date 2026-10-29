const crypto = require("crypto");

// 10-char random hex password (always meets the 6-char schema minimum)
const generateTempPassword = () => crypto.randomBytes(5).toString("hex");

module.exports = { generateTempPassword };
