const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const BankStatementAnalysis = require('../models/BankStatementAnalysis');

// Pipeline Modules
const pipelineExtractor = require('../utils/bsa/bankStatementExtractor');
const { classifyTransactions } = require('../utils/bsa/bankStatementClassifier');
const { computeBankAnalytics } = require('../utils/bsa/bankStatementEngine');
const { generateNarrative } = require('../utils/bsa/bankStatementNarrativeService');
const { renderBankStatementReportHtml } = require('../utils/bsa/bankStatementHtmlRenderer');
const pipelinePdf = require('../utils/bsa/pdfGenerator');

// Storage Directories
const REPORT_DIR = path.join(__dirname, '..', 'reports', 'bsa');
fs.mkdirSync(REPORT_DIR, { recursive: true });

// Concurrency queue for background BSA jobs
const MAX_CONCURRENT_JOBS = parseInt(process.env.BSA_MAX_CONCURRENT_JOBS, 10) || 2;
let activeJobCount = 0;
const jobQueue = [];

function pumpJobQueue() {
  while (activeJobCount < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const nextJob = jobQueue.shift();
    activeJobCount++;
    (async () => {
      try {
        await executeStatementJob(nextJob.docId, nextJob.pdfBuffer, nextJob.originalFileName, nextJob.password);
      } catch (err) {
        console.error(`[bsa-queue] Uncaught execution error for doc ${nextJob.docId}:`, err.message);
      } finally {
        activeJobCount--;
        setImmediate(pumpJobQueue);
      }
    })();
  }
}

function enqueueJob(docId, pdfBuffer, originalFileName, password = '') {
  jobQueue.push({ docId, pdfBuffer, originalFileName, password });
  pumpJobQueue();
}

/**
 * Validates PDF encryption and check whether password is required using pdf-lib
 */
async function verifyPdfEncryption(fileBuffer, password = '') {
  try {
    const pdfDoc = await PDFDocument.load(fileBuffer, { password: password || undefined, ignoreEncryption: false });
    return {
      status: 'OK',
      pageCount: pdfDoc.getPageCount(),
    };
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('encrypt') || msg.includes('password')) {
      return {
        status: password ? 'INCORRECT_PASSWORD' : 'PASSWORD_PROTECTED',
        code: password ? 'INCORRECT_PASSWORD' : 'PASSWORD_PROTECTED',
        message: password
          ? 'Incorrect password for this bank statement. Please check and try again.'
          : 'This bank statement is password-protected. Please enter the password to unlock.',
      };
    }
    return {
      status: 'INVALID_FORMAT',
      code: 'INVALID_FORMAT',
      message: 'The uploaded file is not a valid or readable PDF document.',
    };
  }
}

const removeTmp = (filePath) => {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
};

const maskAccount = (num) => {
  const s = String(num || '').trim();
  return s.length > 4 ? `${'X'.repeat(s.length - 4)}${s.slice(-4)}` : s || null;
};

