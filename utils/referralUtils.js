const Setting = require('../models/Setting');
const Referral = require('../models/Referral');
const Franchise = require('../models/Franchise');

/**
 * Get referral bonus percentage for a package
 * @param {string} packageId - The package ID
 * @returns {Promise<number>} - The bonus percentage
 */
const getReferralBonusPercentage = async (packageId) => {
  try {
    // Get referral settings
    const referralSettings = await Setting.findOne({ key: 'referral_bonus_settings' });
    
    if (!referralSettings || !referralSettings.value) {
      // Return default bonus percentage if no settings found
      return 10; // 10% default bonus
    }
    
    // Find bonus percentage for the specific package
    const packageBonus = referralSettings.value.find(setting => 
      setting.packageId.toString() === packageId.toString()
    );
    
    return packageBonus ? packageBonus.bonusPercentage : 10;
  } catch (error) {
    console.error('Error getting referral bonus percentage:', error);
    return 10; // Default to 10% if error
  }
};

/**
 * Calculate referral bonus amount
 * @param {number} packagePrice - The price of the package
 * @param {number} bonusPercentage - The bonus percentage
 * @returns {number} - The bonus amount
 */
const calculateReferralBonus = (packagePrice, bonusPercentage) => {
  return Math.round((packagePrice * bonusPercentage) / 100);
};

/**
 * Process referral bonus when a referred user purchases a package
 * @param {string} referredFranchiseId - The ID of the franchise that made the purchase
 * @param {string} packageId - The ID of the purchased package
 * @param {number} packagePrice - The price of the purchased package
 */
const processReferralBonus = async (referredFranchiseId, packageId, packagePrice) => {
  try {
    // Find referral record for this franchise
    const referral = await Referral.findOne({ 
      referredFranchiseId: referredFranchiseId,
      status: { $in: ['registered', 'purchased'] }
    }).populate('referrerFranchiseId');
    
    if (!referral) {
      console.log('No referral found for this franchise');
      return;
    }
    
    // Get bonus percentage for this package
    const bonusPercentage = await getReferralBonusPercentage(packageId);
    
    // Calculate bonus amount
    const bonusAmount = calculateReferralBonus(packagePrice, bonusPercentage);
    
    // Update referral record
    referral.status = 'credited';
    referral.bonusAmount = bonusAmount;
    referral.packageId = packageId;
    referral.creditedAt = new Date();
    await referral.save();
    
    // Add credits to referrer's franchise
    if (referral.referrerFranchiseId) {
      referral.referrerFranchiseId.credits += bonusAmount;
      referral.referrerFranchiseId.totalCreditsPurchased += bonusAmount;
      await referral.referrerFranchiseId.save();
    }
    
    console.log(`Referral bonus of ${bonusAmount} credits processed for referral ${referral._id}`);
  } catch (error) {
    console.error('Error processing referral bonus:', error);
  }
};

/**
 * Initialize default referral settings
 */
const initializeReferralSettings = async () => {
  try {
    const existingSettings = await Setting.findOne({ key: 'referral_bonus_settings' });
    
    if (!existingSettings) {
      // Create default referral settings
      const defaultSettings = new Setting({
        key: 'referral_bonus_settings',
        value: [],
        description: 'Referral bonus percentages by package'
      });
      
      await defaultSettings.save();
      console.log('Default referral settings initialized');
    }
  } catch (error) {
    console.error('Error initializing referral settings:', error);
  }
};

module.exports = {
  getReferralBonusPercentage,
  calculateReferralBonus,
  processReferralBonus,
  initializeReferralSettings
};