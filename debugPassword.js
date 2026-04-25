const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Connect to database
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/franchise_management', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});   

const email = 'admin@gmail.com';
const password = 'admin@123';

const debugPassword = async () => {
  try {
    console.log('=== Password Debug Test ==='); 
    
    // Find user
    console.log('\n1. Finding user...');
    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found!');
      process.exit(1);
    }
    
    console.log('User found:', user.name);
    console.log('Stored password hash:', user.password);
    console.log('Stored hash length:', user.password.length);
    
    // Hash the password manually
    console.log('\n2. Manually hashing password...');
    const salt = await bcrypt.genSalt(10);
    const manualHash = await bcrypt.hash(password, salt);
    console.log('Manual hash:', manualHash);
    console.log('Manual hash length:', manualHash.length);
    
    // Compare with stored hash
    console.log('\n3. Comparing with stored hash...');
    const isMatch1 = await bcrypt.compare(password, user.password);
    console.log('bcrypt.compare result with stored hash:', isMatch1);
    
    // Compare with manual hash
    console.log('\n4. Comparing with manual hash...');
    const isMatch2 = await bcrypt.compare(password, manualHash);
    console.log('bcrypt.compare result with manual hash:', isMatch2);
    
    // Check if hashes are identical
    console.log('\n5. Comparing hashes directly...');
    console.log('Stored hash === Manual hash:', user.password === manualHash);
    
    // Try comparing with the User model method
    console.log('\n6. Using User model method...');
    const isMatch3 = await user.comparePassword(password);
    console.log('User.comparePassword result:', isMatch3);
    
    console.log('\n=== Debug Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

debugPassword();