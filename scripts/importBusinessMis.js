/*
 * Import "Business MIS.xlsx" into the BusinessForm collection and assign each
 * MIS to the RM (Franchise.businessManager) of its franchise.
 *
 * Usage (from CreditDot-backend/):
 *   node scripts/importBusinessMis.js          # dry run, writes nothing
 *   node scripts/importBusinessMis.js --apply  # upserts into the DB
 *
 * Rows are upserted by customerId (Cust ID), so re-running is safe and a
 * duplicate Cust ID overwrites the earlier record (last row wins).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const xlsx = require("xlsx");
const Franchise = require("../models/Franchise");
const BusinessForm = require("../models/BusinessForm");

const APPLY = process.argv.includes("--apply");
const FILE = path.join(__dirname, "..", "Business MIS.xlsx");

// Excel serial date -> JS Date (UTC)
const excelDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/franchise_management";
  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);

  const wb = xlsx.readFile(FILE);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`Excel rows: ${rows.length}`);

  // Franchise code -> { franchiseId, rmId } cache
  const franchiseCache = new Map();
  const report = { assigned: 0, unassignedBlank: 0, franchiseNoRm: 0, unknownFranchise: [], written: 0 };

  const ops = [];
  for (const r of rows) {
    const code = str(r["Franchise ID"]).toUpperCase();
    let franchiseId = null;
    let assignedRm = null;
    let entrySource = "Direct Login";

    if (!code) {
      report.unassignedBlank++;
    } else {
      if (!franchiseCache.has(code)) {
        const f = await Franchise.findOne({
          franchiseCode: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        }).select("_id businessManager");
        franchiseCache.set(code, f ? { franchiseId: f._id, rmId: f.businessManager || null } : null);
      }
      const hit = franchiseCache.get(code);
      if (hit) {
        franchiseId = hit.franchiseId;
        assignedRm = hit.rmId;
        entrySource = "Franchise";
        if (assignedRm) report.assigned++;
        else report.franchiseNoRm++;
      } else {
        report.unknownFranchise.push(code);
      }
    }

    const customerId = str(r["Cust ID"]);
    const payment = num(r["Payment Amount"]);
    const aadhar = str(r["Aadhar Card"]).replace(/\s+/g, "");
    const doc = {
      franchiseId,
      assignedRm,
      entrySource,
      customerType: "individual",
      customerId,
      customerName: str(r["Name"]),
      fatherName: str(r["Father Name"]),
      gender: str(r["Gender"]),
      customerPhone: str(r["Mobile Number"]),
      whatsappNumber: str(r["Whats App"]),
      customerEmail: str(r["Email ID"]).toLowerCase(),
      dob: excelDate(r["DOB"]),
      fullAddress: str(r["Address"]),
      city: str(r["City"]),
      state: str(r["State"]),
      pincode: str(r["Pin Code"]),
      monthlyIncome: num(r["Monthly Income"]),
      profession: str(r["Profession"]),
      occupation: str(r["Occupation"]),
      language: str(r["Language"]),
      panNumber: str(r["PAN"]).toUpperCase(),
      aadharNumber: aadhar,
      creditScore: str(r["Present Credit Score"]),
      manualAmount: payment,
      paymentStatus: payment > 0 ? "paid" : "pending",
      workStatus: "in_progress",
      isRead: true,
      createdAt: excelDate(r["Date"]) || new Date(),
      updatedAt: new Date(),
    };

    ops.push({
      replaceOne: { filter: { customerId }, replacement: doc, upsert: true },
    });
  }

  console.log("\n--- Report ---");
  console.log(`Rows to import:            ${ops.length}`);
  console.log(`Assigned to an RM:         ${report.assigned}`);
  console.log(`Franchise found, no RM:    ${report.franchiseNoRm}`);
  console.log(`Blank Franchise ID (unassigned): ${report.unassignedBlank}`);
  console.log(`Franchise code not in DB:  ${report.unknownFranchise.length}${report.unknownFranchise.length ? " -> " + [...new Set(report.unknownFranchise)].join(", ") : ""}`);
  const existing = await BusinessForm.collection.countDocuments();
  console.log(`Existing BusinessForm docs: ${existing} (will be overwritten on matching Cust ID)`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  await BusinessForm.syncIndexes();
  const res = await BusinessForm.collection.bulkWrite(ops, { ordered: false });
  report.written = res.upsertedCount + res.modifiedCount;
  console.log(`\nInserted: ${res.upsertedCount}, updated (duplicates): ${res.modifiedCount}`);
  console.log(`Collection count now: ${await BusinessForm.collection.countDocuments()}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Import failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
