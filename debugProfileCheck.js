const mongoose = require('mongoose');
const User = require('./models/User');
const Franchise = require('./models/Franchise');
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
    // Get all franchises and users to debug the profile completion check
    const franchises = await Franchise.find({}).populate('userId');
    
    console.log('=== Franchise Profile Completion Check ===');
    
    for (const franchise of franchises) {
      console.log(`\nFranchise ID: ${franchise._id}`);
      console.log(`Business Name: ${franchise.businessName}`);
      console.log(`User ID: ${franchise.userId?._id}`);
      console.log(`User Name: ${franchise.userId?.name}`);
      console.log(`User Email: ${franchise.userId?.email}`);
      
      // Check profile completion
      console.log('\nProfile Fields:');
      console.log(`  PAN Number: ${franchise.panNumber || 'MISSING'}`);
      console.log(`  Aadhar Number: ${franchise.aadharNumber || 'MISSING'}`);
      console.log(`  Business Address: ${franchise.businessAddress || 'MISSING'}`);
      console.log(`  User Mobile: ${franchise.userId?.mobile || 'MISSING'}`);
      
      const isProfileComplete = franchise.panNumber && 
                               franchise.aadharNumber && 
                               franchise.businessAddress && 
                               franchise.userId?.mobile;
      
      console.log(`\nProfile Complete: ${isProfileComplete ? 'YES' : 'NO'}`);
      
      if (!isProfileComplete) {
        const missingFields = [];
        if (!franchise.panNumber) missingFields.push('PAN Number');
        if (!franchise.aadharNumber) missingFields.push('Aadhar Number');
        if (!franchise.businessAddress) missingFields.push('Business Address');
        if (!franchise.userId?.mobile) missingFields.push('Mobile Number');
        
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