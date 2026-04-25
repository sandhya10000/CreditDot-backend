const KycRequest = require('../models/KycRequest');
const Franchise = require('../models/Franchise');
const User = require('../models/User');
const Setting = require('../models/Setting');
const Joi = require('joi');
const axios = require('axios');
const { sendKycApprovalEmail, sendKycRejectionEmail, sendRegistrationApprovalEmail } = require('../utils/emailService');
// Import the helper function from creditController
const { getSurepassApiKeyValue } = require('./creditController');

// Validation schema for KYC submission
const kycSchema = Joi.object({
  aadhaarNumber: Joi.string().pattern(/^[0-9]{12}$/).required().messages({
    'string.pattern.base': 'Aadhaar number must be exactly 12 digits',
    'any.required': 'Aadhaar number is required'
  }),
  panNumber: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).required().messages({
    'string.pattern.base': 'PAN number must be in the format ABCDE1234F',
    'any.required': 'PAN number is required'
  }),
  aadhaarFrontDocument: Joi.string().uri().optional().allow('').messages({
    'string.uri': 'Aadhaar front document must be a valid URL'
  }),
  aadhaarBackDocument: Joi.string().uri().optional().allow('').messages({
    'string.uri': 'Aadhaar back document must be a valid URL'
  }),
  panDocument: Joi.string().uri().optional().allow('').messages({
    'string.uri': 'PAN document must be a valid URL'
  }),
  businessRegistrationDocument: Joi.string().uri().optional().allow('').messages({
    'string.uri': 'Business registration document must be a valid URL'
  }),
});

