const mongoose = require('mongoose');
const User = require('./models/User');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

// Load environment variables
dotenv.config();

// Connect to database
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/franchise_management', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const verifyPassword = async (email, password) => {
  try {
    console.log(`Checking user: ${email}`);
    console.log(`Password to verify: ${password}`);
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found!');
      process.exit(1);
    }
    
    console.log('User found in database');
    console.log('Stored password hash:', user.password);
    
    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);
    
    if (isMatch) {
      console.log('✅ Password is correct!');
    } else {
      console.log('❌ Password is incorrect!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

// Get email and password from command line arguments
const email = process.argv[2] || 'admin@gmail.com';
const password = process.argv[3] || 'admin@123';

if (!email || !password) {
  console.log('Usage: node verifyPassword.js <email> <password>');
  console.log('Default: node verifyPassword.js admin@gmail.com admin@123');
  process.exit(1);
}

verifyPassword(email, password);