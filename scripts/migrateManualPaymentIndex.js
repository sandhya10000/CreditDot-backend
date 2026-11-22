// One-off (Cashfree migration): make ManualPayment.razorpayLinkId unique + sparse.
// The old index was unique but not sparse, so a second Cashfree link (no razorpayLinkId)
// would fail with a duplicate-key error. Run once before deploying the Cashfree code.
// Usage: node scripts/migrateManualPaymentIndex.js          (dry run, no writes)
//        node scripts/migrateManualPaymentIndex.js --apply  (writes to DB)
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const ManualPayment = require("../models/ManualPayment");

const APPLY = process.argv.includes("--apply");

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not defined in .env");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const collection = ManualPayment.collection;
  const indexes = await collection.indexes().catch(() => []);
  const legacy = indexes.find((i) => i.name === "razorpayLinkId_1");

  if (legacy && !legacy.sparse) {
    console.log("Found non-sparse index razorpayLinkId_1 -> will drop and recreate as sparse");
    if (APPLY) await collection.dropIndex("razorpayLinkId_1");
  } else {
    console.log("razorpayLinkId_1 is already sparse or missing, nothing to drop");
  }

  if (APPLY) {
    await ManualPayment.createIndexes();
    console.log("Indexes now:", (await collection.indexes()).map((i) => i.name).join(", "));
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
