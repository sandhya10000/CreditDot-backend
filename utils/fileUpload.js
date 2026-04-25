const multer = require('multer');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');

// Configure AWS S3
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// File filter for documents - allow images, PDFs, CSV files, and HTML files
const fileFilter = (req, file, cb) => {
  // Accept images, PDFs, CSV files, and HTML files
  if (!file.originalname.match(/\.(jpg|jpeg|png|pdf|csv|html|htm)$/)) {
    return cb(new Error('Only image, PDF, CSV, and HTML files are allowed!'), false);
  }
  cb(null, true);
};

// File filter specifically for blog images - allow only image files
const blogImageFilter = (req, file, cb) => {
  // Accept only image files for blog images (case-insensitive)
  if (!file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/)) {
    return cb(new Error('Only image files are allowed for blog images!'), false);
  }
  cb(null, true);
};

const path = require('path');

// Storage configuration for local development 
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/'));
  },
  filename: (req, file, cb) => {
    // Replace spaces and special characters in filenames to prevent URL issues
    const cleanFilename = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, Date.now() + '-' + cleanFilename);
  },
});

// Storage configuration for blog images in Backend/uploads folder
const blogImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/')); // Save in Backend/uploads folder
  },
  filename: (req, file, cb) => {
    // Replace spaces and special characters in filenames to prevent URL issues
    const cleanFilename = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, Date.now() + '-' + cleanFilename);
  },
});

// Storage configuration for S3
const s3Storage = multerS3({
  s3: s3,
  bucket: process.env.AWS_S3_BUCKET_NAME,
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (req, file, cb) => {
    cb(null, `kyc-documents/${Date.now()}-${file.originalname}`);
  },
});

// Choose storage based on environment
const storage = process.env.NODE_ENV === 'production' ? s3Storage : localStorage;

// Multer upload configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Multer upload configuration for blog images
const uploadBlogImage = multer({
  storage: blogImageStorage,
  fileFilter: blogImageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Virus scan placeholder function
const virusScan = async (file) => {
  // In a real implementation, you would integrate with a virus scanning service
  // For now, we'll just return true to simulate a successful scan
  console.log(`Virus scan placeholder for file: ${file.originalname}`);
  return true;
};

module.exports = {
  upload,
  uploadBlogImage,
  virusScan,
};