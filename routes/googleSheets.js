const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const multer = require('multer');
const {
  getSettings,
  updateSettings,
  testConnection,
  syncCreditScoreData,
  syncBusinessFormData,
  syncCreditRepairData,
  syncContactFormData,
  syncRegistrationData, 
  syncFranchiseOpportunityData,
  syncBusinessLoginData,
  syncSuvidhaCentreData,
  syncAllData
} = require('../controllers/googleSheetsController');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// All routes require admin access
router.use(protect);
router.use(rbac('admin'));

// Settings routes
router.route('/settings')
  .get(getSettings)
  .put(upload.single('credentials'), updateSettings);

// Connection test
router.route('/test-connection')
  .post(testConnection);

// Data sync routes
router.route('/sync/credit-score')
  .post(syncCreditScoreData);

router.route('/sync/business-form')
  .post(syncBusinessFormData);

router.route('/sync/business-login')
  .post(syncBusinessLoginData);

router.route('/sync/credit-repair')
  .post(syncCreditRepairData);

router.route('/sync/contact-form')
  .post(syncContactFormData);

router.route('/sync/registration')
  .post(syncRegistrationData);

router.route('/sync/franchise-opportunity')
  .post(syncFranchiseOpportunityData);

router.route('/sync/suvidha-centre')
  .post(syncSuvidhaCentreData);

router.route('/sync/all')
  .post(syncAllData);

module.exports = router;