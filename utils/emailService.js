const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Load environment variables

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Test the transporter
transporter.verify((error, success) => {
  if (error) {
    console.error('Nodemailer transporter verification failed:', error);
  } else {
    console.log('Nodemailer transporter is ready to send emails.');
  }
});

// Send registration email to user
const sendRegistrationEmail = async (user) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'Welcome to Credit Dost Franchise Platform',
    html: `
      <h2>Welcome to Credit Dost!</h2>
      <p>Hello ${user.name},</p>
      <p>Thank you for registering as a franchise partner with Credit Dost.</p>
      <p>Your registration is currently pending approval. Our team will review your application and get back to you soon.</p>
      <p>Join our WhatsApp group for updates and support: <a href="${process.env.WHATSAPP_GROUP_LINK || '#'}">Click here to join</a></p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send registration notification email to admin
const sendAdminNotificationEmail = async (user, options = {}) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Fallback to EMAIL_USER if ADMIN_EMAIL not set
    subject: options.subject || 'New Franchise Registration - Credit Dost Platform',
    html: options.html || `
      <h2>New Franchise Registration</h2>
      <p>A new franchise user has registered on the Credit Dost platform.</p>
      <p><strong>Name:</strong> ${user.name}</p>
      <p><strong>Email:</strong> ${user.email}</p>
      <p><strong>Phone:</strong> ${user.phone}</p>
      <p><strong>State:</strong> ${user.state}</p>
      <p><strong>Pincode:</strong> ${user.pincode}</p>
      <p>Please review the application in the admin dashboard.</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send self-registration welcome email
const sendSelfRegistrationEmail = async (user, franchise) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'Welcome to Credit Dost Franchise Platform',
    html: `
      <h2>Welcome to Credit Dost!</h2>
      <p>Hello ${user.name},</p>
      <p>Thank you for registering as a franchise partner with Credit Dost.</p>
      <p>Your registration is currently pending admin approval. You will receive login credentials via email once your registration is approved.</p>
      <p>In the meantime, join our WhatsApp group for updates and support: <a href="${process.env.WHATSAPP_GROUP_LINK || '#'}">Click here to join</a></p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send registration approval email
const sendRegistrationApprovalEmail = async (user, franchise, password) => {
  try {
    // Get package names if packages are assigned
    let packageNames = [];
    if (franchise.assignedPackages && franchise.assignedPackages.length > 0) {
      const Package = require('../models/Package'); // Import here to avoid circular dependency
      const packages = await Package.find({ _id: { $in: franchise.assignedPackages } });
      packageNames = packages.map(pkg => pkg.name);
    }
    
    const mailOptions = {
      from: '"Credit Dost Support" <support@creditdost.co.in> ',
      to: user.email,
      subject: 'Registration Approved - Credit Dost Franchise Platform',
      html: `
        <h2>Registration Approved!</h2>
        <p>Hello ${user.name},</p>
        <p>Congratulations! Your registration has been approved.</p>
        <p>Your account is now active. Here are your login credentials:</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Password:</strong> ${password || 'Your previously set password'}</p>
        ${packageNames.length > 0 ? `<p><strong>Assigned Package(s):</strong> ${packageNames.join(', ')}</p>` : ''}
        <p>Please log in and change your password for security.</p>
        <p><a href="${process.env.FRONTEND_URL}/login">Login to your account</a></p>
        <p><strong>Important:</strong> Please complete your KYC verification in the platform to unlock all features.</p>
        <p><strong>Next Step:</strong> Please sign the digital agreement in your dashboard to complete your onboarding process.</p>
        <p>Join our WhatsApp group for updates and support: <a href="${process.env.WHATSAPP_GROUP_LINK || '#'}">Click here to join</a></p>
        <p>Best regards,<br>The Credit Dost Team</p>
      `,
    };
    
    console.log('Attempting to send email to:', user.email, 'with subject:', mailOptions.subject);
    
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error in sendRegistrationApprovalEmail:', error);
    throw error; // Re-throw the error so the calling function can handle it
  }
};

// Send registration rejection email
const sendRegistrationRejectionEmail = async (user, franchise, reason) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'Registration Review - Credit Dost Franchise Platform',
    html: `
      <h2>Registration Review Required</h2>
      <p>Hello ${user.name},</p>
      <p>We've reviewed your registration, but unfortunately, we need some corrections:</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please contact our support team for more information.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send KYC approval email
