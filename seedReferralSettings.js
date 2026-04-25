const mongoose = require('mongoose');
const Setting = require('./models/Setting');
const Package = require('./models/Package');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Connect to database
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/franchise_management', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const seedReferralSettings = async () => {
  try {
    console.log('Seeding referral settings...');
    
    // Get all packages
    const packages = await Package.find({});
    
    // Create default referral settings
    const defaultSettings = packages.map(pkg => ({
      packageId: pkg._id,
      bonusPercentage: pkg.price < 5000 ? 5 : pkg.price < 8000 ? 10 : 15
    }));
    
    // Check if settings already exist
    const existingSettings = await Setting.findOne({ key: 'referral_bonus_settings' });
    
    if (existingSettings) {
      console.log('Referral settings already exist');
      process.exit(0);
    }
    
    // Create new settings
    const settings = new Setting({
      key: 'referral_bonus_settings',
      value: defaultSettings,
      description: 'Referral bonus percentages by package'
    });
    
    await settings.save();
    
    console.log('Referral settings created successfully');
    console.log('Settings:', defaultSettings);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding referral settings:', error);
    process.exit(1);
  }
};

seedReferralSettings();