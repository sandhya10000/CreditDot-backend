const User = require('../models/User');
const Franchise = require('../models/Franchise');
const Package = require('../models/Package');
const Lead = require('../models/Lead');
const Transaction = require('../models/Transaction');
const Payout = require('../models/Payout');
const Referral = require('../models/Referral');
const CreditReport = require('../models/CreditReport');
const Setting = require('../models/Setting');
const BusinessForm = require('../models/BusinessForm');
const KycRequest = require('../models/KycRequest');
const { sendLeadAssignmentEmail, sendAccountCredentialsEmail, sendAdminNotificationEmail, sendRegistrationApprovalEmail, sendRegistrationRejectionEmail } = require('../utils/emailService');
const { updateAgreementPackageDetails } = require('./digitalAgreementController');
const googleSheetsService = require('../utils/googleSheetsService');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');

// Configure CSV file upload
const csvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, 'leads-' + Date.now() + '.csv');
    }
  }),
  fileFilter: (req, file, cb) => {
    // Accept only CSV files
    if (file.mimetype === 'text/csv' || file.originalname.match(/\.csv$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
     
// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const totalFranchises = await Franchise.countDocuments();
    const activeFranchises = await Franchise.countDocuments({ isActive: true });
    const pendingKycFranchises = await Franchise.countDocuments({ kycStatus: 'pending' });
    const totalPackages = await Package.countDocuments({ isActive: true });
    const totalLeads = await Lead.countDocuments();
    const totalTransactions = await Transaction.countDocuments({ status: 'paid' });
    
    // Calculate total revenue
    const revenueResult = await Transaction.aggregate([        
      { $match: { status: 'paid' } },   
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;
    
    // Calculate revenue from franchise packages (regular packages)
    // Need to ensure these transactions are linked to active franchises/users
    const franchisePackageRevenueResult = await Transaction.aggregate([
      { $match: { status: 'paid', packageId: { $exists: true } } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      { $match: { 'user.isActive': { $ne: false } } }, // Only count revenue from active users
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const franchisePackageRevenue = franchisePackageRevenueResult.length > 0 ? franchisePackageRevenueResult[0].total : 0;
    
    // Calculate revenue from customer packages (business forms)
    // We need to get the revenue from paid business forms that are linked to existing franchises
    const paidBusinessForms = await BusinessForm.aggregate([
      { $match: { paymentStatus: 'paid' } },
      {
        $lookup: {
          from: 'customerpackages',
          localField: 'selectedPackage',
          foreignField: '_id',
          as: 'package'
        }
      },
      { $unwind: '$package' },
      {
        $lookup: {
          from: 'franchises',
          localField: 'franchiseId',
          foreignField: '_id',
          as: 'franchise'
        }
      },
      { $unwind: '$franchise' },
      { $match: { 'franchise._id': { $exists: true } } }, // Only count revenue from existing franchises
      { $group: { _id: null, total: { $sum: '$package.price' } } }
    ]);
        
    const customerPackageRevenue = paidBusinessForms.length > 0 ? paidBusinessForms[0].total : 0;
    
    res.json({
      totalFranchises,
      activeFranchises,
      pendingKycFranchises,
      totalPackages,
      totalLeads,
      totalTransactions,
      totalRevenue,
      franchisePackageRevenue,
      customerPackageRevenue,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get recent activities for admin dashboard
const getRecentActivities = async (req, res) => {
  try {
    // Get recent user registrations
    const recentUsers = await User.find({}, 'name email createdAt')
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get recent transactions
    const recentTransactions = await Transaction.find({ status: 'paid' })
      .populate('userId', 'name')
      .populate('packageId', 'name')
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get recent KYC submissions
    const recentKyc = await Franchise.find({ kycStatus: { $in: ['submitted', 'approved', 'rejected'] } })
      .populate('userId', 'name')
      .sort({ kycSubmittedAt: -1 })
      .limit(5);
    
    // Combine and format activities
    const activities = [];
    
    recentUsers.forEach(user => {
      activities.push({
        id: user._id,
        user: user.name,
        action: 'Registered as franchise',
        time: user.createdAt,
        status: 'completed',
        type: 'registration'
      });
    });
    
    recentTransactions.forEach(transaction => {
      activities.push({
        id: transaction._id,
        user: transaction.userId?.name || 'Unknown User',
        action: `Purchased ${transaction.packageId?.name || 'package'}`,
        time: transaction.createdAt,
        status: 'completed',
        type: 'transaction'
      });
    });
    
    recentKyc.forEach(franchise => {
      activities.push({
        id: franchise._id,
        user: franchise.userId?.name || 'Unknown User',
        action: 'KYC submitted',
        time: franchise.kycSubmittedAt,
        status: franchise.kycStatus === 'approved' ? 'completed' : 
               franchise.kycStatus === 'rejected' ? 'rejected' : 'pending',
        type: 'kyc'
      });
    });
    
    // Sort by time and limit to 5 most recent
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recentActivities = activities.slice(0, 5);
    
    res.json(recentActivities);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all users (admin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get user by ID (admin only)
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update user (admin only)
const updateUser = async (req, res) => {
  try {
    const { name, email, phone, isActive } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, phone, isActive },
      { new: true, runValidators: true }
    );
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create lead (admin only)
const createLead = async (req, res) => {
  try {
    const { 
      franchiseId, 
      name, 
      email, 
      phone, 
      address, 
      creditScore,
      creditReportUrl,
      assignedTo,
      notes
    } = req.body;
    
    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({ 
        message: 'Name and phone are required' 
      });
    }
    
    // Create new lead
    const lead = new Lead({
      franchiseId: franchiseId || undefined, // Make franchiseId optional
      name,
      email: email ? email.toLowerCase() : undefined,
      phone,
      address,
      creditScore,
      creditReportUrl,
      assignedTo,
      notes: notes ? [{
        note: notes,
        createdBy: req.user.id,
        createdAt: new Date()
      }] : undefined
    });
    
    await lead.save();
    
    // Populate references
    await lead.populate('franchiseId', 'businessName');
    await lead.populate('assignedTo', 'name');
    
    res.status(201).json({
      message: 'Lead created successfully',
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all leads (admin only)
const getAllLeads = async (req, res) => {
  try {
    const leads = await Lead.find()
      .populate('franchiseId', 'businessName')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });
    
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get lead by ID (admin only)
const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('franchiseId', 'businessName')
      .populate('assignedTo', 'name');
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update lead (admin only)
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('franchiseId', 'businessName')
     .populate('assignedTo', 'name');
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    // Send email notification if franchiseId was updated (lead assigned)
    if (req.body.franchiseId) {
      try {
        // Get the franchise user
        const franchise = await Franchise.findById(req.body.franchiseId);
        if (franchise) {
          const franchiseUser = await User.findById(franchise.userId);
          if (franchiseUser) {
            // Get the admin user who made the assignment
            const adminUser = await User.findById(req.user.id);
            
            // Send assignment email
            await sendLeadAssignmentEmail(franchiseUser, lead, adminUser);
          }
        }
      } catch (emailError) {
        console.error('Failed to send lead assignment email:', emailError);
        // Don't fail the request if email sending fails
      }
    }
    
    res.json({
      message: 'Lead updated successfully',
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete lead (admin only)
const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json({
      message: 'Lead deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Bulk upload leads from CSV file (admin only)
const bulkUploadLeads = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        message: 'No CSV file uploaded' 
      });
    }

    const results = [];
    const filePath = req.file.path;
    
    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    // Validate and process leads
    const createdLeads = [];
    const errors = [];
    
    for (const [index, row] of results.entries()) {
      try {
        // Validate required fields
        if (!row.name || !row.phone) {
          errors.push(`Row ${index + 1}: Name and phone are required`);
          continue;
        }
        
        // Create lead object
        const leadData = {
          name: row.name,
          email: row.email ? row.email.toLowerCase() : undefined,
          phone: row.phone,
          address: {
            street: row.address || undefined,
            city: row.city || undefined,
            state: row.state || undefined,
            pincode: row.pincode || undefined
          },
          creditScore: row.creditScore ? parseInt(row.creditScore) : undefined,
          creditReportUrl: row.creditReportUrl || undefined,
          status: 'new' // Default status
        };
        
        // Create lead in database
        const lead = new Lead(leadData);
        await lead.save();
        
        // Populate references
        await lead.populate('franchiseId', 'businessName');
        await lead.populate('assignedTo', 'name');
        
        createdLeads.push(lead);
      } catch (error) {
        errors.push(`Row ${index + 1}: ${error.message}`);
      }
    }
    
    // Delete the uploaded file
    fs.unlinkSync(filePath);
    
    // Return response
    res.json({
      message: `${createdLeads.length} leads uploaded successfully`,
      createdLeads,
      errors,
      totalProcessed: results.length,
      successCount: createdLeads.length,
      errorCount: errors.length
    });
  } catch (error) {
    // Delete the uploaded file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      message: 'Server error during bulk upload', 
      error: error.message 
    });
  }
};

// Get all transactions (admin only)
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('userId', 'name email')
      .populate('franchiseId', 'businessName')
      .populate('packageId', 'name')
      .sort({ createdAt: -1 });
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get transaction by ID (admin only)
const getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('franchiseId', 'businessName')
      .populate('packageId', 'name');
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all payouts (admin only)
const getAllPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate('franchiseId', 'businessName ownerName')
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update payout status (admin only)
const updatePayout = async (req, res) => {
  try {
    const { status, remarks } = req.body;
    
    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      { 
        status, 
        remarks,
        processedAt: status === 'completed' ? new Date() : undefined,
        processedBy: status === 'completed' ? req.user.id : undefined,
      },
      { new: true, runValidators: true }
    ).populate('franchiseId', 'businessName ownerName')
     .populate('processedBy', 'name');
    
    if (!payout) {
      return res.status(404).json({ message: 'Payout not found' });
    }
    
    res.json({
      message: 'Payout updated successfully',
      payout,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all referrals (admin only)
const getAllReferrals = async (req, res) => {
  try {
    const referrals = await Referral.find()
      .populate('referrerFranchiseId', 'businessName ownerName')
      .populate('referredFranchiseId', 'businessName ownerName')
      .populate('packageId', 'name')
      .sort({ createdAt: -1 });
    
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get referral settings (admin only)
const getReferralSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: 'referral_bonus_settings' });
    
    if (!settings) {
      return res.json({ value: [] });
    }
    
    // Populate package names in the settings
    const populatedSettings = [];
    for (const setting of settings.value) {
      const pkg = await Package.findById(setting.packageId);
      populatedSettings.push({
        ...setting,
        packageName: pkg ? pkg.name : 'Unknown Package'
      });
    }
    
    res.json({ value: populatedSettings });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update referral settings (admin only)
const updateReferralSettings = async (req, res) => {
  try {
    const { value } = req.body;
    
    let settings = await Setting.findOne({ key: 'referral_bonus_settings' });
    
    if (settings) {
      settings.value = value;
      await settings.save();
    } else {
      settings = new Setting({
        key: 'referral_bonus_settings',
        value,
        description: 'Referral bonus percentages by package'
      });
      await settings.save();
    }
    
    res.json({
      message: 'Referral settings updated successfully',
      settings,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all credit reports (admin only)
const getAllCreditReportsAdmin = async (req, res) => {
  try {
    const reports = await CreditReport.find()
      .populate('userId', 'name email')
      .populate('franchiseId', 'businessName')
      .sort({ createdAt: -1 });
    
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get settings (admin only)
const getSettings = async (req, res) => {
  try {
    const settings = await Setting.find();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update setting (admin only)
const updateSetting = async (req, res) => {
  try {
    const { key, value, description } = req.body;
    
    let setting = await Setting.findOne({ key });
    
    if (setting) {
      setting.value = value;
      setting.description = description;
      await setting.save();
    } else {
      setting = new Setting({
        key,
        value,
        description,
      });
      await setting.save();
    }
    
    res.json({
      message: 'Setting updated successfully',
      setting,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all franchises with credit information (admin only)
const getAllFranchisesWithCredits = async (req, res) => {
  try {
    const franchises = await Franchise.find({ isActive: true })
      .select('businessName credits totalCreditsPurchased kycStatus')
      .sort({ businessName: 1 });
    
    res.json(franchises);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create franchise user by admin (admin only)
const createFranchiseUser = async (req, res) => {
  try {
    // Extract only the fields we're now accepting
    const { name, email, assignedPackages } = req.body;
    
    // Set default values for required fields that are no longer provided in the form
    const phone = '0000000000';  // Placeholder phone number
    const state = 'Not Provided';  // Placeholder state
    const pincode = '000000';  // Placeholder pincode
    const language = 'en';  // Default language
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }
    
    // Generate a random password
    const tempPassword = Math.random().toString(36).slice(-8);
    
    // Create user with placeholder/default values for required fields
    const user = new User({
      name,
      email,
      phone,
      state,
      pincode,
      language,
      password: tempPassword,
      role: 'franchise_user',
      isActive: true, // Activate user immediately when created by admin
      isVerified: true // Mark as verified since admin created this user
    });
    
    await user.save();
    
    // Create franchise record
    const franchiseData = {
      userId: user._id,
      businessName: name,
      ownerName: name,
      email,
      phone,
      // Keep KYC status as pending - only registration is approved, not KYC
      kycStatus: 'pending',
      agreementSigned: true,
      agreementSignedAt: new Date(),
      isActive: true
    };
    
    // Add assigned packages and credits if provided
    if (assignedPackages && Array.isArray(assignedPackages) && assignedPackages.length > 0) {
      franchiseData.assignedPackages = assignedPackages;
      
      // Add credits from assigned packages
      const packages = await Package.find({ _id: { $in: assignedPackages } });
      let totalCredits = 0;
      packages.forEach(pkg => {
        totalCredits += pkg.creditsIncluded || 0;
      });
      
      // Calculate total price of packages
      const totalPrice = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);
      
      // Set initial credits
      franchiseData.credits = totalCredits;
      franchiseData.totalCreditsPurchased = totalCredits;
      
      // Update digital agreement with package details
      try {
        await updateAgreementPackageDetails(user._id, { price: `Rs. ${totalPrice}`, name: packages[0]?.name || 'Package', credits: totalCredits });
      } catch (agreementError) {
        console.error('Failed to update digital agreement with package details for new franchise:', agreementError);
      }
    }
    
    const franchise = new Franchise(franchiseData);
    
    await franchise.save();
    
    // Send account credentials email to user
    try {
      // Log email configuration status for debugging
      console.log('Attempting to send registration approval email to:', user.email);
      console.log('Temp password generated:', tempPassword ? 'Yes' : 'No');
      console.log('Assigned packages:', franchise.assignedPackages);
      
      await sendRegistrationApprovalEmail(user, franchise, tempPassword);
      console.log('Successfully sent registration approval email to user:', user.email);
    } catch (emailError) {
      console.error('Failed to send registration approval email to user:', user.email, emailError);
      console.error('Email error details:', {
        message: emailError.message,
        code: emailError.code,
        stack: emailError.stack
      });
      // Don't fail the creation if email sending fails
    }
    
    // Send notification email to admin
    try {
      await sendAdminNotificationEmail(user);
    } catch (emailError) {
      console.error('Failed to send admin notification email:', emailError);
      // Don't fail the creation if email sending fails
    }
    
    // Trigger sync to Google Sheets for new registration
    try {
      const initialized = await googleSheetsService.initialize();
      if (initialized) {
        // Sync registration data to Google Sheets
        await googleSheetsService.syncRegistrationData();
        console.log('Successfully synced new franchise user to Google Sheets');
      } else {
        console.error('Failed to initialize Google Sheets service for sync');
      }
    } catch (syncError) {
      console.error('Failed to sync new franchise user to Google Sheets:', syncError);
      // Don't fail the creation if sync fails
    }
    
    res.status(201).json({
      message: 'Franchise user created successfully. Login credentials sent to user email.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      franchise
    });
  } catch (error) {
    console.error('Create franchise user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Recharge credits for a franchise (admin only)
const rechargeFranchiseCredits = async (req, res) => {
  try {
    const { franchiseId, credits, remarks } = req.body;
    
    // Validate input
    if (!franchiseId || credits === undefined || credits <= 0) {
      return res.status(400).json({ 
        message: 'Franchise ID and positive credits amount are required' 
      });
    }
    
    // Find the franchise
    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Update credits
    const oldCredits = franchise.credits;
    franchise.credits += credits;
    franchise.totalCreditsPurchased += credits;
    await franchise.save();
    
    // Log the transaction (optional)
    // Only create transaction if franchise has a valid userId
    if (franchise.userId) {
      const transaction = new Transaction({
        userId: franchise.userId,
        franchiseId: franchise._id,
        amount: 0, // Free recharge
        currency: 'INR',
        status: 'paid',
        paymentMethod: 'admin_recharge',
        remarks: remarks || `Admin credit recharge: ${credits} credits`,
        metadata: {
          adminId: req.user.id,
          oldCredits,
          newCredits: franchise.credits,
          creditsAdded: credits
        }
      });
      
      try {
        await transaction.save();
      } catch (transactionError) {
        console.error('Error saving transaction:', transactionError);
        // If transaction fails, we still want to return success for the credit recharge
        // since the franchise was updated successfully
      }
    } else {
      console.warn(`Franchise ${franchise._id} has no userId, skipping transaction creation`);
    }
    
    res.json({
      message: 'Credits recharged successfully',
      franchise: {
        id: franchise._id,
        businessName: franchise.businessName,
        credits: franchise.credits,
        totalCreditsPurchased: franchise.totalCreditsPurchased
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get credit recharge history (admin only)
const getCreditRechargeHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      paymentMethod: 'admin_recharge'
    })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .limit(50);
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Calculate payouts for a franchise (admin only)
const calculateFranchisePayouts = async (req, res) => {
  try {
    const { franchiseId, periodStart, periodEnd } = req.body;
    
    // Validate input
    if (!franchiseId || !periodStart || !periodEnd) {
      return res.status(400).json({ 
        message: 'Franchise ID, period start, and period end are required' 
      });
    }
    
    // Validate dates
    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    
    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ 
        message: 'Invalid date format' 
      });
    }
    
    if (startDate >= endDate) {
      return res.status(400).json({ 
        message: 'Period start must be before period end' 
      });
    }
    
    // Find the franchise and populate assigned packages
    const franchise = await Franchise.findById(franchiseId).populate('assignedPackages', 'name businessPayoutType businessPayoutPercentage businessPayoutFixedAmount');
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Get the franchise's assigned package for payout calculation
    // For now, we'll use the first assigned package if multiple are assigned
    const franchisePackage = franchise.assignedPackages && franchise.assignedPackages.length > 0 
      ? franchise.assignedPackages[0] 
      : null;
    
    // Get business forms (customer packages sold) during the period
    const businessForms = await BusinessForm.find({
      franchiseId: franchiseId,
      paymentStatus: 'paid',
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).populate('selectedPackage', 'name price creditsIncluded businessPayoutType businessPayoutPercentage businessPayoutFixedAmount');
    
    console.log('Found business forms:', businessForms.length);
    console.log('Business forms data:', JSON.stringify(businessForms, null, 2));
    
    // Calculate business payout based on customer packages sold
    let totalBusinessPayout = 0;
    let creditsGenerated = 0;
    
    for (const form of businessForms) {
      if (form.selectedPackage) {
        console.log('Processing form:', form._id);
        console.log('Selected package:', JSON.stringify(form.selectedPackage, null, 2));
        
        creditsGenerated += form.selectedPackage.creditsIncluded || 0;
        
        // Calculate business payout based on the franchise's assigned package settings
        // The franchise's package determines their commission rate
        let payoutAmount = 0;
        
        // Use the franchise's package payout settings
        if (franchisePackage) {
          if (franchisePackage.businessPayoutType === 'percentage') {
            const payoutPercentage = franchisePackage.businessPayoutPercentage !== undefined ? 
              franchisePackage.businessPayoutPercentage : 20;
            payoutAmount = (form.selectedPackage.price * payoutPercentage) / 100;
            console.log(`Calculating percentage payout using franchise package ${franchisePackage.name}: ${form.selectedPackage.price} * ${payoutPercentage}% = ${payoutAmount}`);
          } else {
            payoutAmount = franchisePackage.businessPayoutFixedAmount || 0;
            console.log(`Using fixed payout from franchise package ${franchisePackage.name}: ${payoutAmount}`);
          }
        } else {
          // Fallback to customer package settings if no franchise package is assigned
          if (form.selectedPackage.businessPayoutType === 'percentage') {
            const payoutPercentage = form.selectedPackage.businessPayoutPercentage !== undefined ? 
              form.selectedPackage.businessPayoutPercentage : 20;
            payoutAmount = (form.selectedPackage.price * payoutPercentage) / 100;
            console.log(`Calculating percentage payout using customer package ${form.selectedPackage.name}: ${form.selectedPackage.price} * ${payoutPercentage}% = ${payoutAmount}`);
          } else {
            payoutAmount = form.selectedPackage.businessPayoutFixedAmount || 0;
            console.log(`Using fixed payout from customer package ${form.selectedPackage.name}: ${payoutAmount}`);
          }
        }
        
        totalBusinessPayout += payoutAmount;
        console.log(`Added payout for form ${form._id}: ${payoutAmount}, Total so far: ${totalBusinessPayout}`);
      }
    }
    
    // Get credit reports generated during the period (as a measure of business done)
    const creditReports = await CreditReport.find({
      franchiseId: franchiseId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });
    
    // Additional business metrics could be added here
    // For now, we'll use credit reports as a proxy for business activity
    
    // Calculate referral bonuses
    const referrals = await Referral.find({
      referrerFranchiseId: franchiseId,
      status: 'credited',
      creditedAt: {
        $gte: startDate,
        $lte: endDate
      }
    });
    
    let referralBonus = 0;
    referrals.forEach(referral => {
      referralBonus += referral.bonusAmount || 0;
    });
    
    // Calculate total payout amount
    // Package business payout + referral bonuses
    const totalAmount = totalBusinessPayout + referralBonus;
    
    // Calculate TDS (2% of total amount)
    const tdsAmount = totalAmount * 0.02;
    
    // IMPORTANT: GST is NOT deducted from franchise payouts
    // Franchisees pay GST separately on their own services
    // Only TDS is deducted at source
    const gstAmount = 0; // No GST deduction
    
    // Calculate final payout amount after TDS deduction only
    const finalPayoutAmount = totalAmount - tdsAmount;
    
    // Create payout record
    const payout = new Payout({
      franchiseId: franchiseId,
      amount: totalBusinessPayout,
      periodStart: startDate,
      periodEnd: endDate,
      creditsGenerated: creditsGenerated,
      referralBonus: referralBonus,
      totalAmount: finalPayoutAmount,
      grossAmount: totalAmount,
      tdsAmount: tdsAmount,
      gstAmount: gstAmount, // Set to 0 (no GST deduction)
      tdsPercentage: 2,
      gstPercentage: 0, // No GST deduction
      status: 'pending'
    });
    
    await payout.save();
    
    // Populate franchise details
    await payout.populate('franchiseId', 'businessName ownerName');
    
    res.json({
      message: 'Payout calculated successfully',
      payout,
      tdsDeducted: tdsAmount,
      gstDeducted: 0, // No GST deducted
      grossAmount: totalAmount,
      netAmount: finalPayoutAmount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get payouts for a specific franchise (admin only)
const getFranchisePayouts = async (req, res) => {
  try {
    const { franchiseId } = req.params;
    
    const payouts = await Payout.find({ franchiseId })
      .populate('franchiseId', 'businessName ownerName')
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Approve franchise registration (admin only)
const approveRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedPackages } = req.body; // Get assigned packages from request body
    
    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Find user
    const user = await User.findById(franchise.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Activate user and franchise
    user.isActive = true;
    user.isVerified = true; // Mark as verified since admin approved this registration
    franchise.isActive = true;
    
    // Assign packages and add credits if provided
    if (assignedPackages && Array.isArray(assignedPackages) && assignedPackages.length > 0) {
      franchise.assignedPackages = assignedPackages;
      
      // Add credits from assigned packages
      const packages = await Package.find({ _id: { $in: assignedPackages } });
      let totalCredits = 0;
      packages.forEach(pkg => {
        totalCredits += pkg.creditsIncluded || 0;
      });
      
        // Calculate total price of packages
      const totalPrice = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);
      
      // Add credits to franchise
      franchise.credits += totalCredits;
      franchise.totalCreditsPurchased += totalCredits;
      
      // Update digital agreement with package details
      try {
        await updateAgreementPackageDetails(user._id, { price: `Rs. ${totalPrice}`, name: packages[0]?.name || 'Package', credits: totalCredits });
      } catch (agreementError) {
        console.error('Failed to update digital agreement with package details:', agreementError);
      }
    }
    
    await user.save();
    await franchise.save();
    
    // Generate a temporary password for first-time activation
    const tempPassword = Math.random().toString(36).slice(-8);
    user.password = tempPassword;
    await user.save();
    
    // Send approval email to franchise user with login credentials
    try {
      // Log email configuration status for debugging
      console.log('Attempting to send registration approval email to:', user.email);
      console.log('Temp password generated for approval:', tempPassword ? 'Yes' : 'No');
      console.log('Assigned packages:', franchise.assignedPackages);
      
      await sendRegistrationApprovalEmail(user, franchise, tempPassword);
      console.log('Successfully sent registration approval email to user:', user.email);
    } catch (emailError) {
      console.error('Failed to send registration approval email to user:', user.email, emailError);
      console.error('Email error details:', {
        message: emailError.message,
        code: emailError.code,
        stack: emailError.stack
      });
      // Don't fail the approval if email sending fails
    }
    
    // Trigger sync to Google Sheets for new registration
    try {
      const initialized = await googleSheetsService.initialize();
      if (initialized) {
        // Sync registration data to Google Sheets
        await googleSheetsService.syncRegistrationData();
        console.log('Successfully synced approved franchise user to Google Sheets');
      } else {
        console.error('Failed to initialize Google Sheets service for sync');
      }
    } catch (syncError) {
      console.error('Failed to sync approved franchise user to Google Sheets:', syncError);
      // Don't fail the approval if sync fails
    }
    
    res.json({
      message: 'Registration approved successfully',
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Reject franchise registration (admin only)
const rejectRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Find user
    const user = await User.findById(franchise.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Deactivate user and franchise
    user.isActive = false;
    franchise.isActive = false;
    await user.save();
    await franchise.save();
    
    // Send rejection email to franchise user
    try {
      await sendRegistrationRejectionEmail(user, franchise, rejectionReason);
    } catch (emailError) {
      console.error('Failed to send registration rejection email:', emailError);
      // Don't fail the rejection if email sending fails
    }
    
    res.json({
      message: 'Registration rejected successfully',
      franchise,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete franchise (admin only)
const deleteFranchise = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find franchise
    const franchise = await Franchise.findById(id);
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Find user
    const user = await User.findById(franchise.userId);
    
    // Delete all related data
    // Delete KYC requests
    await KycRequest.deleteMany({ franchiseId: id });
    
    // Delete leads
    await Lead.deleteMany({ franchiseId: id });
    
    // Delete credit reports
    await CreditReport.deleteMany({ franchiseId: id });
    
    // Delete business forms
    await BusinessForm.deleteMany({ franchiseId: id });
    
    // Delete transactions
    await Transaction.deleteMany({ userId: franchise.userId });
    
    // Delete payouts
    await Payout.deleteMany({ franchiseId: id });
    
    // Delete referrals
    await Referral.deleteMany({ 
      $or: [
        { referrerFranchiseId: id },
        { referredFranchiseId: id }
      ]
    });
    
    // Delete the franchise
    await Franchise.findByIdAndDelete(id);
    
    // Delete the user if exists
    if (user) {
      await User.findByIdAndDelete(user._id);
    }
    
    res.json({
      message: 'Franchise deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update franchise certificate name (admin only)
const updateFranchiseCertificateName = async (req, res) => {
  try {
    const { franchiseId, certificateName } = req.body;
    
    // Validate input
    if (!franchiseId || !certificateName || certificateName.trim().length === 0) {
      return res.status(400).json({ message: 'Franchise ID and certificate name are required' });
    }
    
    // Find and update franchise
    const franchise = await Franchise.findByIdAndUpdate(
      franchiseId,
      { certificateName: certificateName.trim() },
      { new: true }
    );
    
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    res.json({
      message: 'Certificate name updated successfully',
      franchise
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get performance overview data for charts
const getPerformanceOverview = async (req, res) => {
  try {
    // Get date range from query parameters (default to last 30 days)
    const { period = 'monthly', startDate, endDate } = req.query;
    
    let start, end;
    
    // Set date range based on period
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const now = new Date();
      switch(period) {
        case 'weekly':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          break;
        case 'quarterly':
          start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
          break;
        case 'yearly':
          start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          break;
        default:
          start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      }
      end = now;
    }
    
    // Format dates for aggregation
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    // Get daily transaction data for revenue chart
    const revenueData = await Transaction.aggregate([
      {
        $match: {
          status: 'paid',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.date": 1 }
      }
    ]);
    
    // Get daily lead data
    const leadData = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.date": 1 }
      }
    ]);
    
    // Get franchise growth data
    const franchiseData = await Franchise.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.date": 1 }
      }
    ]);
    
    // Prepare chart data
    const chartData = [];
    
    // Create date range
    const dateRange = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      dateRange.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Map data to chart format
    dateRange.forEach(date => {
      const dateStr = date.toISOString().split('T')[0];
      
      const revenue = revenueData.find(d => d._id.date === dateStr)?.total || 0;
      const leads = leadData.find(d => d._id.date === dateStr)?.count || 0;
      const franchises = franchiseData.find(d => d._id.date === dateStr)?.count || 0;
      
      chartData.push({
        date: dateStr,
        revenue,
        leads,
        franchises
      });
    });
    
    // Calculate totals and trends
    const totalRevenue = revenueData.reduce((sum, item) => sum + item.total, 0);
    const totalLeads = leadData.reduce((sum, item) => sum + item.count, 0);
    const totalFranchises = franchiseData.reduce((sum, item) => sum + item.count, 0);
    
    // Calculate previous period for trend comparison
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const prevEnd = new Date(start);
    
    const prevRevenueData = await Transaction.aggregate([
      {
        $match: {
          status: 'paid',
          createdAt: { $gte: prevStart, $lte: prevEnd }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" }
        }
      }
    ]);
    
    const prevLeadData = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: prevStart, $lte: prevEnd }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 }
        }
      }
    ]);
    
    const prevTotalRevenue = prevRevenueData.length > 0 ? prevRevenueData[0].total : 0;
    const prevTotalLeads = prevLeadData.length > 0 ? prevLeadData[0].count : 0;
    
    const revenueGrowth = prevTotalRevenue ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : 0;
    const leadsGrowth = prevTotalLeads ? ((totalLeads - prevTotalLeads) / prevTotalLeads) * 100 : 0;
    
    res.json({
      chartData,
      summary: {
        totalRevenue,
        totalLeads,
        totalFranchises,
        revenueGrowth: revenueGrowth.toFixed(2),
        leadsGrowth: leadsGrowth.toFixed(2)
      },
      period,
      startDate: start,
      endDate: end
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getRecentActivities,
  getAllUsers,
  getUserById,
  updateUser,
  createLead,
  getAllLeads,
  getLeadById,
  updateLead,
  deleteLead,
  getAllTransactions,
  getTransactionById,
  getAllPayouts,
  updatePayout,
  getAllReferrals,
  getReferralSettings,
  updateReferralSettings,
  getAllCreditReportsAdmin,
  getSettings,
  updateSetting,
  getAllFranchisesWithCredits,
  rechargeFranchiseCredits,
  getCreditRechargeHistory,
  calculateFranchisePayouts,
  getFranchisePayouts,
  bulkUploadLeads,
  csvUpload,
  createFranchiseUser,
  approveRegistration,
  rejectRegistration,
  deleteFranchise,
  updateFranchiseCertificateName,
  getPerformanceOverview,
};
