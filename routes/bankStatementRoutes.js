'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { ingestStatement } = require('../services/bsa/ingestionService');
const { profileStatementLayout } = require('../services/bsa/profilerService');
const { extractAndReconcileStatement } = require('../services/bsa/extractorEngine');
const { computeDeterministicAnalytics } = require('../services/bsa/analyticsService');
const { evaluateRiskScorecard } = require('../services/bsa/scorecardService');
const { generateQualitativeNarrative } = require('../services/bsa/narrativeService');
const { renderReportHtml, renderReportPdf } = require('../services/bsa/reportRenderer');
const auth = require('../middleware/auth');

const router = express.Router();

// Memory storage for fast processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// In-memory job repository for BSA analysis jobs
const bsaJobStore = new Map();

/**
 * Background pipeline runner
 */
async function processBsaJob(jobId, fileBuffer, filename, password = null) {
  const job = bsaJobStore.get(jobId);
  if (!job) return;

  try {
    job.status = 'PROCESSING';
    job.progress = 10;

    // 1. Ingestion Layer
    const ingestionRes = await ingestStatement(fileBuffer, filename, { password });
    if (ingestionRes.status === 'NEEDS_PASSWORD') {
      job.status = 'NEEDS_PASSWORD';
      job.message = 'Password required to unlock statement PDF.';
      return;
    }

    job.progress = 30;

    // 2. Profiling Layer
    const profileRes = await profileStatementLayout({
      pages: ingestionRes.pages || [],
      fullText: ingestionRes.fullText || '',
    });
    const layoutProfile = profileRes.profile || {};

    job.progress = 50;

    // 3. Extraction & Reconciliation
    const extractionRes = await extractAndReconcileStatement({
      pages: ingestionRes.pages || [],
      profile: layoutProfile,
      pdfBuffer,
      options: { enableClaudeRepair: true, enableVisionFallback: true },
    });

    const reconciledTxns = extractionRes.reconResult.transactions || [];
    job.progress = 70;

    // 4. Deterministic Analytics & Forensics
    const analytics = computeDeterministicAnalytics(reconciledTxns, {
      accountHolderName: layoutProfile.bankName || 'Borrower',
      openingBalance: extractionRes.reconResult.reconciledOpeningBalance,
    });

    // 5. Risk Scorecard
    const scorecard = evaluateRiskScorecard(analytics);
    job.progress = 85;

    // 6. Qualitative Narrative
    const narrative = await generateQualitativeNarrative(analytics, scorecard);

    const reportData = {
      reportId: jobId,
      reportDate: new Date().toISOString().slice(0, 10),
      account: {
        bankName: layoutProfile.bankName || 'Verified Bank Statement',
        accountHolderName: 'Customer',
        accountNumberMasked: 'XXXX' + (reconciledTxns[0]?.ref_no?.slice(-4) || '9876'),
      },
      statementPeriod: {
        from: reconciledTxns[0]?.date || 'Start',
        to: reconciledTxns[reconciledTxns.length - 1]?.date || 'End',
      },
      analytics,
      scorecard,
      narrative,
      extractionTierUsed: extractionRes.tierUsed,
    };

    // Render HTML & pre-compile PDF
    const html = await renderReportHtml(reportData);
    let pdfBuf = null;
    try {
      pdfBuf = await renderReportPdf(html);
    } catch (e) {
      console.warn('[bankStatementRoutes] PDF pre-compile warning:', e.message);
    }

    job.status = 'COMPLETED';
    job.progress = 100;
    job.data = reportData;
    job.html = html;
    job.pdfBuffer = pdfBuf;
  } catch (err) {
    job.status = 'FAILED';
    job.error = err.message;
  }
}

/**
 * 1. POST /api/v1/bsa/upload (or /api/bsa/upload)
 * Accepts multipart file + optional password
 */
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'No statement file uploaded.' });
  }

  const jobId = `bsa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = req.body.password || null;

  const jobRecord = {
    jobId,
    filename: req.file.originalname,
    status: 'QUEUED',
    progress: 0,
    createdAt: new Date(),
    data: null,
    html: null,
    pdfBuffer: null,
  };

  bsaJobStore.set(jobId, jobRecord);

  // Trigger async background processing
  processBsaJob(jobId, req.file.buffer, req.file.originalname, password);

  return res.status(202).json({
    success: true,
    jobId,
    status: 'QUEUED',
    message: 'Statement upload accepted. Analysis running in background.',
  });
});

/**
 * 2. GET /api/v1/bsa/report/:jobId
 * Returns full structured JSON
 */
router.get('/report/:jobId', auth, (req, res) => {
  const { jobId } = req.params;
  const job = bsaJobStore.get(jobId);

  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found.' });
  }

  if (job.status === 'PROCESSING' || job.status === 'QUEUED') {
    return res.status(200).json({
      success: true,
      jobId,
      status: job.status,
      progress: job.progress,
      message: 'Analysis in progress...',
    });
  }

  if (job.status === 'NEEDS_PASSWORD') {
    return res.status(400).json({
      success: false,
      jobId,
      status: 'NEEDS_PASSWORD',
      message: job.message,
    });
  }

  if (job.status === 'FAILED') {
    return res.status(500).json({
      success: false,
      jobId,
      status: 'FAILED',
      error: job.error,
    });
  }

  return res.status(200).json({
    success: true,
    jobId,
    status: 'COMPLETED',
    report: job.data,
  });
});

/**
 * 3. GET /api/v1/bsa/report/:jobId/pdf
 * Streams rendered Credit Intelligence PDF
 */
router.get('/report/:jobId/pdf', async (req, res) => {
  const { jobId } = req.params;
  const job = bsaJobStore.get(jobId);

  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found.' });
  }

  if (job.status !== 'COMPLETED' || !job.data) {
    return res.status(400).json({
      success: false,
      message: `Report is not ready yet. Current status: ${job.status}`,
    });
  }

  try {
    let pdfBuffer = job.pdfBuffer;
    if (!pdfBuffer && job.html) {
      pdfBuffer = await renderReportPdf(job.html);
      job.pdfBuffer = pdfBuffer;
    }

    if (!pdfBuffer) {
      return res.status(500).json({ success: false, message: 'Could not generate PDF.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Credit_Intelligence_Report_${jobId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.end(pdfBuffer);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed streaming PDF.', error: err.message });
  }
});

module.exports = router;

