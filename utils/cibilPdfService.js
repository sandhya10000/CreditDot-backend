// Background renderer: IndiConnect CIBIL htmlUrl -> local PDF.
// Singleton Chromium (puppeteer-extra + stealth), max-concurrency queue.
// Failures are non-fatal by design: caller keeps htmlUrl link-only fallback.
const path = require("path");
const fs = require("fs");

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

let browserPromise = null;
let activeRenders = 0;
const waitQueue = [];

const getMaxConcurrent = () =>
  parseInt(process.env.CIBIL_PDF_MAX_CONCURRENT, 10) || 2;

const getTimeoutMs = () =>
  parseInt(process.env.CIBIL_PDF_TIMEOUT_MS, 10) || 60000;

const getBrowser = () => {
  if (!browserPromise) {
    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];
    const launchOpts = {
      headless: "new",
      args: launchArgs,
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browserPromise = puppeteer.launch(launchOpts).catch((err) => {
      browserPromise = null; // allow retry on next call
      throw err;
    });
  }
  return browserPromise;
};

const acquireSlot = () => {
  if (activeRenders < getMaxConcurrent()) {
    activeRenders += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
};

const releaseSlot = () => {
  activeRenders = Math.max(0, activeRenders - 1);
  const next = waitQueue.shift();
  if (next) {
    activeRenders += 1;
    next();
  }
};

// Render htmlUrl to outPath PDF. Resolves outPath, rejects on failure.
const renderHtmlUrlToPdf = async (htmlUrl, outPath) => {
  await acquireSlot();
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(htmlUrl, {
      waitUntil: "networkidle2",
      timeout: getTimeoutMs(),
    });
    const waitSelector = process.env.CIBIL_PDF_WAIT_SELECTOR || "body";
    try {
      await page.waitForSelector(waitSelector, { timeout: 15000 });
    } catch (_) {
      // Fall through: print whatever rendered (page may use canvas/no stable selector)
    }
    // Extra settle time for late JS rendering
    await new Promise((r) => setTimeout(r, 3000));
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
    });
    return outPath;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    releaseSlot();
  }
};

// Fire-and-forget wrapper for the credit controller:
// renders htmlUrl -> reports/credit_report_<reportId>_<ts>.pdf,
// updates CreditReport { localPath, pdfStatus }, never throws.
const renderCibilPdfInBackground = (CreditReport, reportId, htmlUrl) => {
  const reportsDir = path.join(__dirname, "../reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const filename = `credit_report_${reportId}_${Date.now()}.pdf`;
  const localFilePath = path.join(reportsDir, filename);

  renderHtmlUrlToPdf(htmlUrl, localFilePath)
    .then(async () => {
      await CreditReport.findByIdAndUpdate(reportId, {
        localPath: `/reports/${filename}`,
        pdfStatus: "ready",
      });
      console.log(`CIBIL PDF ready: ${filename}`);
    })
    .catch(async (err) => {
      console.error("CIBIL PDF RENDER FAILED:", err.message);
      try {
        await CreditReport.findByIdAndUpdate(reportId, {
          pdfStatus: "failed",
        });
      } catch (dbErr) {
        console.error("Failed to mark pdfStatus:", dbErr.message);
      }
      // stale partial file cleanup
      if (fs.existsSync(localFilePath)) {
        fs.unlink(localFilePath, () => {});
      }
    });
};

module.exports = {
  getBrowser,
  renderHtmlUrlToPdf,
  renderCibilPdfInBackground,
};