const publicView = (doc) => {
  if (!doc) return null;
  return {
    id: doc._id,
    fileName: doc.fileName,
    status: doc.status,
    accountHolderName: doc.accountHolderName,
    bankName: doc.bankName,
    accountNumberMasked: doc.accountNumberMasked,
    statementFrom: doc.statementFrom,
    statementTo: doc.statementTo,
    pageCount: doc.pageCount,
    openingBalance: doc.openingBalance,
    closingBalance: doc.closingBalance,
    totalCredits: doc.totalCredits,
    totalDebits: doc.totalDebits,
    reconciliationStatus: doc.reconciliationStatus,
    analytics: doc.analytics,
    narrative: doc.narrative,
    failureReason: doc.failureReason,
    errorCode: doc.errorCode,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/**
 * Background Statement Processing Worker
 */
async function executeStatementJob(docId, pdfBuffer, originalFileName, password = '') {
  let doc = null;
  try {
    doc = await BankStatementAnalysis.findById(docId);
    if (!doc) return;

    // 1. Extraction and Reconciliation Gate
    let extractionResult;
    try {
      extractionResult = await pipelineExtractor.extractAndReconcile(pdfBuffer, { allowPartial: true, password });
    } catch (err) {
      console.log(`[bsa] Extraction stopped for doc ${docId}:`, err.message);
      doc.status = 'Failed';
      doc.failureReason = err.userMessage || err.message || 'We could not extract transactions from this bank statement.';
      doc.errorCode = err.code || 'RECONCILIATION_FAILED';
      doc.failedAt = new Date();
      await doc.save();
      return;
    }

    const extractedData = extractionResult.data;

    // Transition to Finalizing
    doc.status = 'Finalizing';
    doc.pageCount = extractedData.pageCount || extractionResult.stats?.pageCount || 1;
    doc.accountHolderName = extractedData.accountHolderName || extractedData.accountProfile?.holderName || null;
    doc.bankName = extractedData.bankName || extractedData.accountProfile?.bankName || null;
    doc.accountNumberMasked = maskAccount(extractedData.accountNumber || extractedData.accountProfile?.accountNumberMasked);
    doc.statementFrom = extractedData.statementFrom || extractedData.accountProfile?.periodStart || null;
    doc.statementTo = extractedData.statementTo || extractedData.accountProfile?.periodEnd || null;
    doc.openingBalance = extractedData.openingBalance || 0;
    doc.closingBalance = extractedData.closingBalance || 0;
    doc.totalCredits = extractedData.totalCredits || 0;
    doc.totalDebits = extractedData.totalDebits || 0;
    doc.reconciliationStatus = extractedData.reconciliation?.status || extractionResult.reconciliation?.status || 'VERIFIED';
    await doc.save();

    // 2. Classification
    const classifiedTxs = await classifyTransactions(
      extractedData.transactions,
      extractedData.accountHolderName,
      { useClaudeFallback: false }
    );

    // 3. Analytics Engine
    const analytics = computeBankAnalytics(extractedData, classifiedTxs);

    // 4. Qualitative Narrative (via Claude Haiku or deterministic fallback)
    const narrative = await generateNarrative(analytics);

    // 5. HTML Rendering
    const html = renderBankStatementReportHtml({
      extractedData,
      analytics,
      narrative,
      classifiedTransactions: classifiedTxs,
      reportMetadata: {
        fileName: originalFileName,
        generatedAt: new Date().toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        }),
      },
    });

    // 6. PDF Generation (Headless Puppeteer)
    let pdfBufferGenerated;
    try {
      pdfBufferGenerated = await pipelinePdf.generatePdfFromHtml(html);
    } catch (pdfErr) {
      console.error(`[bsa] PDF generation failed for doc ${docId}:`, pdfErr.message);
      doc.status = 'Failed';
      doc.failureReason = 'Report PDF generation encountered an error.';
      doc.errorCode = 'PDF_GENERATION_FAILED';
      doc.failedAt = new Date();
      await doc.save();
      return;
    }

    const relFileName = `${String(doc._id)}.pdf`;
    const absPdfPath = path.join(REPORT_DIR, relFileName);
    fs.writeFileSync(absPdfPath, pdfBufferGenerated);

    const relHtmlName = `${String(doc._id)}.html`;
    const absHtmlPath = path.join(REPORT_DIR, relHtmlName);
    fs.writeFileSync(absHtmlPath, html, 'utf8');

    // 7. Save Success State
    doc.status = 'Success';
    doc.localPath = relFileName;
    doc.htmlPath = relHtmlName;
    doc.narrative = narrative;
    doc.analytics = {
      kpis: analytics.kpis,
      scorecard: analytics.scorecard,
      obligations: analytics.recurringObligations,
      circularEvents: analytics.flaggedCircularEvents,
      creditCardRotations: analytics.creditCardRotations || [],
      bounceEvents: analytics.bounceEvents || [],
      internalMovements: analytics.internalMovements || { count: 0, totalCredits: 0, totalDebits: 0, items: [] },
      amlIndicators: analytics.amlIndicators,
      monthlyBreakdown: analytics.monthlySummary || [],
      spendingCategories: analytics.spendingCategories || [],
    };
    await doc.save();

    console.log(`[bsa] Analysis completed successfully for doc ${docId}`);
  } catch (err) {
    console.error(`[bsa] Background processing error for doc ${docId}:`, err.message);
    if (doc) {
      try {
        doc.status = 'Failed';
        doc.failureReason = 'An unexpected error occurred during processing.';
        doc.failedAt = new Date();
        await doc.save();
      } catch (saveErr) {
        console.error(`[bsa] Failed to save failure state for doc ${docId}:`, saveErr.message);
      }
    }
  }
}

