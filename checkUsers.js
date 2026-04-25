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

const checkUsers = async () => {
  try {
    const users = await User.find({});
    console.log('Total users in database:', users.length);
    console.log('----------------------------------------');
    
    for (const user of users) {
      console.log(`Name: ${user.name}`);
      console.log(`Email: ${user.email}`);
      console.log(`Role: ${user.role}`);
      console.log(`Active: ${user.isActive}`);
      console.log(`Password hash: ${user.password}`);
      console.log(`Created: ${user.createdAt}`);
      console.log('----------------------------------------');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkUsers();