const mongoose = require('mongoose');
const User = require('./models/User');
const Franchise = require('./models/Franchise');
const KycRequest = require('./models/KycRequest');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/franchise_management",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Get all franchises and users to debug the profile data
    const franchises = await Franchise.find({}).populate('userId');
    
    console.log('=== Franchise Profile Data Check ===');
    
    for (const franchise of franchises) {
      console.log(`\nFranchise ID: ${franchise._id}`);
      console.log(`Business Name: ${franchise.businessName}`);
      console.log(`User ID: ${franchise.userId?._id}`);
      console.log(`User Name: ${franchise.userId?.name}`);
      console.log(`User Email: ${franchise.userId?.email}`);
      
      // Get KYC request
      const kycRequest = await KycRequest.findOne({ franchiseId: franchise._id });
      
      // Display all relevant data
      console.log('\nProfile Data:');
      console.log(`  PAN Number (Franchise): ${franchise.panNumber || 'NOT SET'}`);
      console.log(`  Aadhar Number (KYC): ${kycRequest?.aadhaarNumber || 'NOT SET'}`);
      console.log(`  Aadhar Number (Franchise): ${franchise.aadharNumber || 'NOT SET'}`);
      console.log(`  Business Address (Franchise): ${franchise.businessAddress || 'NOT SET'}`);
      console.log(`  Business Address Structure:`, franchise.address);
      console.log(`  User Mobile: ${franchise.userId?.mobile || 'NOT SET'}`);
      
      // Check profile completion with the updated logic
      const isProfileComplete = franchise.panNumber && 
                               (kycRequest?.aadhaarNumber || franchise.aadharNumber) && 
                               (franchise.businessAddress || (franchise.address?.street && franchise.address?.city)) && 
                               franchise.userId?.mobile;
      
      console.log(`\nProfile Complete: ${isProfileComplete ? 'YES' : 'NO'}`);
      
      if (!isProfileComplete) {
        const missingFields = [];
        if (!franchise.panNumber) missingFields.push('PAN Number (from Profile)');
        if (!(kycRequest?.aadhaarNumber || franchise.aadharNumber)) missingFields.push('Aadhar Number (from KYC)');
        if (!(franchise.businessAddress || (franchise.address?.street && franchise.address?.city))) missingFields.push('Business Address (from Profile)');
        if (!franchise.userId?.mobile) missingFields.push('Mobile Number (from Profile)');
        
        console.log(`Missing Fields: ${missingFields.join(', ')}`);
      }
    }
    
    console.log('\n=== End of Check ===');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
});