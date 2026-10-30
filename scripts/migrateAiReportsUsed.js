/**
 * Migration Script: Backfill aiReportsUsed and aiUsed from actual historical aianalyses documents.
 *
 * A report counts as "used" when an analysis file was actually saved
 * (claudeAnalysisHtml is not null/empty). Status fields are inconsistent across old
 * documents ("uploaded", "completed", "email_sent"), so the saved file is the proof.
 *
 * Safety & Modes:
 * - DRY_RUN is ON by default: prints per-franchise stats without writing.
 * - Pass --apply to write the updates.
 * - Idempotent: uses $set, never $inc.
 * - Warns if a franchise's backfilled count is >= 80% of its package limit.
 * - Warns if the new value is LOWER than the current stored value.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Franchise = require('../models/Franchise');
const AIAnalysis = require('../models/AIAnalysis');
const Package = require('../models/Package'); // needed so populate('assignedPackages') works
const { resolveFranchisePackageInfo } = require('../utils/aiLimitService');

async function runMigration() {
  const isApply = process.argv.includes('--apply');
  const isDryRun = !isApply;

  console.log('====================================================================');
  console.log('[MIGRATION] Backfill AI Reports Used');
  console.log(
    `[MIGRATION] MODE: ${
      isDryRun
        ? 'DRY-RUN (Simulating only, pass --apply to write)'
        : '*** APPLYING CHANGES TO DATABASE ***'
    }`
  );
  console.log('[MIGRATION] COUNT RULE: analyses with a saved claudeAnalysisHtml');
  console.log('====================================================================\n');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('[ERROR] MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log(
      'Connected to host:',
      mongoose.connection.host,
      '| db:',
      mongoose.connection.name,
      '\n'
    );

    const franchises = await Franchise.find({}).populate('assignedPackages').lean();
    console.log(`Found ${franchises.length} total franchises to evaluate.\n`);

    let updatedCount = 0;
    const warnings80Percent = [];
    const warningsLower = [];

    for (const franchise of franchises) {
      const fId = franchise._id;

      // Historical counts from the aianalyses collection
      const [totalCount, withReportCount, failedCount] = await Promise.all([
        AIAnalysis.countDocuments({ franchise: fId }),
        AIAnalysis.countDocuments({
          franchise: fId,
          claudeAnalysisHtml: { $nin: [null, ''] },
        }),
        AIAnalysis.countDocuments({ franchise: fId, claudeAnalysisStatus: 'failed' }),
      ]);

      const currentAiReportsUsed = franchise.aiReportsUsed ?? 0;
      const currentAiUsed = franchise.aiUsed ?? 0;
      const newCalculatedUsed = withReportCount;

      const pkgInfo = resolveFranchisePackageInfo(franchise);
      const pkgName = pkgInfo.packageName || 'None';
      const pkgLimit = pkgInfo.limit || 0;

      // Skip franchises with no analyses at all, to keep the output readable
      if (totalCount === 0 && currentAiReportsUsed === 0) {
        continue;
      }

      console.log('--------------------------------------------------------------------');
      console.log(
        `Franchise: ${franchise.businessName || franchise.name || 'Unnamed'} (${
          franchise.email || franchise.userId || 'no email on franchise doc'
        })`
      );
      console.log(`  _id:                   ${fId}`);
      console.log(`  Package:               ${pkgName} (Limit: ${pkgLimit})`);
      console.log(`  Current aiReportsUsed: ${currentAiReportsUsed} (aiUsed: ${currentAiUsed})`);
      console.log(
        `  Document counts:       Total: ${totalCount} | With report: ${withReportCount} | Failed: ${failedCount}`
      );
      console.log(`  New aiReportsUsed:     ${newCalculatedUsed}`);

      if (newCalculatedUsed < currentAiReportsUsed) {
        warningsLower.push({
          id: String(fId),
          current: currentAiReportsUsed,
          next: newCalculatedUsed,
        });
        console.warn(
          `  [!] WARNING: new value (${newCalculatedUsed}) is LOWER than current (${currentAiReportsUsed}).`
        );
      }

      if (pkgLimit > 0) {
        const usageRatio = newCalculatedUsed / pkgLimit;
        if (usageRatio >= 0.8) {
          const pct = Math.round(usageRatio * 100);
          warnings80Percent.push({
            franchiseId: String(fId),
            businessName: franchise.businessName || franchise.name,
            email: franchise.email,
            packageName: pkgName,
            pkgLimit,
            newCount: newCalculatedUsed,
            percentage: pct,
          });
          console.warn(
            `  [!] WARNING: New usage (${newCalculatedUsed}/${pkgLimit}, ${pct}%) reaches/exceeds 80% of package limit!`
          );
        }
      }

      if (!isDryRun) {
        await Franchise.updateOne(
          { _id: fId },
          { $set: { aiReportsUsed: newCalculatedUsed, aiUsed: newCalculatedUsed } }
        );
        console.log('  [OK] Updated in DB via $set.');
        updatedCount++;
      } else {
        console.log('  [DRY-RUN] No write performed.');
      }
    }

    console.log('\n====================================================================');
    console.log('MIGRATION SUMMARY');
    console.log('====================================================================');
    console.log(`Total franchises evaluated: ${franchises.length}`);
    if (isDryRun) {
      console.log("Dry-run complete. 0 database modifications made. Run with '--apply' to persist.");
    } else {
      console.log(`Applied updates to ${updatedCount} franchises via $set.`);
    }

    if (warningsLower.length > 0) {
      console.log('\n--------------------------------------------------------------------');
      console.log(`WARNING: ${warningsLower.length} franchise(s) would get a LOWER value than stored:`);
      warningsLower.forEach((w) => console.log(`- ${w.id}: ${w.current} -> ${w.next}`));
    }

    if (warnings80Percent.length > 0) {
      console.log('\n====================================================================');
      console.log(`WARNING: FRANCHISES AT OR ABOVE 80% OF PACKAGE CAPACITY (${warnings80Percent.length})`);
      console.log('====================================================================');
      warnings80Percent.forEach((w) => {
        console.log(`- ${w.businessName} (${w.email})`);
        console.log(
          `  ID: ${w.franchiseId} | Plan: ${w.packageName} | New Count: ${w.newCount} / ${w.pkgLimit} (${w.percentage}%)`
        );
      });
    } else {
      console.log('\nNo franchises reached 80% or more of their package capacity.');
    }

    console.log('====================================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };