const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Temporary landing folder for bank statements.
const BSA_TMP_DIR = path.join(__dirname, '..', 'uploads', 'bsa-tmp');
fs.mkdirSync(BSA_TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BSA_TMP_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}.pdf`);
  },
});

function fileFilter(req, file, cb) {
  const isPdf = path.extname(file.originalname).toLowerCase() === '.pdf' && file.mimetype === 'application/pdf';
  if (!isPdf) {
    return cb(new Error('Please upload the bank statement as a PDF file.'));
  }
  cb(null, true);
}

const uploadBankStatement = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

module.exports = { uploadBankStatement, BSA_TMP_DIR };
