const express = require('express');
const router = express.Router();
const { 
  createDigitalAgreement,
  getDigitalAgreement,
  downloadGeneratedPdf,
  submitSignedPdf,
  getAllDigitalAgreements,
  getDigitalAgreementById,   
  approveDigitalAgreement,
  rejectDigitalAgreement,
  downloadSignedPdf,
  initiateEsign,
  eSignWebhook
} = require('../controllers/digitalAgreementController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

// Franchise user routes
router.route('/')
  .post(auth, rbac('franchise_user'), createDigitalAgreement)
  .get(auth, rbac('franchise_user'), getDigitalAgreement);

router.route('/download')
  .get(auth, rbac('franchise_user'), downloadGeneratedPdf);

router.route('/submit')
  .post(auth, rbac('franchise_user'), submitSignedPdf);

router.route('/esign/initiate')
  .post(auth, rbac('franchise_user'), initiateEsign);

// Public webhook route (no authentication)
router.route('/webhook')
  .post(eSignWebhook);

// Admin routes
router.route('/admin')
  .get(auth, rbac('admin'), getAllDigitalAgreements);

router.route('/admin/:id')
  .get(auth, rbac('admin'), getDigitalAgreementById);

router.route('/admin/:id/approve')
  .put(auth, rbac('admin'), approveDigitalAgreement);
 
router.route('/admin/:id/reject')
  .put(auth, rbac('admin'), rejectDigitalAgreement);

router.route('/admin/:id/download')
  .get(auth, rbac('admin'), downloadSignedPdf);

module.exports = router;