// POST /api/bsa/analyze
exports.analyze = async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User authentication required' });
    }
    if (!req.file || !tmpPath) {
      return res.status(400).json({ success: false, message: 'Please upload the bank statement PDF.' });
    }

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(tmpPath);
    } catch (readErr) {
      return res.status(400).json({ success: false, message: 'Could not read uploaded statement file.' });
    }

    // Check PDF header
    if (fileBuffer.slice(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FORMAT',
        message: 'The uploaded file is not a valid PDF document.',
      });
    }

    const password = req.body?.password != null ? String(req.body.password).trim() : '';

    const pdfAuthCheck = await verifyPdfEncryption(fileBuffer, password);
    if (pdfAuthCheck.status === 'PASSWORD_PROTECTED') {
      return res.status(400).json({
        success: false,
        requiresPassword: true,
        code: 'PASSWORD_PROTECTED',
        message: 'This bank statement is password-protected. Please enter the password to unlock.',
      });
    }

    if (pdfAuthCheck.status === 'INCORRECT_PASSWORD') {
      return res.status(400).json({
        success: false,
        requiresPassword: true,
        code: 'INCORRECT_PASSWORD',
        message: 'Incorrect password for this statement. Please check and try again.',
      });
    }

    if (pdfAuthCheck.status !== 'OK') {
      return res.status(400).json({
        success: false,
        code: pdfAuthCheck.code || 'INVALID_FORMAT',
        message: pdfAuthCheck.message || 'Corrupted or unreadable PDF structure.',
      });
    }

    // Create DB entry in Processing state
    const doc = await BankStatementAnalysis.create({
      userId,
      fileName: req.file.originalname,
      status: 'Processing',
    });

    // Enqueue background analysis
    enqueueJob(doc._id, fileBuffer, req.file.originalname, password);

    return res.status(201).json({ success: true, id: doc._id, status: 'Processing' });
  } catch (err) {
    console.error('[bsa] analyze error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not start the analysis. Please try again.' });
  } finally {
    removeTmp(tmpPath);
  }
};

// GET /api/bsa/:id
exports.getStatus = async (req, res) => {
  try {
    const doc = await BankStatementAnalysis.findById(req.params.id);
    if (!doc || String(doc.userId) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    return res.json({ success: true, data: publicView(doc) });
  } catch (err) {
    console.error('[bsa] getStatus error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not fetch analysis status.' });
  }
};

// GET /api/bsa/my-analyses
exports.getMyAnalyses = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const perPage = Math.min(parseInt(limit, 10) || 20, 100);
    const query = { userId: req.user._id };
    if (status === 'Success' || status === 'Failed') query.status = status;
    if (search) {
      const rx = { $regex: String(search).trim(), $options: 'i' };
      query.$or = [{ fileName: rx }, { accountHolderName: rx }, { bankName: rx }];
    }
    const [total, rows] = await Promise.all([
      BankStatementAnalysis.countDocuments(query),
      BankStatementAnalysis.find(query)
        .sort({ createdAt: -1 })
        .skip((parseInt(page, 10) - 1) * perPage)
        .limit(perPage)
        .lean(),
    ]);
    return res.json({
      success: true,
      data: rows.map(publicView),
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error('[bsa] getMyAnalyses error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load bank statement analyses.' });
  }
};

// GET /api/bsa/:id/report
exports.downloadReport = async (req, res) => {
  try {
    const doc = await BankStatementAnalysis.findById(req.params.id).lean();
    if (!doc || String(doc.userId) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    if (doc.status !== 'Success') {
      return res.status(409).json({ success: false, message: 'Report is not ready yet' });
    }

    const pdfFileName = doc.localPath ? path.basename(doc.localPath) : `${String(doc._id)}.pdf`;
    const absPdfPath = path.join(REPORT_DIR, pdfFileName);

    if (!fs.existsSync(absPdfPath)) {
      const htmlPath = path.join(REPORT_DIR, `${String(doc._id)}.html`);
      if (fs.existsSync(htmlPath)) {
        try {
          const htmlContent = fs.readFileSync(htmlPath, 'utf8');
          const regeneratedPdf = await pipelinePdf.generatePdfFromHtml(htmlContent);
          fs.writeFileSync(absPdfPath, regeneratedPdf);
        } catch (genErr) {
          console.error('[bsa] PDF regeneration failed:', genErr.message);
          return res.status(500).json({ success: false, message: 'Report PDF could not be generated.' });
        }
      } else {
        return res.status(404).json({ success: false, message: 'Report file is missing.' });
      }
    }

    const stat = fs.statSync(absPdfPath);
    const isDownload = String(req.query.download || '') === '1';
    const dispositionType = isDownload ? 'attachment' : 'inline';
    const downloadName = `creditdost-bank-statement-${doc._id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${downloadName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    const stream = fs.createReadStream(absPdfPath);
    stream.on('error', (streamErr) => {
      console.error('[bsa] stream error:', streamErr.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error streaming report file' });
      }
    });
    return stream.pipe(res);
  } catch (err) {
    console.error('[bsa] downloadReport error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not download report' });
  }
};
