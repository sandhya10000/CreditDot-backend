const express = require('express');
const router = express.Router();
const {
  submitCreditRepairForm,
  submitContactForm,
  submitFranchiseOpportunityForm,
  submitBusinessForm,
  submitSuvidhaCentreApplicationForm
} = require('../controllers/formController');

// Credit repair form submission
router.route('/credit-repair')
  .post(submitCreditRepairForm);

// Contact form submission
router.route('/contact')
  .post(submitContactForm);

// Franchise opportunity form submission
router.route('/franchise-opportunity')
  .post(submitFranchiseOpportunityForm);

// Business form submission (apply for loan)
router.route('/business')
  .post(submitBusinessForm);

// Suvidha Centre application form submission
router.route('/suvidha-centre')
  .post(submitSuvidhaCentreApplicationForm);

module.exports = router;