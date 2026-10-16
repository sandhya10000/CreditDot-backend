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

    const collection = mongoose.connection.db.collection("franchises");

    // STEP 1: Find FP-001, FP-002, FP-003... codes
    const partners = await collection
      .find({
        franchiseCode: {
          $regex: /^FP-\d+$/i,
        },
      })
      .toArray();

    console.log(`Found ${partners.length} FP- codes`);

    if (partners.length === 0) {
      console.log("No FP-001, FP-002... codes found.");
      return;
    }

    // STEP 2: Prepare migration
    const updates = [];

    console.log("\nFRANCHISE CODE MIGRATION\n");

    for (const partner of partners) {
      const oldCode = partner.franchiseCode;
      const numberPart = oldCode.match(/\d+$/)?.[0];

      if (!numberPart) {
        console.log(`Skipping invalid code: ${oldCode}`);
        continue;
      }

      // FP-001 -> FP001
      const newCode = `FP${numberPart}`;

      updates.push({
        id: partner._id,
        oldCode,
        newCode,
      });

      console.log(`${oldCode} -> ${newCode}`);
    }

    // STEP 3: Check duplicates before updating
    const newCodes = new Set();

    for (const item of updates) {
      if (newCodes.has(item.newCode)) {
        throw new Error(`Duplicate target code: ${item.newCode}`);
      }

      newCodes.add(item.newCode);

      const existingPartner = await collection.findOne({
        franchiseCode: item.newCode,
        _id: { $ne: item.id },
      });

      if (existingPartner) {
        throw new Error(
          `Code ${item.newCode} already exists. Migration stopped.`,
        );
      }
    }

    // STEP 4: Update database
    console.log("\nStarting database update...\n");

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

    // STEP 5: Final result
    console.log("\n=================================");
    console.log("MIGRATION COMPLETED");
    console.log("=================================");
    console.log(`Found:   ${partners.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log("=================================");
  } catch (error) {
    console.error("\nMigration failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}

updateFranchiseCodes();
