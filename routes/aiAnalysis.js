const express = require('express');
const {
  uploadDocument,
  getAllDocuments,
  getDocumentById,
  respondToDocument,
  getFranchiseDocuments,
  analyzeWithClaude,
  downloadClaudeAnalysis
} = require('../controllers/aiAnalysisController');
const { 
  getAIAnalysisSettings, 
  updateAIAnalysisPrompt 
} = require('../controllers/aiAnalysisSettingsController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   POST /api/ai-analysis/upload
// @desc    Upload PDF document for AI analysis
// @access  Private/Franchise User
router.post('/upload', auth, rbac('franchise_user'), uploadDocument);

// @route   GET /api/ai-analysis/franchise/documents
// @desc    Get all documents for current franchise
// @access  Private/Franchise User
router.get('/franchise/documents', auth, rbac('franchise_user'), getFranchiseDocuments);

// @route   GET /api/ai-analysis/admin/documents
// @desc    Get all documents (admin only)
// @access  Private/Admin
router.get('/admin/documents', auth, rbac('admin'), getAllDocuments);

// @route   GET /api/ai-analysis/admin/documents/:id
// @desc    Get document by ID (admin only)
// @access  Private/Admin
router.get('/admin/documents/:id', auth, rbac('admin'), getDocumentById);

// @route   POST /api/ai-analysis/admin/respond/:id
// @desc    Respond to document with updated PDF (admin only)
// @access  Private/Admin
router.post('/admin/respond/:id', auth, rbac('admin'), respondToDocument);

// @route   POST /api/ai-analysis/franchise/analyze/:id
// @desc    Manually trigger AI analysis on uploaded document
// @access  Private/Franchise User
router.post('/franchise/analyze/:id', auth, rbac('franchise_user'), analyzeWithClaude);

// @route   GET /api/ai-analysis/franchise/download-analysis/:id
// @desc    Download Claude AI analysis HTML report
// @access  Private/Franchise User
router.get('/franchise/download-analysis/:id', auth, rbac('franchise_user'), downloadClaudeAnalysis);

// @route   GET /api/ai-analysis/admin/download-analysis/:id
// @desc    Download Claude AI analysis HTML report (Admin)
// @access  Private/Admin
router.get('/admin/download-analysis/:id', auth, rbac('admin'), downloadClaudeAnalysis);

// @route   GET /api/ai-analysis/admin/settings
// @desc    Get AI analysis settings (prompt, model)
// @access  Private/Admin
router.get('/admin/settings', auth, rbac('admin'), getAIAnalysisSettings);

// @route   PUT /api/ai-analysis/admin/settings
// @desc    Update AI analysis settings
// @access  Private/Admin
router.put('/admin/settings', auth, rbac('admin'), updateAIAnalysisPrompt);

module.exports = router;