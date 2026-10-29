// One-off: assign Business Managers (RMs) to franchises from franchise_with_rm.xlsx.
// Usage: node scripts/assignRmFromExcel.js          (dry run, no writes)
//        node scripts/assignRmFromExcel.js --apply  (writes to DB)
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Franchise = require("../models/Franchise");
const User = require("../models/User");

const FILE = path.join(__dirname, "..", "franchise_with_rm.xlsx");
const SHEET = "Franchise with RM";
const APPLY = process.argv.includes("--apply");
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not defined in .env");

  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: "" });
  console.log(`Read ${rows.length} rows from "${SHEET}"`);

  // Resolve each distinct RM name once
  const rmNames = [...new Set(rows.map((r) => String(r["RM Name"]).trim()))].filter(
    (n) => n && n.toLowerCase() !== "not found"
  );

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const rmMap = {};
  for (const name of rmNames) {
    // Sheet has first names only; RMs are active staff accounts with an RM-n staffCode
    const matches = await User.find({
      name: new RegExp(`^${escapeRegex(name)}(\\s|$)`, "i"),
      staffCode: { $exists: true, $ne: null },
      isDeleted: { $ne: true },
    }).select("name email staffCode");
    if (matches.length !== 1) {
      console.error(`ABORT: RM "${name}" matched ${matches.length} users:`, matches.map((u) => `${u.name} <${u.email}> ${u.staffCode || ""}`));
      await mongoose.disconnect();
      process.exit(1);
    }
    rmMap[name.toLowerCase()] = matches[0];
    console.log(`RM "${name}" -> ${matches[0].name} <${matches[0].email}> (${matches[0]._id})`);
  }

  const stats = { assigned: 0, unchanged: 0, overwritten: 0, notFoundRm: 0, franchiseMissing: 0, noFranchiseId: 0 };
  const missing = [];

  for (const r of rows) {
    const code = String(r["Franchise ID"]).trim();
    const rmName = String(r["RM Name"]).trim();
    if (!rmName || rmName.toLowerCase() === "not found") {
      stats.notFoundRm++;
      continue;
    }
    if (!code) {
      stats.noFranchiseId++;
      continue;
    }

    const rm = rmMap[rmName.toLowerCase()];
    const franchise = await Franchise.findOne({
      franchiseCode: new RegExp(`^${escapeRegex(code)}$`, "i"),
    });
    if (!franchise) {
      stats.franchiseMissing++;
      missing.push(code);
      continue;
    }

    const current = franchise.businessManager ? franchise.businessManager.toString() : null;
    if (current === rm._id.toString()) {
      stats.unchanged++;
      continue;
    }
    if (current) stats.overwritten++;
    else stats.assigned++;

    if (APPLY) {
      await Franchise.updateOne({ _id: franchise._id }, { $set: { businessManager: rm._id } });
    }
  }

  console.log("\nSummary:", stats);
  if (missing.length) console.log("Franchise codes not in DB:", missing);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