const sendKycApprovalEmail = async (user, franchise) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'KYC Approved - Credit Dost Franchise Platform',
    html: `
      <h2>KYC Approved!</h2>
      <p>Hello ${user.name},</p>
      <p>Congratulations! Your KYC documents have been approved.</p>
      <p>Join our WhatsApp group for updates and support: <a href="${process.env.WHATSAPP_GROUP_LINK || '#'}">Click here to join</a></p>
      <p>You can now access all the features of the Credit Dost franchise platform.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send KYC rejection email
const sendKycRejectionEmail = async (user, franchise, reason) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'KYC Review - Credit Dost Franchise Platform',
    html: `
      <h2>KYC Review Required</h2>
      <p>Hello ${user.name},</p>
      <p>We've reviewed your KYC documents, but unfortunately, we need some corrections:</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please log in to the platform and resubmit your KYC documents.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send account credentials email
const sendAccountCredentialsEmail = async (user, password) => {
  try {
    const mailOptions = {
      from: '"Credit Dost Support" <support@creditdost.co.in> ',
      to: user.email,
      subject: 'Your Credit Dost Account Credentials',
      html: `
        <h2>Your Account Credentials</h2>
        <p>Hello ${user.name},</p>
        <p>Your franchise account has been approved! Here are your login credentials:</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p>Please log in and change your password for security.</p>
        <p><a href="${process.env.FRONTEND_URL}/login">Login to your account</a></p>
        <p><strong>Important:</strong> Please complete your KYC verification in the platform to unlock all features.</p>
        <p>Join our WhatsApp group for updates and support: <a href="${process.env.WHATSAPP_GROUP_LINK || '#'}">Click here to join</a></p>
        <p>Best regards,<br>The Credit Dost Team</p>
      `,
    };
    
    console.log('Attempting to send account credentials email to:', user.email, 'with subject:', mailOptions.subject);
    
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error in sendAccountCredentialsEmail:', error);
    throw error; // Re-throw the error so the calling function can handle it
  }
};

// Send payment success email
const sendPaymentSuccessEmail = async (user, transaction, pkg) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'Payment Successful - Credit Dost Franchise Platform',
    html: `
      <h2>Payment Successful!</h2>
      <p>Hello ${user.name},</p>
      <p>Thank you for your payment. Here are the details:</p>
      <p><strong>Package:</strong> ${pkg.name}</p>
      <p><strong>Amount:</strong> ₹${transaction.amount}</p>
      <p><strong>Credits Added:</strong> ${pkg.creditsIncluded}</p>
      <p>Your credits have been added to your account and are ready to use.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send lead assignment email to franchise user
const sendLeadAssignmentEmail = async (franchiseUser, lead, adminUser) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: franchiseUser.email,
    subject: 'New Lead Assigned - Credit Dost Platform',
    html: `
      <h2>New Lead Assigned</h2>
      <p>Hello ${franchiseUser.name},</p>
      <p>A new lead has been assigned to you by the admin team:</p>
      <p><strong>Lead Name:</strong> ${lead.name}</p>
      <p><strong>Email:</strong> ${lead.email || 'N/A'}</p>
      <p><strong>Phone:</strong> ${lead.phone}</p>
      <p><strong>Assigned by:</strong> ${adminUser.name}</p>
      <p>Please log in to the platform to view and manage this lead.</p>
      <p><a href="${process.env.FRONTEND_URL}/franchise/leads">View Leads</a></p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send lead approval email to admin
