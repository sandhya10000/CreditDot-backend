// Gives a franchise ID to every approved franchise that doesn't have one yet.
// Oldest approval first, so earlier partners get lower numbers.
// Dry run by default; pass --apply to write.
//
//   node scripts/backfillFranchiseCodes.js           (lists who would get an ID)
//   node scripts/backfillFranchiseCodes.js --apply   (assigns IDs)

require("dotenv").config();
const mongoose = require("mongoose");
const Franchise = require("../models/Franchise");
const generateFranchiseCode = require("../utils/generateFranchiseCode");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? "APPLY mode: writing changes" : "DRY RUN: no changes will be written");

  // Approved via KYC (kycStatus) or via registration approval (isActive)
  const targets = await Franchise.find({
    $and: [
      { $or: [{ franchiseCode: null }, { franchiseCode: "" }, { franchiseCode: { $exists: false } }] },
      { $or: [{ kycStatus: "approved" }, { isActive: true }] },
    ],
  })
    .sort({ kycApprovedAt: 1, createdAt: 1 })
    .select("businessName ownerName kycStatus isActive kycApprovedAt createdAt")
    .lean();

  console.log(`Found ${targets.length} approved franchise(s) without an ID`);

  if (!APPLY) {
    targets.forEach((f) =>
      console.log(`- ${f._id} | ${f.businessName || "(no name)"} | kyc=${f.kycStatus} | active=${f.isActive}`),
    );
  } else {
    for (const f of targets) {
      const code = await generateFranchiseCode();
      // updateOne skips save() hooks and validators on legacy documents
      await Franchise.updateOne({ _id: f._id }, { $set: { franchiseCode: code } });
      console.log(`+ ${code} -> ${f.businessName || f._id}`);
    }
  }

  await mongoose.disconnect();
  console.log("Done.");
};

run().catch(async (err) => {
  console.error("Failed:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});
