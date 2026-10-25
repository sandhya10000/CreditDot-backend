const fs = require("fs");
const path = require("path");
const multer = require("multer");

// Saved inside the backend's uploads folder; server.js serves that folder at /uploads
const UPLOAD_DIR = path.join(__dirname, "../uploads/support-tickets");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG or PDF attachments are allowed"));
    }
    cb(null, true);
  },
});

// Wraps multer so upload errors come back as 400 JSON instead of a 500
const attachments = (req, res, next) =>
  upload.array("attachments", MAX_FILES)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });

module.exports = attachments;