const sendLeadApprovalEmail = async (adminUser, lead, franchiseUser) => {
  // Skip sending email if admin user has nitinv@creditdost.co.in email
  if (adminUser.email === 'nitinv@creditdost.co.in') {
    console.log('Skipping lead approval email for admin user with nitinv@creditdost.co.in');
    return;
  }
  
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: adminUser.email,
    subject: 'Lead Approved - Credit Dost Platform',
    html: `
      <h2>Lead Approved</h2>
      <p>Hello ${adminUser.name},</p>
      <p>The following lead has been approved by the franchise user:</p>
      <p><strong>Lead Name:</strong> ${lead.name}</p>
      <p><strong>Email:</strong> ${lead.email || 'N/A'}</p>
      <p><strong>Phone:</strong> ${lead.phone}</p>
      <p><strong>Approved by:</strong> ${franchiseUser.name}</p>
      <p><strong>Franchise:</strong> ${franchiseUser.franchise?.businessName || 'N/A'}</p>
      <p>Please log in to the admin dashboard to view the updated lead status.</p>
      <p><a href="${process.env.FRONTEND_URL}/admin/leads">View Leads</a></p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send lead rejection email to admin
const sendLeadRejectionEmail = async (adminUser, lead, franchiseUser, reason) => {
  // Skip sending email if admin user has nitinv@creditdost.co.in email
  if (adminUser.email === 'nitinv@creditdost.co.in') {
    console.log('Skipping lead rejection email for admin user with nitinv@creditdost.co.in');
    return;
  }
  
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: adminUser.email,
    subject: 'Lead Rejected - Credit Dost Platform',
    html: `
      <h2>Lead Rejected</h2>
      <p>Hello ${adminUser.name},</p>
      <p>The following lead has been rejected by the franchise user:</p>
      <p><strong>Lead Name:</strong> ${lead.name}</p>
      <p><strong>Email:</strong> ${lead.email || 'N/A'}</p>
      <p><strong>Phone:</strong> ${lead.phone}</p>
      <p><strong>Rejected by:</strong> ${franchiseUser.name}</p>
      <p><strong>Franchise:</strong> ${franchiseUser.franchise?.businessName || 'N/A'}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please log in to the admin dashboard to view the updated lead status.</p>
      <p><a href="${process.env.FRONTEND_URL}/admin/leads">View Leads</a></p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send business form submission email
const sendBusinessFormSubmissionEmail = async (recipient, businessForm, franchise) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: recipient.email,
    subject: 'New Business Form Submission - Credit Dost Platform',
    html: `
      <h2>New Business Form Submission</h2>
      <p>Hello ${recipient.name},</p>
      <p>A new business form has been submitted with the following details:</p>
      <p><strong>Customer Name:</strong> ${businessForm.customerName}</p>
      <p><strong>Customer Email:</strong> ${businessForm.customerEmail}</p>
      <p><strong>Customer Phone:</strong> ${businessForm.customerPhone}</p>
      <p><strong>PAN Number:</strong> ${businessForm.panNumber}</p>
      <p><strong>Aadhar Number:</strong> ${businessForm.aadharNumber}</p>
      <p><strong>State:</strong> ${businessForm.state}</p>
      <p><strong>Package Selected:</strong> ${businessForm.selectedPackage?.name || 'N/A'}</p>
      <p><strong>Franchise:</strong> ${franchise?.businessName || 'N/A'}</p>
      <p>Payment has been successfully processed.</p>
      <p>Please log in to the platform to view the complete details.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send referral email to referred user
const sendReferralEmail = async (referral, referrerFranchise) => {
  // Generate referral link
  const referralLink = referral.getReferralLink();
  
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: referral.referredEmail,
    subject: 'Franchise Opportunity - Credit Dost Platform',
    html: `
      <h2>Franchise Opportunity from Credit Dost!</h2>
      <p>Hello ${referral.referredName},</p>
      <p>Your friend ${referrerFranchise.ownerName} (${referrerFranchise.email}) has referred you to join Credit Dost as a franchise partner.</p>
      <p>Credit Dost is a leading platform for credit verification services, helping businesses make informed decisions.</p>
      <p><strong>Benefits of joining:</strong></p>
      <ul>
        <li>Access to multiple credit bureaus (CIBIL, CRIF, Experian, Equifax)</li>
        <li>Competitive pricing and revenue sharing</li>
        <li>Comprehensive dashboard and reporting tools</li>
        <li>Dedicated support team</li>
      </ul>
      <p>To get started, click the link below:</p>
      <p><a href="${referralLink}" style="background-color: #6200ea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Register as Franchise Partner</a></p>
      <p>Or copy and paste this link in your browser: ${referralLink}</p>
      <p>If you have any questions, feel free to contact us at ${process.env.EMAIL_USER}.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send credit report email to user and admin
const sendCreditReportEmail = async (recipient, creditReport) => {
  // Validate recipient object
  if (!recipient || !recipient.email) {
    throw new Error('Recipient email is required');
  }

  // Use local path if available for permanent download link
  const downloadLink = creditReport.localPath 
    ? `${process.env.BACKEND_URL || 'https://reactbackend.creditdost.co.in'}${creditReport.localPath}`
    : creditReport.reportUrl;

  const mailOptions = {
    from: '"Credit Dost" <support@creditdost.co.in> ',
    to: recipient.email,
    subject: `Your ${creditReport.bureau ? creditReport.bureau.toUpperCase() : 'Experian'} Credit Report - Credit Dost`,
    html: `
      <h2>Your ${creditReport.bureau ? creditReport.bureau.toUpperCase() : 'Experian'} Credit Report</h2>
      <p>Hello ${recipient.name || 'User'},</p>
      <p>Your credit report has been successfully generated.</p>
      <p><strong>Report Details:</strong></p>
      <ul>
        <li>Name: ${creditReport.name}</li>
        <li>Mobile: ${creditReport.mobile}</li>
        <li>Email: ${recipient.email}</li>
        <li>PAN: ${creditReport.pan || 'Not provided'}</li>
        <li>Credit Score: ${creditReport.score || 'Not available'}</li>
        <li>Bureau: ${creditReport.bureau ? creditReport.bureau.toUpperCase() : 'Experian'}</li>
      </ul>
      ${downloadLink ? `<p><a href="${downloadLink}" style="background-color: #6200ea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Download Report</a></p>
      <p><small>Note: This link will remain active permanently.</small></p>` : ''}
      <p>If you have any questions, feel free to contact us at ${process.env.EMAIL_USER}.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send contact form submission email to admin
const sendContactFormEmail = async (contactForm) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Send to admin email or fallback to sender email
    subject: `New Contact Form Submission - Credit Dost`,
    html: `
      <h2>New Contact Form Submission</h2>
      <p>A new contact form has been submitted with the following details:</p>
      <p><strong>Name:</strong> ${contactForm.name}</p>
      <p><strong>Email:</strong> ${contactForm.email}</p>
      <p><strong>Mobile Number:</strong> ${contactForm.mobileNumber || 'Not provided'}</p>
      <p><strong>Subject:</strong> ${contactForm.subject || 'No subject provided'}</p>
      <p><strong>Message:</strong></p>
      <p>${contactForm.message}</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send apply for loan form submission email to admin
const sendApplyForLoanFormEmail = async (businessForm) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Send to admin email or fallback to sender email
    subject: `New Apply for Loan Form Submission - Credit Dost`,
    html: `
      <h2>New Apply for Loan Form Submission</h2>
      <p>A new loan application has been submitted with the following details:</p>
      <p><strong>Customer Name:</strong> ${businessForm.customerName}</p>
      <p><strong>Customer Email:</strong> ${businessForm.customerEmail}</p>
      <p><strong>Customer Phone:</strong> ${businessForm.customerPhone}</p>
      <p><strong>WhatsApp Number:</strong> ${businessForm.whatsappNumber || 'Not provided'}</p>
      <p><strong>PAN Number:</strong> ${businessForm.panNumber || 'Not provided'}</p>
      <p><strong>Aadhar Number:</strong> ${businessForm.aadharNumber || 'Not provided'}</p>
      <p><strong>City:</strong> ${businessForm.city || 'Not provided'}</p>
      <p><strong>State:</strong> ${businessForm.state}</p>
      <p><strong>Pincode:</strong> ${businessForm.pincode}</p>
      <p><strong>Occupation:</strong> ${businessForm.occupation}</p>
      <p><strong>Monthly Income:</strong> ${businessForm.monthlyIncome || 'Not provided'}</p>
      <p><strong>Current Credit Score:</strong> ${businessForm.creditScore || 'Not provided'}</p>
      <p><strong>Loan Amount Required:</strong> ${businessForm.loanAmount || 'Not provided'}</p>
      <p><strong>Loan Purpose:</strong> ${businessForm.loanPurpose || 'Not provided'}</p>
      <p><strong>Message:</strong></p>
      <p>${businessForm.message || 'No message provided'}</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send credit repair form submission email to admin
const sendCreditRepairFormEmail = async (creditRepair) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Send to admin email or fallback to sender email
    subject: `New Credit Repair Form Submission - Credit Dost`,
    html: `
      <h2>New Credit Repair Form Submission</h2>
      <p>A new credit repair form has been submitted with the following details:</p>
      <p><strong>Full Name:</strong> ${creditRepair.fullName}</p>
      <p><strong>Email:</strong> ${creditRepair.email}</p>
      <p><strong>Mobile Number:</strong> ${creditRepair.mobileNumber}</p>
      <p><strong>City:</strong> ${creditRepair.city || 'Not provided'}</p>
      <p><strong>State:</strong> ${creditRepair.state}</p>
      <p><strong>Current Credit Score:</strong> ${creditRepair.creditScore || 'Not provided'}</p>
      <p><strong>Problem Type:</strong> ${creditRepair.problemType}</p>
      <p><strong>Occupation:</strong> ${creditRepair.occupation || 'Not provided'}</p>
      <p><strong>Income:</strong> ${creditRepair.income || 'Not provided'}</p>
      <p><strong>Language:</strong> ${creditRepair.language || 'Not provided'}</p>
      <p><strong>Message:</strong></p>
      <p>${creditRepair.message || 'No message provided'}</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send franchise opportunity form submission email to admin
const sendFranchiseOpportunityEmail = async (franchiseOpportunity) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Send to admin email or fallback to sender email
    subject: `New Franchise Opportunity Submission - Credit Dost`,
    html: `
      <h2>New Franchise Opportunity Submission</h2>
      <p>A new franchise opportunity form has been submitted with the following details:</p>
      <p><strong>Full Name:</strong> ${franchiseOpportunity.fullName}</p>
      <p><strong>Email:</strong> ${franchiseOpportunity.email}</p>
      <p><strong>Mobile Number:</strong> ${franchiseOpportunity.mobileNumber}</p>
      <p><strong>City:</strong> ${franchiseOpportunity.city}</p>
      <p><strong>State:</strong> ${franchiseOpportunity.state}</p>
      <p><strong>Profession:</strong> ${franchiseOpportunity.profession}</p>
      <p><strong>Message:</strong></p>
      <p>${franchiseOpportunity.message || 'No message provided'}</p>
      <p><strong>Consent:</strong> ${franchiseOpportunity.consent ? 'Yes' : 'No'}</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send suvidha centre application form submission email to admin
const sendSuvidhaCentreApplicationEmail = async (suvidhaCentreApplication) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER, // Send to admin email or fallback to sender email
    subject: `New Suvidha Centre Application - Credit Dost`,
    html: `
      <h2>New Suvidha Centre Application</h2>
      <p>A new suvidha centre application form has been submitted with the following details:</p>
      <p><strong>Full Name:</strong> ${suvidhaCentreApplication.fullName}</p>
      <p><strong>Email:</strong> ${suvidhaCentreApplication.email}</p>
      <p><strong>Mobile Number:</strong> ${suvidhaCentreApplication.mobileNumber}</p>
      <p><strong>WhatsApp Number:</strong> ${suvidhaCentreApplication.whatsappNumber || 'Not provided'}</p>
      <p><strong>City:</strong> ${suvidhaCentreApplication.city}</p>
      <p><strong>State:</strong> ${suvidhaCentreApplication.state}</p>
      <p><strong>Pincode:</strong> ${suvidhaCentreApplication.pincode}</p>
      <p><strong>Occupation:</strong> ${suvidhaCentreApplication.occupation}</p>
      <p><strong>Finance Experience:</strong> ${suvidhaCentreApplication.financeExperience}</p>
      <p><strong>Smartphone/Laptop:</strong> ${suvidhaCentreApplication.smartphoneLaptop}</p>
      <p><strong>Communication Skills:</strong> ${suvidhaCentreApplication.communication}</p>
      <p><strong>Investment Readiness:</strong> ${suvidhaCentreApplication.investmentReadiness}</p>
      <p><strong>Consent:</strong> ${suvidhaCentreApplication.consent ? 'Yes' : 'No'}</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send job application email
const sendJobApplicationEmail = async (applicationData, resumeBuffer) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: process.env.JOB_APPLICATION_EMAIL || process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
    subject: `Job Application: ${applicationData.position} - ${applicationData.name}`,
    html: `
      <h2>New Job Application</h2>
      <p>A new job application has been submitted with the following details:</p>
      <p><strong>Position Applied For:</strong> ${applicationData.position}</p>
      <p><strong>Name:</strong> ${applicationData.name}</p>
      <p><strong>Email:</strong> ${applicationData.email}</p>
      <p><strong>Phone:</strong> ${applicationData.phone}</p>
      <p>Please find the attached resume for review.</p>
      <p>Best regards,<br>The Credit Dost System</p>
    `,
    attachments: [
      {
        filename: `resume_${applicationData.name.replace(/\s+/g, '_')}_${Date.now()}.${applicationData.resumeExtension || 'pdf'}`,
        content: resumeBuffer
      }
    ]
  };
  
  return transporter.sendMail(mailOptions);
};

// Send AI Analysis document notification to admin
const sendAIAnalysisNotificationToAdmin = async (franchise, documentName, documentBuffer) => {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  if (!adminEmail) return;

  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: adminEmail,
    subject: 'New AI Analysis Document Uploaded - Credit Dost',
    html: `
      <h2>New AI Analysis Document Uploaded</h2>
      <p>A new document has been uploaded by franchise for AI analysis:</p>
      <p><strong>Franchise:</strong> ${franchise.businessName}</p>
      <p><strong>Email:</strong> ${franchise.email}</p>
      <p><strong>Document:</strong> ${documentName}</p>
      <p>Please find the attached document for review.</p>
      <p>Please log in to the admin dashboard to review the document.</p>
     
      <p>Best regards,<br>The Credit Dost System</p>
    `,
    attachments: [
      {
        filename: documentName,
        content: documentBuffer
      }
    ]
  };
  
  return transporter.sendMail(mailOptions);
};

