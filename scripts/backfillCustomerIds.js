// One-off: convert CUST-000n customer IDs to the CD series, continuing after the
// highest existing CD<n> (e.g. CUST-0001 -> CD492 when CD491 is the max).
// Also sets the customerId counter so the next new customer continues the series.
// Usage: node scripts/backfillCustomerIds.js          (dry run, no writes)
//        node scripts/backfillCustomerIds.js --apply  (writes to DB)
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const APPLY = process.argv.includes("--apply");
const COUNTER_ID = "customerId";

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not defined in .env");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const forms = mongoose.connection.db.collection("businessforms");
  const counters = mongoose.connection.db.collection("franchisecounters");

  // Highest existing legacy/CD number
  const cdRows = await forms.find({ customerId: { $regex: /^CD\d+$/ } })
    .project({ customerId: 1 })
    .toArray();
  const cdMax = cdRows.reduce((m, r) => Math.max(m, parseInt(r.customerId.slice(2), 10)), 0);
  console.log(`Existing CD IDs: ${cdRows.length}, highest = CD${cdMax}`);

  // CUST rows in creation order
  const custRows = await forms.find({ customerId: { $regex: /^CUST-\d+$/ } })
    .sort({ createdAt: 1, _id: 1 })
    .project({ customerId: 1, customerName: 1, createdAt: 1 })
    .toArray();
  console.log(`CUST rows to convert: ${custRows.length}`);

  const plan = custRows.map((r, i) => ({
    _id: r._id,
    from: r.customerId,
    to: `CD${cdMax + 1 + i}`,
    name: r.customerName,
  }));

  // Safety: target IDs must not already exist
  const targets = plan.map((p) => p.to);
  const clashes = await forms.find({ customerId: { $in: targets } }).project({ customerId: 1 }).toArray();
  if (clashes.length) {
    throw new Error(`Target IDs already in use: ${clashes.map((c) => c.customerId).join(", ")}`);
  }

  for (const p of plan) {
    console.log(`${p.from}  ->  ${p.to}   (${p.name})`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  for (const p of plan) {
    const res = await forms.updateOne(
      { _id: p._id, customerId: p.from },
      { $set: { customerId: p.to } },
    );
    if (res.modifiedCount !== 1) throw new Error(`Failed to update ${p.from}`);
  }

  const last = cdMax + plan.length;
  await counters.updateOne(
    { _id: COUNTER_ID },
    { $set: { seq: last } },
    { upsert: true },
  );
  console.log(`\nDone. Converted ${plan.length} rows. Counter set to ${last}; next new ID = CD${last + 1}.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
