const Razorpay = require('razorpay');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Package = require('../models/Package');
const Franchise = require('../models/Franchise');
const User = require('../models/User');
const { sendPaymentSuccessEmail, sendAccountCredentialsEmail } = require('../utils/emailService');
const bcrypt = require('bcryptjs');
const { processReferralBonus } = require('../utils/referralUtils');

// Import the digital agreement controller to update package details
const { updateAgreementPackageDetails } = require('./digitalAgreementController');

// Initialize Razorpay instance
console.log('Initializing Razorpay with key_id:', process.env.RAZORPAY_KEY_ID);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create order
const createOrder = async (req, res) => {
  try {
    console.log('Create order request body:', req.body);
    const { packageId } = req.body;
    const userId = req.user.id; // Get user ID from authenticated user
    console.log('User ID from request:', userId);
    
    // Validate user
    const user = await User.findById(userId);
    if (!user) {
      console.log('User not found for ID:', userId);
      return res.status(404).json({ message: 'User not found' });
    }
    console.log('User found:', user.email);
    
    // Validate package
    const pkg = await Package.findById(packageId);
    if (!pkg || !pkg.isActive) {
      console.log('Package not found or inactive for ID:', packageId);
      return res.status(404).json({ message: 'Package not found or inactive' });
    }
    console.log('Package found:', pkg.name);
    
    // Create Razorpay order
    const options = {
      amount: pkg.price * 100, // Amount in paise
      currency: 'INR',
      receipt: `receipt_order_${Date.now()}`,
      payment_capture: 1,
    };
    console.log('Creating Razorpay order with options:', options);
    
    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created:', order.id);
    
    // Save transaction
    const transaction = new Transaction({
      userId: user._id,
      packageId: pkg._id,
      orderId: order.id,
      amount: pkg.price,
      currency: 'INR',
      status: 'created',
    });
    console.log('Saving transaction:', transaction);
    
    await transaction.save();
    console.log('Transaction saved successfully');
    
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Verify payment
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    // Verify signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');
    
    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed' });
    }
    
    // Update transaction
    const transaction = await Transaction.findOne({ orderId: razorpay_order_id });
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    transaction.paymentId = razorpay_payment_id;
    transaction.status = 'paid';
    transaction.razorpayOrderId = razorpay_order_id;
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    
    await transaction.save();
    
    // Update franchise credits and package access
    const franchise = await Franchise.findOne({ userId: transaction.userId });
    if (franchise) {
      const pkg = await Package.findById(transaction.packageId);
      if (pkg) {
        // Get the previous package before updating
        const previousPackageIds = [...franchise.assignedPackages];
        
        franchise.credits += pkg.creditsIncluded;
        franchise.totalCreditsPurchased += pkg.creditsIncluded;
        
        // Get all previous paid transactions for this user to identify previously purchased packages
        const previousTransactions = await Transaction.find({
          userId: transaction.userId,
          status: 'paid',
          _id: { $ne: transaction._id } // Exclude current transaction
        }).populate('packageId');
        
        // Identify package IDs that were added due to previous purchases
        const previouslyPurchasedPackageIds = previousTransactions
          .filter(tx => tx.packageId) // Only transactions with packages
          .map(tx => tx.packageId._id.toString());
        
        // Filter out previously purchased packages from assignedPackages
        // This prevents accumulation of old purchased packages when upgrading
        franchise.assignedPackages = franchise.assignedPackages.filter(
          pkg => !previouslyPurchasedPackageIds.includes(pkg.toString())
        );
        
        // Add the newly purchased package
        const newPackageIdString = transaction.packageId.toString();
        if (!franchise.assignedPackages.some(pkg => pkg.toString() === newPackageIdString)) {
          franchise.assignedPackages.push(transaction.packageId);
        }
        
        await franchise.save();
        
        // Process referral bonus if applicable
        await processReferralBonus(franchise._id, pkg._id, pkg.price);
        
        // Update digital agreement with package details
        try {
          await updateAgreementPackageDetails(transaction.userId, {
            price: `Rs. ${pkg.price}`,
            name: pkg.name,
            credits: pkg.creditsIncluded
          });
        } catch (agreementError) {
          console.error('Failed to update digital agreement with package details:', agreementError);
        }
        
        // Check if this is a package upgrade (user had previous packages)
        if (previousPackageIds.length > 0) {
          // Get the previous package that was replaced
          const previousPackage = await Package.findById(previousPackageIds[0]); // Assuming single package at a time
          
          // Add to package history
          franchise.packageHistory.push({
            packageName: pkg.name,
            packageId: pkg._id,
            price: pkg.price,
            creditsIncluded: pkg.creditsIncluded,
            upgradeDate: new Date(),
            transactionId: transaction._id
          });
          
          // Save the updated franchise with package history
          await franchise.save();
          
          // Send package upgrade notification
          try {
            const { sendPackageUpgradeNotification } = require('../utils/emailService');
            const user = await User.findById(transaction.userId);
            await sendPackageUpgradeNotification(user, franchise, previousPackage, pkg, transaction);
          } catch (notificationError) {
            console.error('Failed to send package upgrade notification:', notificationError);
          }
        } else {
          // For first-time package purchase, add to package history
          franchise.packageHistory.push({
            packageName: pkg.name,
            packageId: pkg._id,
            price: pkg.price,
            creditsIncluded: pkg.creditsIncluded,
            upgradeDate: new Date(),
            transactionId: transaction._id
          });
          
          // Save the updated franchise with package history
          await franchise.save();
        }
      }
    }
    
    // Get user details
    const user = await User.findById(transaction.userId);
    
    // If user doesn't have a password set (temporary password), generate and send credentials
    // Check if user has a temporary password by comparing with the hashed version
    if (user && (!user.password || await isTempPassword(user.password))) {
      // Generate a random password
      const generatedPassword = Math.random().toString(36).slice(-8);
      
      // Update user with the new password (will be hashed by pre-save hook)
      user.password = generatedPassword;
      await user.save();
      
      // Send account credentials email
      try {
        await sendAccountCredentialsEmail(user, generatedPassword);
      } catch (emailError) {
        console.error('Failed to send account credentials email:', emailError);
      }
    }
    
    // Send payment success email
    if (user) {
      const pkg = await Package.findById(transaction.packageId);
      if (pkg) {
        try {
          await sendPaymentSuccessEmail(user, transaction, pkg);
        } catch (emailError) {
          console.error('Failed to send payment success email:', emailError);
        }
      }
    }
    
    res.json({
      message: 'Payment verified successfully',
      transaction,
    });
  } catch (error) {
    console.error('Error in verifyPayment:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Helper function to check if password is the temporary one
const isTempPassword = async (hashedPassword) => {
  try {
    // Compare the hashed password with the hashed version of 'temp_password'
    return await bcrypt.compare('temp_password', hashedPassword);
  } catch (error) {
    console.error('Error comparing temp password:', error);
    return false;
  }
};

// Webhook handler for Razorpay
const handleWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');
    
    if (digest !== req.headers['x-razorpay-signature']) {
      return res.status(400).json({ message: 'Webhook signature verification failed' });
    }
    
    // Process event
    const event = req.body.event;
    const payload = req.body.payload;
    
    switch (event) {
      case 'payment.captured':
        // Handle successful payment
        console.log('Payment captured:', payload);
        break;
        
      case 'payment.failed':
        // Handle failed payment
        console.log('Payment failed:', payload);
        break;
        
      default:
        console.log('Unhandled event:', event);
    }
    
    res.json({ message: 'Webhook received' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  handleWebhook,
};