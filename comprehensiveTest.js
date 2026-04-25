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

const runTests = async () => {
  try {
    console.log('=== Comprehensive User Test ===');
    
    // 1. Check if user exists
    console.log('\n1. Checking if user exists...');
    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found!');
      // Create user if not exists
      console.log('Creating user...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      const newUser = new User({
        name: 'Admin User',
        email: email,
        phone: '9876543210',
        password: hashedPassword,
        role: 'admin',
        isActive: true, 
        isVerified: true,
      });
      
      await newUser.save();
      console.log('✅ User created successfully!');
    } else {
      console.log('✅ User found:', user.name);
    }
    
    // 2. Reset password
    console.log('\n2. Resetting password...');
    const userToUpdate = await User.findOne({ email });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    userToUpdate.password = hashedPassword;
    await userToUpdate.save();
    console.log('✅ Password reset successfully!');
    
    // 3. Verify password
    console.log('\n3. Verifying password...');
    const userToVerify = await User.findOne({ email });
    const isMatch = await bcrypt.compare(password, userToVerify.password);
    console.log('Password verification result:', isMatch);
    
    if (isMatch) {
      console.log('✅ Password is correct!');
    } else {
      console.log('❌ Password is incorrect!');
    }
    
    console.log('\n=== Test Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

runTests();