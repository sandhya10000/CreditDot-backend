// Read-only diagnostic: why a franchise does not appear in its RM's panel.
// Usage: node scripts/diagnoseRm.js [franchiseName=test] [rmNameFragment=Swati]
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Franchise = require("../models/Franchise");
const User = require("../models/User");

const FRANCHISE_NAME = process.argv[2] || "test";
const RM_NAME = process.argv[3] || "Swaati";
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not defined in .env");
  await mongoose.connect(process.env.MONGODB_URI);

  const rmUsers = await User.find({
    name: new RegExp(escapeRegex(RM_NAME), "i"),
  })
    .select("name email staffCode staffRole isActive isDeleted")
    .populate("staffRole", "name isActive limitToOwnFranchises permissions")
    .lean();
  console.log(`\nUsers matching "${RM_NAME}": ${rmUsers.length}`);
  for (const u of rmUsers) {
    console.log({
      _id: String(u._id),
      name: u.name,
      staffCode: u.staffCode,
      isActive: u.isActive,
      isDeleted: u.isDeleted,
      role: u.staffRole
        ? {
            name: u.staffRole.name,
            isActive: u.staffRole.isActive,
            limitToOwnFranchises: u.staffRole.limitToOwnFranchises,
            hasFranchisesPermission: (u.staffRole.permissions || []).includes("franchises"),
          }
        : null,
    });
  }

  const franchises = await Franchise.find({
    businessName: new RegExp(`^${escapeRegex(FRANCHISE_NAME)}$`, "i"),
  })
    .select("businessName ownerName businessManager isDeleted kycStatus status")
    .lean();
  console.log(`\nFranchises named "${FRANCHISE_NAME}": ${franchises.length}`);
  for (const f of franchises) {
    const owner = f.businessManager
      ? rmUsers.find((u) => String(u._id) === String(f.businessManager))
      : null;
    console.log({
      _id: String(f._id),
      businessName: f.businessName,
      businessManager: f.businessManager ? String(f.businessManager) : null,
      matchesAnRmUserAbove: owner ? owner.name : "NO MATCH",
      isDeleted: f.isDeleted,
      kycStatus: f.kycStatus,
      status: f.status,
    });
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
