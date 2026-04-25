const Lead = require('../models/Lead');
const User = require('../models/User');
const Franchise = require('../models/Franchise');
const { 
  sendLeadAssignmentEmail, 
  sendLeadApprovalEmail, 
  sendLeadRejectionEmail 
} = require('../utils/emailService');

// Get leads assigned to the franchise user
const getFranchiseLeads = async (req, res) => {
  try {
    // Check if user has franchiseId
    if (!req.user.franchiseId) {
      return res.status(400).json({ message: 'User is not associated with a franchise' });
    }
    
    const leads = await Lead.find({ franchiseId: req.user.franchiseId })
      .populate('franchiseId', 'businessName')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });
    
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update lead status by franchise user
const updateLeadStatus = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { status, notes, rejectionReason } = req.body;
    
    // Validate status
    const validStatuses = ['new', 'contacted', 'qualified', 'lost', 'converted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    // Find the lead and ensure it belongs to the franchise user
    const lead = await Lead.findOne({ 
      _id: leadId, 
      franchiseId: req.user.franchiseId 
    }).populate('franchiseId');
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found or access denied' });
    }
    
    // Update lead status
    lead.status = status;
    
    // Add notes if provided
    if (notes) {
      lead.notes.push({
        note: notes,
        createdBy: req.user._id,
        createdAt: new Date()
      });
    }
    
    await lead.save();
    
    // Populate references for response
    await lead.populate('franchiseId', 'businessName');
    await lead.populate('assignedTo', 'name');
    
    // Send email notification to admin if lead is qualified or lost
    if (status === 'qualified' || status === 'lost') {
      try {
        // Get admin users
        const adminUsers = await User.find({ role: 'admin' });
        
        // Get franchise user details
        const franchiseUser = await User.findById(req.user._id);
        const franchise = await Franchise.findById(req.user.franchiseId);
        franchiseUser.franchise = franchise;
        
        // Send email to all admins
        for (const adminUser of adminUsers) {
          if (status === 'qualified') {
            await sendLeadApprovalEmail(adminUser, lead, franchiseUser);
          } else if (status === 'lost' && rejectionReason) {
            await sendLeadRejectionEmail(adminUser, lead, franchiseUser, rejectionReason);
          }
        }
      } catch (emailError) {
        console.error('Failed to send lead status email:', emailError);
        // Don't fail the request if email sending fails
      }
    }
    
    res.json({
      message: 'Lead status updated successfully',
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getFranchiseLeads,
  updateLeadStatus,
};