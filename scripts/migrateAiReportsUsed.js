/**
 * Migration Script: Initialize aiReportsUsed to 0 for all existing franchise records.
 * Ensures consistent schema default across existing data.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Franchise = require('../models/Franchise');

async function runMigration() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    // 1. Update any franchise without aiReportsUsed field set
    const updateResult = await Franchise.updateMany(
      { aiReportsUsed: { $exists: false } },
      { $set: { aiReportsUsed: 0 } }
    );
    console.log(`Updated ${updateResult.modifiedCount} franchises lacking aiReportsUsed.`);

    // 2. Also ensure null or undefined values are reset to 0
    const nullResult = await Franchise.updateMany(
      { aiReportsUsed: null },
      { $set: { aiReportsUsed: 0 } }
    );
    console.log(`Updated ${nullResult.modifiedCount} franchises with null aiReportsUsed.`);

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = runMigration;
