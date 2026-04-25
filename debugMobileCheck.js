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
    // Get all franchises and users to debug the mobile number
    const franchises = await Franchise.find({}).populate('userId');
    
    console.log('=== Mobile Number Check ===');
    
    for (const franchise of franchises) {
      console.log(`\nFranchise ID: ${franchise._id}`);
      console.log(`Business Name: ${franchise.businessName}`);
      console.log(`User ID: ${franchise.userId?._id}`);
      console.log(`User Name: ${franchise.userId?.name}`);
      console.log(`User Email: ${franchise.userId?.email}`);
      
      // Check mobile number in different locations
      console.log('\nMobile Number Check:');
      console.log(`  User Mobile: ${franchise.userId?.mobile || 'NOT SET'}`);
      console.log(`  Franchise Phone: ${franchise.phone || 'NOT SET'}`);
      
      // Check if mobile is complete
      const hasMobile = franchise.userId?.mobile;
      
      console.log(`\nHas Mobile: ${hasMobile ? 'YES' : 'NO'}`);
    }
    
    console.log('\n=== End of Check ===');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
});