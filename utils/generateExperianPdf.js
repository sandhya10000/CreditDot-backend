const puppeteer = require("puppeteer");
const experianReportTemplate = require("../templates/experianReport.template");

const generateExperianPdf = async (result, creditReportId) => {
  let browser;

  try {
    // Step 1: Extract actual Experian report data
    const reportData =
      result?.data?.verify?.result || result?.verify?.result || result;

    if (!reportData || typeof reportData !== "object") {
      throw new Error("Invalid Experian report data");
    }

    // Step 2: Generate HTML using the template
    const html = experianReportTemplate(reportData);

    // Step 3: Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Step 4: Load HTML
    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    // Step 5: Generate PDF buffer
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    // Convert output to Node.js Buffer if required
    const finalBuffer = Buffer.from(pdfBuffer);

    console.log("PDF output type:", finalBuffer.constructor.name);
    console.log("PDF size:", finalBuffer.length, "bytes");

    return finalBuffer;
  } catch (error) {
    console.error(
      "Experian PDF generation failed:",
      error.stack || error.message,
    );
    throw error;
  } finally {
    // Close browser only once
    if (browser) {
      await browser.close();
    }
  }
};

module.exports = generateExperianPdf;
