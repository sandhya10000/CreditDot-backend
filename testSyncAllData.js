const mongoose = require('mongoose');
const GoogleSheet = require('./models/GoogleSheet');
const googleSheetsService = require('./utils/googleSheetsService');

require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/creditdost';
mongoose.connect(mongoURI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
});

// Wait for database connection
setTimeout(async () => {
  try {
    console.log('Testing Google Sheets data sync...\n');
    
    // Initialize the service
    console.log('🔄 Initializing Google Sheets service...');
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      console.log('❌ Failed to initialize Google Sheets service');
      process.exit(1);
    }
    
    console.log('✅ Google Sheets service initialized successfully!');
    
    // Test creating required tabs
    console.log('\n📝 Testing creation of required tabs...');
    const settings = await GoogleSheet.findOne();
    const tabsCreated = await googleSheetsService.createRequiredTabs(settings.spreadsheetId);
    
    if (!tabsCreated) {
      console.log('❌ Failed to create required tabs');
      process.exit(1);
    }
    
    console.log('✅ Required tabs created/verified successfully!');
    
    // Test sync of credit repair data specifically (since that was failing)
    console.log('\n🔄 Testing credit repair data sync...');
    const creditRepairResult = await googleSheetsService.syncCreditRepairData();
    console.log('Credit repair sync result:', creditRepairResult);
    
    if (!creditRepairResult.success) {
      console.log('❌ Credit repair sync failed');
    } else {
      console.log('✅ Credit repair sync completed successfully!');
    }
    
    // Test sync of all data
    console.log('\n🔄 Testing sync of all data...');
    const allResults = await googleSheetsService.syncAllData();
    console.log('All sync results:', JSON.stringify(allResults, null, 2));
    
    console.log('\n🎉 All Google Sheets sync tests completed!');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during sync test:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}, 2000);