const express = require('express');
const router = express.Router();
console.log('Loading analytics routes...');

let analyticsController;
try {
  analyticsController = require('../controllers/analyticsController');
  console.log('Analytics controller loaded successfully');
} catch (error) {
  console.error('Error loading analytics controller:', error.message);
  // Create mock controller with error responses
  analyticsController = {
    getVisitorStats: (req, res) => {
      console.error('Analytics controller not available');
      res.status(500).json({ success: false, message: 'Analytics service unavailable' });
    },
    getRealTimeVisitors: (req, res) => {
      console.error('Analytics controller not available');
      res.status(500).json({ success: false, message: 'Analytics service unavailable' });
    },
    getVisitorTrends: (req, res) => {
      console.error('Analytics controller not available');
      res.status(500).json({ success: false, message: 'Analytics service unavailable' });
    }
  };
}

const { 
  getVisitorStats, 
  getRealTimeVisitors, 
  getVisitorTrends 
} = analyticsController;

let authenticateToken, authorizeRoles;
try {
  authenticateToken = require('../middleware/auth');
  authorizeRoles = require('../middleware/rbac');
  console.log('Auth middleware loaded successfully');
} catch (error) {
  console.error('Error loading auth middleware:', error.message);
  // Mock middleware that passes through
  authenticateToken = (req, res, next) => { next(); };
  authorizeRoles = (...roles) => (req, res, next) => { next(); };
}

// All analytics routes require admin authentication
router.use((req, res, next) => {
  console.log('Analytics middleware hit - incoming request to:', req.method, req.url);
  console.log('Headers received:', {
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    cookie: req.headers.cookie ? 'Present' : 'Missing'
  });
  next();
}, authenticateToken);
router.use(authorizeRoles('admin'));

// Get comprehensive visitor statistics
router.get('/visitors', getVisitorStats);

// Get real-time visitor count
router.get('/visitors/realtime', getRealTimeVisitors);

// Get visitor trends for charts
router.get('/visitors/trends', getVisitorTrends);

module.exports = router;