// Send AI Analysis response notification to franchise
const sendAIAnalysisResponseToFranchise = async (franchise, documentName, documentBuffer) => {
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: franchise.email,
    subject: 'AI Analysis Response - Credit Dost',
    html: `
      <h2>AI Analysis Response Ready</h2>
      <p>Hello ${franchise.businessName},</p>
      <p>Your document has been analyzed and a response is ready:</p>
      <p><strong>Document:</strong> ${documentName}</p>
      <p>Please find the attached response document.</p>
      <p>Please log in to your franchise dashboard to view additional details.</p>
      
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
    attachments: [
      {
        filename: documentName,
        content: documentBuffer
      }
    ]
  };
  
  return transporter.sendMail(mailOptions);
};

// Send password reset link email
const sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
  
  const mailOptions = {
    from: '"Credit Dost Support" <support@creditdost.co.in> ',
    to: user.email,
    subject: 'Password Reset Request - Credit Dost',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hello ${user.name},</p>
      <p>You have requested to reset your password. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}" style="background-color: #6200ea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a></p>
      <p>Or copy and paste this link in your browser: ${resetUrl}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
      <p>Best regards,<br>The Credit Dost Team</p>
    `,
  };
  
  return transporter.sendMail(mailOptions);
};

// Send package upgrade notification email to both franchise user and admin
const sendPackageUpgradeNotification = async (user, franchise, oldPackage, newPackage, transaction) => {
  // Send email to franchise user
  try {
    const franchiseMailOptions = {
      from: '"Credit Dost Support" <support@creditdost.co.in> ',
      to: user.email,
      subject: 'Package Upgrade Successful - Credit Dost Franchise Platform',
      html: `
        <h2>Package Upgrade Successful!</h2>
        <p>Hello ${user.name},</p>
        <p>Your package has been successfully upgraded from <strong>${oldPackage?.name || 'N/A'}</strong> to <strong>${newPackage.name}</strong>.</p>
        <p><strong>Upgrade Details:</strong></p>
        <ul>
          <li><strong>Previous Package:</strong> ${oldPackage?.name || 'N/A'}</li>
          <li><strong>New Package:</strong> ${newPackage.name}</li>
          <li><strong>Amount Paid:</strong> ₹${transaction.amount}</li>
          <li><strong>Credits Added:</strong> ${newPackage.creditsIncluded}</li>
          <li><strong>Total Credits Now:</strong> ${franchise.credits}</li>
        </ul>
        <p>Your upgraded package is now active and ready to use.</p>
        <p>Best regards,<br>The Credit Dost Team</p>
      `,
    };
    
    await transporter.sendMail(franchiseMailOptions);
  } catch (error) {
    console.error('Error sending package upgrade notification to franchise user:', error);
  }
  
  // Send email to admin
  try {
    const adminMailOptions = {
      from: '"Credit Dost Support" <support@creditdost.co.in> ',
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: 'Package Upgrade Notification - Credit Dost Platform',
      html: `
        <h2>Package Upgrade Notification</h2>
        <p>A franchise user has upgraded their package:</p>
        <p><strong>User:</strong> ${user.name}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Franchise:</strong> ${franchise.businessName || 'N/A'}</p>
        <p><strong>Previous Package:</strong> ${oldPackage?.name || 'N/A'}</p>
        <p><strong>New Package:</strong> ${newPackage.name}</p>
        <p><strong>Amount Paid:</strong> ₹${transaction.amount}</p>
        <p><strong>Transaction ID:</strong> ${transaction._id}</p>
        <p>Best regards,<br>The Credit Dost System</p>
      `,
    };
    
    await transporter.sendMail(adminMailOptions);
  } catch (error) {
    console.error('Error sending package upgrade notification to admin:', error);
  }
};

module.exports = {
  sendJobApplicationEmail,
  sendRegistrationEmail,
  sendAdminNotificationEmail,
  sendSelfRegistrationEmail,
  sendRegistrationApprovalEmail,
  sendRegistrationRejectionEmail,
  sendKycApprovalEmail,
  sendKycRejectionEmail,
  sendAccountCredentialsEmail,
  sendPaymentSuccessEmail,
  sendLeadAssignmentEmail,
  sendLeadApprovalEmail,
  sendLeadRejectionEmail,
  sendBusinessFormSubmissionEmail,
  sendReferralEmail,
  sendCreditReportEmail, // Add the new email function
  sendContactFormEmail,
  sendFranchiseOpportunityEmail,
  sendSuvidhaCentreApplicationEmail,
  sendPasswordResetEmail,
  sendAIAnalysisNotificationToAdmin,
  sendAIAnalysisResponseToFranchise,
  sendPackageUpgradeNotification,
  sendCreditRepairFormEmail,
  sendApplyForLoanFormEmail
};