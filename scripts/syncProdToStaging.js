/**
 * Copy the production database into the staging database.
 *
 *   npm run sync:staging                    (asks you to type the target database name)
 *   npm run sync:staging -- --yes           (no prompt)
 *   npm run sync:staging -- --restore-only  (retry the upload from the dump kept by a failed run)
 *
 * Reads from .env:
 *   SYNC_SOURCE_URI   production, READ-ONLY user, with the database name  (.../test)
 *   SYNC_TARGET_URI   staging cluster, with the database name             (.../creditdost_staging)
 *   SYNC_EXCLUDE_COLLECTIONS  optional, comma-separated
 *
 * Needs MongoDB Database Tools (mongodump / mongorestore) on PATH.
 * The target database is REPLACED (mongorestore --drop). Indexes are copied too.
 * The dump contains customer data: it lives in a temp folder and is deleted after a successful
 * restore. If only the restore fails, the dump is KEPT so --restore-only can retry without
 * downloading production again; delete it yourself if you give up.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

// Split a connection string into host, database name and the URI without the database
const parseUri = (name, value) => {
  if (!value) fail(`${name} is not set in .env`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid MongoDB connection string`);
  }
  if (!/^mongodb(\+srv)?:$/.test(url.protocol)) fail(`${name} must start with mongodb:// or mongodb+srv://`);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!db) fail(`${name} must include the database name, e.g. ...mongodb.net/creditdost_staging`);
  const host = url.host.toLowerCase();
  url.pathname = "/";
  return { host, db, uriWithoutDb: url.toString() };
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (err) =>
      reject(
        err.code === "ENOENT"
          ? new Error(`${command} not found. Install MongoDB Database Tools and add them to PATH.`)
          : err,
      ),
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
  });

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

(async () => {
  const source = parseUri("SYNC_SOURCE_URI", process.env.SYNC_SOURCE_URI);
  const target = parseUri("SYNC_TARGET_URI", process.env.SYNC_TARGET_URI);
  const excluded = (process.env.SYNC_EXCLUDE_COLLECTIONS || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // Safety: never restore onto the production cluster
  if (source.host === target.host) {
    fail("SYNC_TARGET_URI points at the same cluster as SYNC_SOURCE_URI. The target must be the staging cluster.");
  }
  // Reminder if this .env's app connection is still production
  try {
    if (process.env.MONGODB_URI && new URL(process.env.MONGODB_URI).host.toLowerCase() === source.host) {
      console.warn(
        "⚠ MONGODB_URI in this .env still points at the PRODUCTION cluster. " +
          "After the sync, change it to the staging cluster.",
      );
    }
  } catch {
    // MONGODB_URI unparseable: nothing to compare
  }

  console.log("\nProduction → staging copy");
  console.log(`  from: ${source.host} / ${source.db}`);
  console.log(`  to:   ${target.host} / ${target.db}   (existing data there will be REPLACED)`);
  if (excluded.length) console.log(`  skipping: ${excluded.join(", ")}`);

  if (!process.argv.includes("--yes")) {
    const typed = await ask(`\nType the target database name (${target.db}) to continue: `);
    if (typed !== target.db) fail("Cancelled.");
  }

  // Fixed location so a failed restore can be retried with --restore-only
  const dumpDir = path.join(os.tmpdir(), "creditdost-sync-dump");
  const removeDump = () => fs.rmSync(dumpDir, { recursive: true, force: true });
  const restoreOnly = process.argv.includes("--restore-only");
  const started = Date.now();

  // 1/2 Dump (skipped with --restore-only)
  if (restoreOnly) {
    if (!fs.existsSync(path.join(dumpDir, source.db))) {
      fail(`No saved dump found at ${dumpDir}. Run without --restore-only to dump production first.`);
    }
    console.log(`\nUsing the saved dump at ${dumpDir}`);
  } else {
    removeDump(); // never mix an old dump with a new one
    try {
      console.log("\n1/2 Dumping production (read-only)...");
      await run("mongodump", [
        `--uri=${source.uriWithoutDb}`,
        `--db=${source.db}`,
        `--out=${dumpDir}`,
        "--gzip",
        ...excluded.map((c) => `--excludeCollection=${c}`),
      ]);
    } catch (err) {
      removeDump(); // a partial dump is useless and holds customer data
      fail(`Dump failed: ${err.message}`);
    }
  }

  // 2/2 Restore: one collection at a time (gentle on small/free clusters), retried on
  // network errors. --drop makes every attempt start the collections from scratch.
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      console.log(`\n2/2 Restoring into staging (attempt ${attempt} of ${ATTEMPTS})...`);
      await run("mongorestore", [
        `--uri=${target.uriWithoutDb}`,
        `--nsFrom=${source.db}.*`,
        `--nsTo=${target.db}.*`,
        "--drop",
        "--gzip",
        "--numParallelCollections=1",
        dumpDir,
      ]);
      removeDump(); // success: don't leave customer data on disk
      console.log(`\n✔ Done in ${Math.round((Date.now() - started) / 1000)}s.`);
      console.log(`  Point staging's MONGODB_URI at ${target.host}/${target.db} and set DISABLE_BACKGROUND_JOBS=true.\n`);
      return;
    } catch (err) {
      console.error(`\n✖ Restore attempt ${attempt} failed: ${err.message}`);
      if (attempt < ATTEMPTS) {
        console.log("  Retrying in 20 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 20000));
      }
    }
  }

  // Keep the dump so the upload can be retried without downloading production again
  console.error(
    `\n✖ Restore failed ${ATTEMPTS} times. The dump is kept at:\n    ${dumpDir}\n` +
      "  Retry the upload with:  npm run sync:staging -- --restore-only\n" +
      "  It contains customer data: delete that folder when you are finished.\n",
  );
  process.exitCode = 1;
})();
