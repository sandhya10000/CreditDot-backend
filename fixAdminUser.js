const mongoose = require('mongoose');
const User = require('./models/User');
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

const fixAdminUser = async () => {
  try {
    console.log('=== Fixing Admin User ===');
    
    // Delete existing admin user
    console.log('\n1. Deleting existing admin user...');
    const result = await User.deleteOne({ email });
    console.log(`Deleted ${result.deletedCount} user(s)`);
    
    // Create new admin user (password will be hashed automatically by the model)
    console.log('\n2. Creating new admin user...');
    const newUser = new User({
      name: 'Admin User',
      email: email,
      phone: '9876543210',
      password: password, // Not hashed yet - will be hashed by the model
      role: 'admin',
      isActive: true, 
      isVerified: true,
    });
    
    await newUser.save();
    console.log('✅ New admin user created successfully!');
    
    // Verify the new user
    console.log('\n3. Verifying new user...');
    const user = await User.findOne({ email });
    const isMatch = await user.comparePassword(password);
    console.log('Password verification result:', isMatch);
    
    if (isMatch) {
      console.log('✅ User fixed successfully! You can now login with:');
      console.log('   Email:', email);
      console.log('   Password:', password);
    } else {
      console.log('❌ Something went wrong with the fix!');
    }
    
    console.log('\n=== Fix Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

fixAdminUser();