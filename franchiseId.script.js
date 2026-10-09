const mongoose = require("mongoose");
require("dotenv").config();

// .env se MongoDB URI lega
const MONGO_URI = process.env.MONGODB_URI;

async function updateFranchiseCodes() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env");
    }

    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected");

    const db = mongoose.connection.db;
    const collection = db.collection("franchises");

    // ============================================================
    // STEP 1: Find all old FI-XXX partner codes
    // ============================================================

    const partners = await collection
      .find({
        franchiseCode: {
          $regex: /^FI-\d+$/,
          $options: "i",
        },
      })
      .sort({ franchiseCode: 1 })
      .toArray();

    console.log(`Found ${partners.length} old FI codes`);

    if (partners.length === 0) {
      console.log("No FI-XXX franchise codes found.");
      return;
    }

    // ============================================================
    // STEP 2: Show what will be changed
    // ============================================================

    console.log("\n=================================");
    console.log("FRANCHISE CODE MIGRATION");
    console.log("=================================\n");

    const updates = [];

    for (const partner of partners) {
      const oldCode = partner.franchiseCode;

      // FI-001 -> 001
      const numberPart = oldCode.match(/\d+$/)?.[0];

      if (!numberPart) {
        console.log(`Skipping invalid code: ${oldCode}`);
        continue;
      }

      // FI-001 -> FP001
      const newCode = `FP${numberPart}`;

      updates.push({
        id: partner._id,
        oldCode,
        newCode,
      });

      console.log(`${oldCode}  ->  ${newCode}`);
    }

    console.log("\n=================================");
    console.log(`Total records to update: ${updates.length}`);
    console.log("=================================\n");

    // ============================================================
    // STEP 3: Check if any new FP codes already exist
    // ============================================================

    for (const item of updates) {
      const existingPartner = await collection.findOne({
        franchiseCode: item.newCode,
        _id: { $ne: item.id },
      });

      if (existingPartner) {
        throw new Error(
          `Duplicate code detected: ${item.newCode}. Migration stopped.`,
        );
      }
    }

    // ============================================================
    // STEP 4: Update all partners
    // ============================================================

    console.log("Starting database update...\n");

    let updatedCount = 0;

    for (const item of updates) {
      const result = await collection.updateOne(
        { _id: item.id },
        {
          $set: {
            franchiseCode: item.newCode,
          },
        },
      );

      if (result.modifiedCount === 1) {
        updatedCount++;

        console.log(`Updated: ${item.oldCode} -> ${item.newCode}`);
      }
    }

    // ============================================================
    // STEP 5: Final result
    // ============================================================

    console.log("\n=================================");
    console.log("MIGRATION COMPLETED");
    console.log("=================================");
    console.log(`Found:   ${partners.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log("=================================\n");
  } catch (error) {
    console.error("\nMigration failed:");
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}

updateFranchiseCodes();
