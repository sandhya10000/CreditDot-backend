const Franchise = require('../models/Franchise');
const Lead = require('../models/Lead');
const Transaction = require('../models/Transaction');
const Package = require('../models/Package');
const CreditReport = require('../models/CreditReport');
const Referral = require('../models/Referral');
const Payout = require('../models/Payout');
const { sendReferralEmail } = require('../utils/emailService');

// Get franchise dashboard statistics
const getFranchiseDashboard = async (req, res) => {
  try {
    // Get franchise details with assigned packages
    const franchise = await Franchise.findOne({ userId: req.user.id })
      .populate('userId', 'name email phone')
      .populate('assignedPackages', 'name creditsIncluded price sortOrder');
    
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Get lead statistics
    const totalLeads = await Lead.countDocuments({ franchiseId: franchise._id });
    const newLeads = await Lead.countDocuments({ 
      franchiseId: franchise._id, 
      status: 'new' 
    });
    
    // Get credit reports count
    const totalCreditReports = await CreditReport.countDocuments({ 
      franchiseId: franchise._id 
    });
    
    // Get referrals count
    const totalReferrals = await Referral.countDocuments({ 
      referrerFranchiseId: franchise._id 
    });
    
    // Get recent transactions
    const recentTransactions = await Transaction.find({ 
      userId: req.user.id,
      status: 'paid'
    })
    .populate('packageId', 'name creditsIncluded price sortOrder')
    .sort({ createdAt: -1 })
    .limit(5);
    
    res.json({
      franchise,
      stats: {
        credits: franchise.credits,
        totalLeads,
        newLeads,
        totalCreditReports,
        totalReferrals,
      },
      recentTransactions,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get franchise leads
const getFranchiseLeads = async (req, res) => {
  try {
    const leads = await Lead.find({ franchiseId: req.user.franchiseId })
      .sort({ createdAt: -1 });
    
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create lead
const createLead = async (req, res) => {
  try {
    const lead = new Lead({
      ...req.body,
      franchiseId: req.user.franchiseId,
    });
    
    await lead.save();
    
    res.status(201).json({
      message: 'Lead created successfully',
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get lead by ID
const getFranchiseLeadById = async (req, res) => {
  try {
    const lead = await Lead.findOne({ 
      _id: req.params.id, 
      franchiseId: req.user.franchiseId 
    });
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update lead
const updateFranchiseLead = async (req, res) => {
  try {
    const lead = await Lead.findOneAndUpdate(
      { 
        _id: req.params.id, 
        franchiseId: req.user.franchiseId 
      },
      req.body,
      { new: true }
    );
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json({
      message: 'Lead updated successfully',
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get transactions for franchise
const getFranchiseTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id })
      .populate('packageId', 'name creditsIncluded price sortOrder')
      .sort({ createdAt: -1 });
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get packages for purchase
const getPackagesForPurchase = async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true })
      .sort({ sortOrder: 1 });
    
    res.json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get referrals for franchise
const getFranchiseReferrals = async (req, res) => {
  try {
    // Get franchise
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    const referrals = await Referral.find({ referrerFranchiseId: franchise._id })
      .populate('referredFranchiseId', 'businessName')
      .populate('packageId', 'name');
    
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create referral for franchise
const createReferral = async (req, res) => {
  try {
    // Get franchise
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Check if referral already exists
    const existingReferral = await Referral.findOne({ 
      referrerFranchiseId: franchise._id,
      referredEmail: req.body.email,
    });
    
    if (existingReferral) {
      return res.status(400).json({ message: 'Referral already exists for this email' });
    }
    
    // Create referral with proper field mapping
    const referral = new Referral({
      referrerFranchiseId: franchise._id,
      referredName: req.body.name,
      referredEmail: req.body.email,
      referredPhone: req.body.phone,
    });
    
    await referral.save();
    
    // Send referral email
    try {
      await sendReferralEmail(referral, franchise);
    } catch (emailError) {
      console.error('Failed to send referral email:', emailError);
      // Don't fail the request if email sending fails
    }
    
    res.status(201).json({
      message: 'Referral created successfully',
      referral,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
     
// Get payouts for franchise
const getFranchisePayouts = async (req, res) => {
  try {
    console.log('Fetching payouts for user:', req.user.id);
    // Get franchise
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      console.log('Franchise not found for user:', req.user.id);
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    console.log('Found franchise:', franchise._id);
    const payouts = await Payout.find({ franchiseId: franchise._id })
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 });
    
    console.log('Found payouts:', payouts.length);
    res.json(payouts);
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getFranchiseDashboard,
  getFranchiseLeads,
  createLead,
  getFranchiseLeadById,
  updateFranchiseLead,
  getFranchiseTransactions,
  getPackagesForPurchase,
  getFranchiseReferrals,
  createReferral,
  getFranchisePayouts,
};