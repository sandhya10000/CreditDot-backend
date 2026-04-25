const RelationshipManager = require('../models/RelationshipManager');
const User = require('../models/User');

// Create a new Relationship Manager
const createRelationshipManager = async (req, res) => {
  try {
    const { name, email, phone, assignedUsers } = req.body;

    // Check if RM already exists
    const existingRM = await RelationshipManager.findOne({ email });
    if (existingRM) {
      return res.status(400).json({ message: 'Relationship Manager already exists with this email' });
    }

    // Create new RM
    const relationshipManager = new RelationshipManager({
      name,
      email,
      phone,
      assignedUsers: assignedUsers || []
    });

    await relationshipManager.save();

    // If users were assigned, update their records
    if (assignedUsers && assignedUsers.length > 0) {
      await User.updateMany(
        { _id: { $in: assignedUsers } },
        { relationshipManager: relationshipManager._id }
      );
    }

    res.status(201).json({
      message: 'Relationship Manager created successfully',
      relationshipManager,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all Relationship Managers
const getAllRelationshipManagers = async (req, res) => {
  try {
    const relationshipManagers = await RelationshipManager.find()
      .populate('assignedUsers', 'name email phone')
      .sort({ createdAt: -1 });
    
    res.json(relationshipManagers);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Relationship Manager by ID
const getRelationshipManagerById = async (req, res) => {
  try {
    const relationshipManager = await RelationshipManager.findById(req.params.id)
      .populate('assignedUsers', 'name email phone');
    
    if (!relationshipManager) {
      return res.status(404).json({ message: 'Relationship Manager not found' });
    }
    
    res.json(relationshipManager);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update Relationship Manager
const updateRelationshipManager = async (req, res) => {
  try {
    const { name, email, phone, assignedUsers, isActive } = req.body;
    
    // Check if RM exists
    const relationshipManager = await RelationshipManager.findById(req.params.id);
    if (!relationshipManager) {
      return res.status(404).json({ message: 'Relationship Manager not found' });
    }
    
    // Check if email is being changed and if it already exists
    if (email && email !== relationshipManager.email) {
      const existingRM = await RelationshipManager.findOne({ email });
      if (existingRM) {
        return res.status(400).json({ message: 'Another Relationship Manager already exists with this email' });
      }
    }
    
    // Update RM details
    relationshipManager.name = name || relationshipManager.name;
    relationshipManager.email = email || relationshipManager.email;
    relationshipManager.phone = phone || relationshipManager.phone;
    relationshipManager.isActive = isActive !== undefined ? isActive : relationshipManager.isActive;
    
    // Handle user assignments
    if (assignedUsers) {
      // Remove RM assignment from previously assigned users
      await User.updateMany(
        { relationshipManager: relationshipManager._id },
        { $unset: { relationshipManager: "" } }
      );
      
      // Assign RM to new users
      if (assignedUsers.length > 0) {
        await User.updateMany(
          { _id: { $in: assignedUsers } },
          { relationshipManager: relationshipManager._id }
        );
      }
      
      relationshipManager.assignedUsers = assignedUsers;
    }
    
    await relationshipManager.save();
    
    // Populate assigned users for response
    await relationshipManager.populate('assignedUsers', 'name email phone');
    
    res.json({
      message: 'Relationship Manager updated successfully',
      relationshipManager,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete Relationship Manager
const deleteRelationshipManager = async (req, res) => {
  try {
    const relationshipManager = await RelationshipManager.findById(req.params.id);
    
    if (!relationshipManager) {
      return res.status(404).json({ message: 'Relationship Manager not found' });
    }
    
    // Remove RM assignment from all assigned users
    await User.updateMany(
      { relationshipManager: relationshipManager._id },
      { $unset: { relationshipManager: "" } }
    );
    
    await RelationshipManager.findByIdAndDelete(req.params.id);
    
    res.json({
      message: 'Relationship Manager deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get assigned RM for a user
const getUserRelationshipManager = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('relationshipManager', 'name email phone');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (!user.relationshipManager) {
      return res.status(404).json({ message: 'No Relationship Manager assigned' });
    }
    
    res.json(user.relationshipManager);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createRelationshipManager,
  getAllRelationshipManagers,
  getRelationshipManagerById,
  updateRelationshipManager,
  deleteRelationshipManager,
  getUserRelationshipManager,
};