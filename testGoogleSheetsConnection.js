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
    console.log('Testing Google Sheets connection...\n');
    
    // Get settings from database
    const settings = await GoogleSheet.findOne();
    console.log('Settings found:', !!settings);
    
    if (!settings) {
      console.log('❌ No Google Sheets settings found in database');
      console.log('💡 Please configure Google Sheets integration in the admin panel first');
      process.exit(1);
    }
    
    console.log('Spreadsheet ID:', settings.spreadsheetId);
    console.log('Credentials exist:', !!settings.credentials);
    console.log('Integration active:', settings.isActive);
    
    if (!settings.isActive) {
      console.log('❌ Google Sheets integration is not active');
      console.log('💡 Please activate the integration in the admin panel');
      process.exit(1);
    }
    
    if (!settings.credentials) {
      console.log('❌ No credentials found');
      console.log('💡 Please upload your Google Service Account JSON credentials in the admin panel');
      process.exit(1);
    }
    
    // Try to initialize the service
    console.log('\n🔄 Initializing Google Sheets service...');
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      console.log('❌ Failed to initialize Google Sheets service');
      console.log('💡 Common causes and solutions:');
      console.log('   1. Invalid credentials JSON file - re-upload the correct service account JSON');
      console.log('   2. Service account not shared with spreadsheet - share spreadsheet with service account email as editor');
      console.log('   3. Wrong spreadsheet ID - verify the spreadsheet ID is correct');
      process.exit(1);
    }
    
    console.log('✅ Google Sheets service initialized successfully!');
    
    // Try to access the spreadsheet
    console.log('\n🔍 Testing spreadsheet access...');
    try {
      const spreadsheet = await googleSheetsService.sheets.spreadsheets.get({
        spreadsheetId: settings.spreadsheetId
      });
      
      console.log('✅ Successfully accessed spreadsheet!');
      console.log('Spreadsheet title:', spreadsheet.data.properties.title);
      console.log('Number of sheets:', spreadsheet.data.sheets.length);
      
      // List sheet names
      console.log('Sheet names:', spreadsheet.data.sheets.map(sheet => sheet.properties.title));
      
    } catch (accessError) {
      console.log('❌ Failed to access spreadsheet:', accessError.message);
      
      if (accessError.response && accessError.response.status === 403) {
        console.log('\n🔒 PERMISSION ERROR DETECTED:');
        console.log('   • The service account does NOT have access to this spreadsheet');
        console.log('   • Share the Google Sheet with the service account email as EDITOR');
        console.log('   • Service account email:', googleSheetsService.auth.email);
        console.log('   • Spreadsheet ID:', settings.spreadsheetId);
        console.log('\n   📝 To fix: Go to your Google Sheet > Share > Add people > Enter service account email > Select "Editor"');
      }
      
      process.exit(1);
    }
    
    console.log('\n🎉 Google Sheets connection test completed successfully!');
    console.log('💡 The service is properly configured and has access to the spreadsheet');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}, 2000);