// Submit KYC documents
const submitKyc = async (req, res) => {
  try {
    // Validate request body
    const { error } = kycSchema.validate(req.body, { abortEarly: false });
    if (error) {
      console.log('KYC Validation Error:', error.details);
      return res.status(400).json({
        message: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    
    // Check if franchise exists
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Check if KYC already submitted
    const existingKyc = await KycRequest.findOne({ franchiseId: franchise._id });
    if (existingKyc && existingKyc.status !== 'rejected') {
      return res.status(400).json({ message: 'KYC already submitted' });
    }
    
    // Check if this is a manual submission with Google Drive links
    const hasLinks = req.body.aadhaarFrontDocument || req.body.aadhaarBackDocument || 
                     req.body.panDocument || req.body.businessRegistrationDocument;
    
    // For manual submissions with links, check if files were uploaded
    const hasFiles = req.files && Object.keys(req.files).length > 0;
    
    // Log submission type for debugging
    console.log('KYC Submission Type:', hasLinks ? 'Manual with Links' : (hasFiles ? 'Manual Upload' : 'Incomplete'));
    console.log('User ID:', req.user.id);
    console.log('Franchise ID:', franchise._id);
    console.log('Request Body:', req.body);
    
    // Construct file URLs (only for manual uploads)
    const fileUrls = {};
    
    if (hasFiles) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      if (req.files['aadhaarFrontDocument'] && req.files['aadhaarFrontDocument'][0]) {
        fileUrls.aadhaarFrontDocument = `${baseUrl}/uploads/${req.files['aadhaarFrontDocument'][0].filename}`;
      }
      
      if (req.files['aadhaarBackDocument'] && req.files['aadhaarBackDocument'][0]) {
        fileUrls.aadhaarBackDocument = `${baseUrl}/uploads/${req.files['aadhaarBackDocument'][0].filename}`;
      }
      
      if (req.files['panDocument'] && req.files['panDocument'][0]) {
        fileUrls.panDocument = `${baseUrl}/uploads/${req.files['panDocument'][0].filename}`;
      }
      
      if (req.files['businessRegistrationDocument'] && req.files['businessRegistrationDocument'][0]) {
        fileUrls.businessRegistrationDocument = `${baseUrl}/uploads/${req.files['businessRegistrationDocument'][0].filename}`;
      }
    } else if (hasLinks) {
      // For manual submissions with Google Drive links
      if (req.body.aadhaarFrontDocument) {
        fileUrls.aadhaarFrontDocument = req.body.aadhaarFrontDocument;
      }
      
      if (req.body.aadhaarBackDocument) {
        fileUrls.aadhaarBackDocument = req.body.aadhaarBackDocument;
      }
      
      if (req.body.panDocument) {
        fileUrls.panDocument = req.body.panDocument;
      }
      
      if (req.body.businessRegistrationDocument) {
        fileUrls.businessRegistrationDocument = req.body.businessRegistrationDocument;
      }
    }
    
    // Create/update KYC request
    const kycData = {
      userId: req.user.id,
      franchiseId: franchise._id,
      aadhaarNumber: req.body.aadhaarNumber,
      panNumber: req.body.panNumber,
      ...fileUrls
    };
    
    // Add a note about submission method
    if (hasLinks) {
      kycData.submissionMethod = 'google-drive-links';
    } else if (hasFiles) {
      kycData.submissionMethod = 'file-upload';
    }
    
    let kycRequest;
    if (existingKyc) {
      // Update existing rejected KYC
      console.log('Updating existing KYC request:', existingKyc._id);
      kycRequest = await KycRequest.findByIdAndUpdate(
        existingKyc._id,
        kycData,
        { new: true, runValidators: true }
      );
    } else {
      // Create new KYC request
      console.log('Creating new KYC request');
      kycRequest = new KycRequest(kycData);
      await kycRequest.save();
    }
    
    // Update franchise status
    franchise.kycStatus = 'submitted';
    franchise.kycSubmittedAt = new Date();
    await franchise.save();
    
    console.log('KYC request saved successfully:', kycRequest._id);
    
    res.status(201).json({
      message: hasLinks 
        ? 'KYC submitted successfully with Google Drive links! Awaiting approval.' 
        : hasFiles
        ? 'KYC documents submitted successfully! Awaiting approval.'
        : 'KYC submitted successfully! Awaiting approval.',
      kycRequest,
    });
  } catch (error) {
    console.error('KYC submission error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get KYC status for franchise user
const getKycStatus = async (req, res) => {
  try {
    // Check if franchise exists
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }
    
    // Get KYC request
    const kycRequest = await KycRequest.findOne({ franchiseId: franchise._id });
    
    res.json({
      kycStatus: franchise.kycStatus,
      kycRequest,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get KYC request by franchise ID (admin only)
const getKycByFranchiseId = async (req, res) => {
  try {
    const { franchiseId } = req.params;
    
    // Find KYC request by franchise ID
    const kycRequest = await KycRequest.findOne({ franchiseId })
      .populate('userId', 'name email phone')
      .populate('franchiseId', 'businessName ownerName');
    
    if (!kycRequest) {
      return res.status(404).json({ message: 'KYC request not found' });
    }
    
    res.json(kycRequest);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all pending KYC requests (admin only)
const getPendingKycRequests = async (req, res) => {
  try {
    const kycRequests = await KycRequest.find({ status: 'pending' })
      .populate('userId', 'name email phone')
      .populate('franchiseId', 'businessName ownerName')
      .sort({ createdAt: 1 });
    
    res.json(kycRequests);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Approve KYC request (admin only)
const approveKyc = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find KYC request
    const kycRequest = await KycRequest.findById(id);
    if (!kycRequest) {
      return res.status(404).json({ message: 'KYC request not found' });
    }
    
    // Update KYC request
    kycRequest.status = 'approved';
    kycRequest.reviewedAt = new Date();
    kycRequest.reviewedBy = req.user.id;
    await kycRequest.save();
    
    // Update franchise
    const franchise = await Franchise.findById(kycRequest.franchiseId);
    if (franchise) {
      franchise.kycStatus = 'approved';
      franchise.kycApprovedAt = new Date();
      await franchise.save();
      
      // Activate the user account
      const user = await User.findById(franchise.userId);
      if (user) {
        user.isActive = true;
        await user.save();
        
        // Send approval email to franchise user WITHOUT login credentials
        try {
          await sendKycApprovalEmail(user, franchise);
        } catch (emailError) {
          console.error('Failed to send KYC approval email:', emailError);
        }
      }
    }
    
    res.json({
      message: 'KYC approved successfully',
      kycRequest,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Reject KYC request (admin only)
const rejectKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    // Find KYC request
    const kycRequest = await KycRequest.findById(id);
    if (!kycRequest) {
      return res.status(404).json({ message: 'KYC request not found' });
    }
    
    // Update KYC request
    kycRequest.status = 'rejected';
    kycRequest.reviewedAt = new Date();
    kycRequest.reviewedBy = req.user.id;
    kycRequest.rejectionReason = rejectionReason;
    await kycRequest.save();
    
    // Update franchise
    const franchise = await Franchise.findById(kycRequest.franchiseId);
    if (franchise) {
      franchise.kycStatus = 'rejected';
      franchise.kycRejectedAt = new Date();
      franchise.kycRejectedReason = rejectionReason;
      await franchise.save();
      
      // Deactivate the user account
      const user = await User.findById(franchise.userId);
      if (user) {
        user.isActive = false;
        await user.save();
        
        // Send rejection email to franchise user
        try {
          await sendKycRejectionEmail(user, franchise, rejectionReason);
        } catch (emailError) {
          console.error('Failed to send KYC rejection email:', emailError);
        }
      }
    }
    
    res.json({
      message: 'KYC rejected successfully',
      kycRequest,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Initialize DigiLocker SDK for franchise users
const initializeDigiLocker = async (req, res) => {
  try {
    // Check if franchise exists
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (!franchise) {
      return res.status(404).json({ message: 'Franchise not found' });
    }

    // Get Surepass API key (same as used for credit checks) 
    const apiKey = await getSurepassApiKeyValue();
    
    // Add debugging information
    console.log('Retrieved API key:', apiKey ? 'API key found' : 'API key not found');
    if (apiKey) {
      console.log('API key length:', apiKey.length);
      // console.log('API key starts with:', apiKey.substring(0, 10));
    }
    
    if (!apiKey) {
      return res.status(500).json({ message: 'Surepass API key not configured' });
    }

    // Determine environment (use production by default, sandbox for development)
    const isDevelopment = process.env.NODE_ENV === 'development';
    const baseUrl = isDevelopment 
      ? 'https://sandbox.surepass.app' 
      : 'https://kyc-api.surepass.app';

    console.log('Using baseUrl:', baseUrl);
    console.log('Making request to:', `${baseUrl}/api/v1/digilocker/initialize`);

    // Import the Surepass API client
    const surepassClient = require('../utils/surepassApiClient');
    
    // Call Surepass API to initialize DigiLocker using rate-limited client
    const response = await surepassClient.makeRequest(
      apiKey,
      `${baseUrl}/api/v1/digilocker/initialize`,
      {
        data: {
          signup_flow: true,
          skip_main_screen: false
        }
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('DigiLocker API response:', response.data);

    // Return the token and client_id to the frontend
    res.json({
      success: true,
      token: response.data.data.token,
      clientId: response.data.data.client_id,
      expirySeconds: response.data.data.expiry_seconds
    });
  } catch (error) {
    console.error('DigiLocker initialization error:', error);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
    }
    res.status(500).json({ 
      message: 'Failed to initialize DigiLocker', 
      error: error.response?.data || error.message 
    });
  }
};

module.exports = {
  submitKyc,
  getKycStatus,
  getKycByFranchiseId,
  getPendingKycRequests,
  approveKyc,
  rejectKyc,
  initializeDigiLocker  // Add the new function
};