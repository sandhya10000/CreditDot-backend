const express = require('express');
const {
  createRelationshipManager,
  getAllRelationshipManagers,
  getRelationshipManagerById,
  updateRelationshipManager,
  deleteRelationshipManager,
  getUserRelationshipManager,
} = require('../controllers/relationshipManagerController');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

// @route   POST /api/relationship-managers
// @desc    Create new Relationship Manager (Admin only)
// @access  Private/Admin
router.post('/', auth, rbac('admin'), createRelationshipManager);

// @route   GET /api/relationship-managers
// @desc    Get all Relationship Managers (Admin only)
// @access  Private/Admin
router.get('/', auth, rbac('admin'), getAllRelationshipManagers);

// @route   GET /api/relationship-managers/:id
// @desc    Get Relationship Manager by ID (Admin only)
// @access  Private/Admin
router.get('/:id', auth, rbac('admin'), getRelationshipManagerById);

// @route   PUT /api/relationship-managers/:id
// @desc    Update Relationship Manager (Admin only)
// @access  Private/Admin
router.put('/:id', auth, rbac('admin'), updateRelationshipManager);

// @route   DELETE /api/relationship-managers/:id
// @desc    Delete Relationship Manager (Admin only)
// @access  Private/Admin
router.delete('/:id', auth, rbac('admin'), deleteRelationshipManager);

// @route   GET /api/relationship-managers/user/rm
// @desc    Get assigned Relationship Manager for current user
// @access  Private/User
router.get('/user/rm', auth, getUserRelationshipManager);

module.exports = router;