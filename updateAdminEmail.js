const mongoose = require('mongoose');
const User = require('./models/User');

require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/creditdost';

const updateAdminEmail = async () => {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB successfully');

    // Find the admin user with email admin@gmail.com
    console.log('Searching for admin user with email: admin@gmail.com');
    const adminUser = await User.findOne({ 
      email: 'admin@gmail.com',
      role: 'admin' 
    });

    if (!adminUser) {
      console.log('No admin user found with email: admin@gmail.com');
      console.log('Searching for any admin user...');
      const allAdmins = await User.find({ role: 'admin' });
      
      if (allAdmins.length === 0) {
        console.log('No admin users found in the database');
        process.exit(0);
      } else {
        console.log(`Found ${allAdmins.length} admin user(s):`);
        allAdmins.forEach(admin => {
          console.log(`- ID: ${admin._id}, Email: ${admin.email}, Name: ${admin.name}`);
        });
        process.exit(0);
      }
    }

    console.log(`Admin user found:`);
    console.log(`- ID: ${adminUser._id}`);
    console.log(`- Name: ${adminUser.name}`);
    console.log(`- Current Email: ${adminUser.email}`);
    console.log(`- Role: ${adminUser.role}`);

    // Update the email
    const oldEmail = adminUser.email;
    const newEmail = 'nitinv@creditdost.co.in';
    
    console.log(`\nUpdating email from "${oldEmail}" to "${newEmail}"`);
    
    // Update only the email field using findOneAndUpdate to bypass validation for other required fields
    const result = await User.findOneAndUpdate(
      { _id: adminUser._id },
      { email: newEmail },
      { new: true, runValidators: false } // Skip validation for other fields
    );
    
    if (!result) {
      console.error('Failed to update admin email');
      process.exit(1);
    }
    
    console.log(`✅ Admin email successfully updated from "${oldEmail}" to "${newEmail}"`);

    // Verify the update
    const updatedUser = await User.findById(adminUser._id);
    console.log(`\nVerification - Updated user:`);
    console.log(`- ID: ${updatedUser._id}`);
    console.log(`- Name: ${updatedUser.name}`);
    console.log(`- New Email: ${updatedUser.email}`);
    console.log(`- Role: ${updatedUser.role}`);

  } catch (error) {
    console.error('Error updating admin email:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
};

// Run the update function
updateAdminEmail();