const express = require('express');
const router = express.Router();
const multer = require('multer');
const { sendJobApplicationEmail } = require('../utils/emailService');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF, DOC, DOCX files
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'application/msword' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'));
    }
  }
});

// Submit job application
router.post('/apply', upload.single('resume'), async (req, res) => {
  try {
    const { name, email, phone, position } = req.body;
    
    // Validate required fields
    if (!name || !email || !phone || !position) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required: name, email, phone, position' 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }
    
    // Check if resume was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Resume is required' 
      });
    }
    
    // Get file extension
    let resumeExtension = 'pdf';
    if (req.file.mimetype === 'application/msword') {
      resumeExtension = 'doc';
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      resumeExtension = 'docx';
    }
    
    // Prepare application data
    const applicationData = {
      name,
      email,
      phone,
      position,
      resumeExtension
    };
    
    // Send email with resume attachment
    await sendJobApplicationEmail(applicationData, req.file.buffer);
    
    res.status(200).json({ 
      success: true, 
      message: 'Application submitted successfully! We will contact you soon.' 
    });
  } catch (error) {
    console.error('Error submitting job application:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to submit application. Please try again later.' 
    });
  }
});

module.exports = router;