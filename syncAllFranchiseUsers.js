const mongoose = require('mongoose');
const GoogleSheet = require('./models/GoogleSheet');
const googleSheetsService = require('./utils/googleSheetsService');
const User = require('./models/User');

require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/creditdost';
mongoose.connect(mongoURI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
});

// Wait for database connection
setTimeout(async () => {
  try {
    console.log('Syncing all franchise users to Google Sheets...\n');
    
    // Get all franchise users
    const allFranchiseUsers = await User.find({ 
      role: 'franchise_user'
    })
    .select('name email phone state pincode language createdAt isVerified')
    .sort({ createdAt: -1 });
    
    console.log('Total franchise users found:', allFranchiseUsers.length);
    console.log('Verified (admin-created):', allFranchiseUsers.filter(u => u.isVerified).length);
    console.log('Unverified (self-registered):', allFranchiseUsers.filter(u => !u.isVerified).length);
    
    // Initialize Google Sheets service
    console.log('\n🔄 Initializing Google Sheets service...');
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      console.log('❌ Failed to initialize Google Sheets service');
      process.exit(1);
    }
    
    console.log('✅ Google Sheets service initialized successfully!');
    
    // Get settings
    const settings = await GoogleSheet.findOne({ isActive: true });
    if (!settings || !settings.spreadsheetId) {
      console.log('❌ Google Sheets integration not configured');
      process.exit(1);
    }
    
    // Create required tabs
    console.log('\n📝 Creating required tabs...');
    const tabsCreated = await googleSheetsService.createRequiredTabs(settings.spreadsheetId);
    
    if (!tabsCreated) {
      console.log('❌ Failed to create required tabs');
      process.exit(1);
    }
    
    console.log('✅ Required tabs created successfully!');
    
    // Format data for Google Sheets (all franchise users)
    const rows = [
      ['Name', 'Email', 'Phone', 'State', 'Pincode', 'Language', 'Date', 'Verified', 'Status'], // Header row
      ...allFranchiseUsers.map(user => [
        user.name || '',
        user.email || '',
        user.phone || '',
        user.state || '',
        user.pincode || '',
        user.language || '',
        user.createdAt ? user.createdAt.toISOString().split('T')[0] : '',
        user.isVerified ? 'Yes' : 'No',
        user.isVerified ? 'Admin Created' : 'Self Registered'
      ])
    ];
    
    console.log('\n📊 Preparing to sync', rows.length - 1, 'franchise users...');
    
    // Update Google Sheet
    console.log('📝 Updating Google Sheet...');
    const updateResult = await googleSheetsService.sheets.spreadsheets.values.update({
      spreadsheetId: settings.spreadsheetId,
      range: `New Registration!A1:I${rows.length}`,
      valueInputOption: 'RAW',
      resource: {
        values: rows
      }
    });
    
    if (updateResult) {
      console.log('✅ Successfully synced all franchise users to Google Sheets!');
      console.log('Total rows updated:', rows.length - 1);
      
      // Update last sync timestamp
      if (settings.tabs) {
        const newRegistrationTab = settings.tabs.get('newRegistration');
        if (newRegistrationTab) {
          settings.tabs.set('newRegistration', {
            ...newRegistrationTab,
            lastSync: new Date()
          });
          await settings.save();
          console.log('✅ Sync timestamp updated in database');
        }
      }
    } else {
      console.log('❌ Failed to update Google Sheet');
      process.exit(1);
    }
    
    console.log('\n🎉 Sync completed successfully!');
    console.log('✅ All franchise users have been synced to the "New Registration" tab');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during sync:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}, 2000);