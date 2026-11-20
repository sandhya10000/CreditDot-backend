const express = require('express');
const auth = require('../middleware/auth');
const { uploadBankStatement } = require('../config/bsaUploadConfig');
const bsaController = require('../controllers/bsaController');

const router = express.Router();

const withUpload = (req, res, next) => {
  uploadBankStatement.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
    }
    next();
  });
};

// Routes
router.post('/analyze', auth, withUpload, bsaController.analyze);
router.get('/my-analyses', auth, bsaController.getMyAnalyses);
router.get('/:id/report', auth, bsaController.downloadReport);
router.get('/:id', auth, bsaController.getStatus);

module.exports = router;
