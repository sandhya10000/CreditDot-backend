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

const resetPassword = async (email, newPassword) => {
  try {
    console.log(`Resetting password for user: ${email}`);
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found!');
      process.exit(1);
    }
    
    console.log('User found:', user.name);
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    user.password = hashedPassword;
    await user.save();
    
    console.log('✅ Password reset successfully!');
    console.log('New password:', newPassword);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

// Get email and password from command line arguments
const email = process.argv[2] || 'admin@gmail.com';
const newPassword = process.argv[3] || 'admin@123';

console.log('Resetting password...');
console.log('Email:', email);
console.log('New password:', newPassword);

resetPassword(email, newPassword);