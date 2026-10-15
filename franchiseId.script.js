const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGODB_URI;

async function updateFranchiseCodes() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGODB_URI is not defined in .env");
    }

    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected");

    const db = mongoose.connection.db;
    const collection = db.collection("franchises");

    // ============================================================
    // STEP 1: Find FP001, FP002, FP003... codes
    // ============================================================

    const partners = await collection
      .find({
        franchiseCode: {
          $regex: /^FP\d+$/i,
        },
      })
      .sort({ franchiseCode: 1 })
      .toArray();

    console.log(`Found ${partners.length} FP codes`);

    if (partners.length === 0) {
      console.log("No FP001, FP002... franchise codes found.");
      return;
    }

    // ============================================================
    // STEP 2: Prepare updates
    // ============================================================

    console.log("\n=================================");
    console.log("FRANCHISE CODE MIGRATION");
    console.log("=================================\n");

    const updates = [];

    for (const partner of partners) {
      const oldCode = partner.franchiseCode;

      // FP001 -> 001
      const numberPart = oldCode.match(/\d+$/)?.[0];

      if (!numberPart) {
        console.log(`Skipping invalid code: ${oldCode}`);
        continue;
      }

      // FP001 -> FP-001
      const newCode = `FP-${numberPart}`;

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
    // STEP 3: Check duplicate FP-XXX codes
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
    // STEP 4: Update database
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
