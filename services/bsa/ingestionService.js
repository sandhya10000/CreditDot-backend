'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');

/**
 * Supported File Types:
 * - TEXT_PDF: Normal text-layer PDF
 * - SCANNED: Image-based scanned PDF
 * - IMAGE: Raw image file (png, jpg, jpeg, webp, tiff, bmp)
 * - CSV: Comma-separated values
 * - XLSX: Excel spreadsheet (xlsx, xls)
 */

const NUMERIC_TOKEN_REGEX = /\d[\d,]*\.\d\d/g;
const GARBAGE_CHAR_REGEX = /[^a-zA-Z0-9\s.,/\\()\-:;@#₹%&*+=|<>]/g;

/**
 * Detect the primary mime / high-level file type from buffer and filename
 */
function detectFileType(buffer, filename = '') {
  if (!buffer || buffer.length === 0) {
    const err = new Error('Empty file buffer received.');
    err.code = 'EMPTY_FILE';
    throw err;
  }

  const ext = path.extname(filename).toLowerCase();

  // Check magic bytes
  const magic4 = buffer.slice(0, 4);
  const magic5 = buffer.slice(0, 5).toString('latin1');
  const magic8 = buffer.slice(0, 8);

  // 1. PDF
  if (magic5 === '%PDF-') {
    return 'PDF';
  }

  // 2. XLSX (Zip archive: PK\x03\x04) or XLS (Compound Document: \xD0\xCF\x11\xE0)
  if (
    (magic4[0] === 0x50 && magic4[1] === 0x4b && magic4[2] === 0x03 && magic4[3] === 0x04 && (ext === '.xlsx' || ext === '.zip')) ||
    (magic8[0] === 0xd0 && magic8[1] === 0xcf && magic8[2] === 0x11 && magic8[3] === 0xe0 && ext === '.xls') ||
    ext === '.xlsx' || ext === '.xls'
  ) {
    return 'XLSX';
  }

  // 3. Image
  if (
    // JPEG: FF D8 FF
    (magic4[0] === 0xff && magic4[1] === 0xd8 && magic4[2] === 0xff) ||
    // PNG: 89 50 4E 47
    (magic4[0] === 0x89 && magic4[1] === 0x50 && magic4[2] === 0x4e && magic4[3] === 0x47) ||
    // WebP: RIFF....WEBP
    (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') ||
    // TIFF: II* (49 49 2A 00) or MM* (4D 4D 00 2A)
    (magic4[0] === 0x49 && magic4[1] === 0x49 && magic4[2] === 0x2a) ||
    (magic4[0] === 0x4d && magic4[1] === 0x4d && magic4[2] === 0x00 && magic4[3] === 0x2a) ||
    // BMP: BM (42 4D)
    (magic4[0] === 0x42 && magic4[1] === 0x4d) ||
    ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'].includes(ext)
  ) {
    return 'IMAGE';
  }

  // 4. CSV / Text
  if (ext === '.csv') {
    return 'CSV';
  }

  // Heuristic check for CSV text (commas or semicolons present in plain utf8/ascii lines)
  const preview = buffer.slice(0, 2048).toString('utf8');
  if (/^[\x20-\x7E\r\n\t,;"'-]+$/.test(preview) && (preview.includes(',') || preview.includes(';') || ext === '.txt')) {
    return 'CSV';
  }

  return 'UNKNOWN';
}

/**
 * Check if an error or message indicates password protection (pikepdf, pdf-lib, pdf-parse, pdfjs)
 */
function isPasswordProtectedError(err) {
  if (!err) return false;
  const msg = String(err.message || err.name || err).toLowerCase();
  return (
    msg.includes('password') ||
    msg.includes('encrypt') ||
    msg.includes('protected') ||
    msg.includes('user password') ||
    msg.includes('owner password') ||
    msg.includes('bad decrypt') ||
    msg.includes('failed to decrypt') ||
    msg.includes('security handler') ||
    msg.includes('unsupported crypt filter')
  );
}

/**
 * Calculate page text-density metrics:
 * - chars: number of characters on the page
 * - garbageRatio: proportion of non-standard/unreadable characters
 * - numericTokens: count of decimal currency / numerical tokens (matching \d[\d,]*\.\d\d)
 */
function calculatePageMetrics(pageText = '') {
  const chars = pageText.length;
  if (chars === 0) {
    return {
      chars: 0,
      garbageRatio: 1.0,
      numericTokens: 0,
    };
  }

  const garbageMatches = pageText.match(GARBAGE_CHAR_REGEX) || [];
  const garbageRatio = chars > 0 ? parseFloat((garbageMatches.length / chars).toFixed(4)) : 0;

  const numericMatches = pageText.match(NUMERIC_TOKEN_REGEX) || [];
  const numericTokens = numericMatches.length;

  return {
    chars,
    garbageRatio,
    numericTokens,
  };
}

/**
 * Calculate image area coverage percentage for a page via pdf-lib resources
 */
function computePageImageAreaPct(pdfPage, docContext) {
  try {
    const pageWidth = pdfPage.getWidth() || 595.28;
    const pageHeight = pdfPage.getHeight() || 841.89;
    const pageArea = pageWidth * pageHeight;
    if (pageArea <= 0) return 0;

    const res = pdfPage.node.Resources();
    if (!res) return 0;

    const xObjRef = res.get(PDFName.of('XObject'));
    if (!xObjRef) return 0;

    const xObj = docContext.lookup(xObjRef);
    if (!xObj || !(xObj instanceof PDFDict)) return 0;

    let maxSingleImageArea = 0;
    for (const key of xObj.keys()) {
      const stream = docContext.lookup(xObj.get(key));
      if (!stream || !stream.dict) continue;

      const subtype = stream.dict.get(PDFName.of('Subtype'));
      if (subtype?.asString() === '/Image') {
        const wVal = stream.dict.get(PDFName.of('Width'))?.value?.() || 0;
        const hVal = stream.dict.get(PDFName.of('Height'))?.value?.() || 0;
        // Large full-page raster scans are typically 500+ px wide and 700+ px high
        if (wVal >= 500 && hVal >= 700) {
          const imgAspectArea = wVal * hVal;
          if (imgAspectArea > maxSingleImageArea) {
            maxSingleImageArea = imgAspectArea;
          }
        }
      }
    }

    // If a full-page raster scan image exists (>500x700 px) covering the whole page canvas
    if (maxSingleImageArea > 0) {
      return 90; // High image coverage
    }
    return 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Inspect and extract layout/page metrics for a PDF.
 * If password-protected, catches pdf-lib/pdf-parse error and returns { status: 'NEEDS_PASSWORD' }.
 * Classifies page by page as SCANNED if chars < 50 or image area > 80%, else TEXT_PDF.
 */
async function inspectAndIngestPdf(pdfBuffer, options = {}) {
  // 1. Password & structural validation via pdf-lib
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: false });
  } catch (err) {
    if (isPasswordProtectedError(err)) {
      return {
        status: 'NEEDS_PASSWORD',
        fileType: 'PDF',
        message: 'This statement is password-protected. Please upload it without a password or provide credentials.',
      };
    }
    const error = new Error(`Failed to load PDF: ${err.message}`);
    error.code = 'INVALID_PDF';
    throw error;
  }

  const pageCount = pdfDoc.getPageCount();
  const pages = [];

  try {
    await pdfParse(pdfBuffer, {
      pagerender: (pageData) => {
        const pageIndex = pageData.pageIndex ?? pages.length;
        const pageNumber = pageIndex + 1;

        return pageData.getTextContent().then((tc) => {
          const items = [];
          const yLinesMap = new Map();

          for (const item of tc.items || []) {
            const str = String(item.str || '');
            if (!str.trim()) continue;

            const x = item.transform ? Math.round(item.transform[4] * 10) / 10 : 0;
            const y = item.transform ? Math.round(item.transform[5] * 10) / 10 : 0;
            const w = item.width ? Math.round(item.width * 10) / 10 : str.length * 4.5;
            const h = item.height ? Math.round(item.height * 10) / 10 : 10;

            items.push({ str, x, y, w, h });

            const yKey = Math.round(y / 3) * 3;
            if (!yLinesMap.has(yKey)) yLinesMap.set(yKey, []);
            yLinesMap.get(yKey).push({ str, x });
          }

          // Sort lines top-to-bottom and items left-to-right
          const sortedYKeys = Array.from(yLinesMap.keys()).sort((a, b) => b - a);
          const pageLines = sortedYKeys.map((yKey) => {
            const lineItems = yLinesMap.get(yKey).sort((a, b) => a.x - b.x);
            return lineItems.map((it) => it.str).join(' ');
          });

          const pageText = pageLines.join('\n').trim();
          const metrics = calculatePageMetrics(pageText);

          // Calculate image area coverage using pdf-lib page node
          let imageAreaPct = 0;
          try {
            if (pageIndex < pdfDoc.getPageCount()) {
              imageAreaPct = computePageImageAreaPct(pdfDoc.getPage(pageIndex), pdfDoc.context);
            }
          } catch (e) {
            imageAreaPct = 0;
          }

          // Classification rule: If chars < 50 or image area > 80%, classify as SCANNED, otherwise TEXT_PDF
          const isScanned = metrics.chars < 50 || imageAreaPct > 80;
          const pageClassification = isScanned ? 'SCANNED' : 'TEXT_PDF';

          pages.push({
            pageNumber,
            text: pageText,
            items,
            imageAreaPct,
            ...metrics,
            classification: pageClassification,
          });

          return pageText;
        });
      },
    });
  } catch (parseErr) {
    if (isPasswordProtectedError(parseErr)) {
      return {
        status: 'NEEDS_PASSWORD',
        fileType: 'PDF',
        message: 'This statement is password-protected. Please upload it without a password or provide credentials.',
      };
    }
    throw parseErr;
  }

  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  const scannedCount = pages.filter((p) => p.classification === 'SCANNED').length;
  const overallClassification =
    scannedCount === pages.length || (pages.length > 0 && scannedCount / pages.length >= 0.5)
      ? 'SCANNED'
      : 'TEXT_PDF';

  const fullText = pages.map((p) => p.text).join('\n\n');
  const totalChars = pages.reduce((sum, p) => sum + p.chars, 0);
  const avgCharsPerPage = pages.length > 0 ? Math.round(totalChars / pages.length) : 0;

  return {
    status: 'SUCCESS',
    fileType: 'PDF',
    classification: overallClassification,
    pageCount: pages.length,
    avgCharsPerPage,
    pages,
    fullText,
  };
}

/**
 * Segment multi-account statements by detecting changes in Account No: patterns or B/F balance resets.
 *
 * Scans page text or transaction flow:
 * - Detects `Account No:`, `A/C No:`, `Account Number:` changes
 * - Detects B/F (Brought Forward / Opening Balance) resets where B/F reappears with a completely disconnected balance
 *
 * Returns array of account segments: [{ accountNo, startPage, endPage, openingBalance, text }]
 */
function segmentMultiAccountStatement(pages = [], fullText = '') {
  if (!pages || pages.length === 0) {
    if (fullText) {
      pages = [{ pageNumber: 1, text: fullText }];
    } else {
      return [];
    }
  }

  const ACCOUNT_REGEX =
    /(?:Account\s*(?:No|Number|#)|A\/c\s*(?:No|Number))\s*[:\-]?\s*([X*\d]{6,22})|Account\s*No[\s\S]{0,80}?:\s*(\d{8,22})/i;
  const BF_BALANCE_REGEX =
    /(?:B\/?F|Brought\s*Forward|Opening\s*Balance)\s*[:.-]?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d\d)/i;

  const segments = [];
  let currentSegment = null;

  for (const page of pages) {
    const text = page.text || '';

    // Find account numbers on this page
    const acctMatch = text.match(ACCOUNT_REGEX);
    const primaryAcct = acctMatch ? (acctMatch[1] || acctMatch[2]).trim() : null;

    // Find B/F balance on this page
    const bfMatch = text.match(BF_BALANCE_REGEX);
    const bfBalance = bfMatch ? bfMatch[1].replace(/,/g, '') : null;

    if (!currentSegment) {
      currentSegment = {
        accountNo: primaryAcct || 'PRIMARY_ACCOUNT',
        startPage: page.pageNumber || 1,
        endPage: page.pageNumber || 1,
        openingBalance: bfBalance ? parseFloat(bfBalance) : null,
        bfResets: bfBalance ? [bfBalance] : [],
        pages: [page.pageNumber || 1],
      };
    } else {
      const isAccountChanged =
        primaryAcct &&
        primaryAcct !== currentSegment.accountNo &&
        currentSegment.accountNo !== 'PRIMARY_ACCOUNT';
      // If B/F balance reappears on a page that is NOT page 1 or page 2, and indicates a brand-new statement cycle/account header
      const isBfReset =
        bfBalance &&
        text.includes('STATEMENT OF ACCOUNT') &&
        page.pageNumber > currentSegment.startPage;

      if (isAccountChanged || isBfReset) {
        // Close previous segment
        segments.push(currentSegment);
        // Start new segment
        currentSegment = {
          accountNo: primaryAcct || `ACCOUNT_${segments.length + 1}`,
          startPage: page.pageNumber,
          endPage: page.pageNumber,
          openingBalance: bfBalance ? parseFloat(bfBalance) : null,
          bfResets: bfBalance ? [bfBalance] : [],
          pages: [page.pageNumber],
        };
      } else {
        // Continue current segment
        currentSegment.endPage = page.pageNumber;
        currentSegment.pages.push(page.pageNumber);
        if (primaryAcct && currentSegment.accountNo === 'PRIMARY_ACCOUNT') {
          currentSegment.accountNo = primaryAcct;
        }
        if (bfBalance && currentSegment.openingBalance === null) {
          currentSegment.openingBalance = parseFloat(bfBalance);
        }
      }
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Main ingestion entry point
 */
async function ingestStatement(fileBuffer, filename = '', options = {}) {
  const fileType = detectFileType(fileBuffer, filename);

  if (fileType === 'IMAGE') {
    return {
      status: 'SUCCESS',
      fileType: 'IMAGE',
      classification: 'SCANNED',
      pageCount: 1,
      message: 'Single image statement received',
    };
  }

  if (fileType === 'CSV') {
    const text = fileBuffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return {
      status: 'SUCCESS',
      fileType: 'CSV',
      classification: 'CSV',
      lineCount: lines.length,
      fullText: text,
      segments: [{ accountNo: 'CSV_ACCOUNT', startPage: 1, endPage: 1, lines: lines.length }],
    };
  }

  if (fileType === 'XLSX') {
    return {
      status: 'SUCCESS',
      fileType: 'XLSX',
      classification: 'XLSX',
      message: 'Excel spreadsheet statement received',
    };
  }

  if (fileType === 'PDF') {
    const pdfResult = await inspectAndIngestPdf(fileBuffer, options);
    if (pdfResult.status === 'NEEDS_PASSWORD') {
      return pdfResult;
    }

    const segments = segmentMultiAccountStatement(pdfResult.pages, pdfResult.fullText);

    return {
      ...pdfResult,
      segments,
    };
  }

  return {
    status: 'UNSUPPORTED_FORMAT',
    fileType: 'UNKNOWN',
    message: 'Unsupported statement file format.',
  };
}

module.exports = {
  detectFileType,
  calculatePageMetrics,
  inspectAndIngestPdf,
  segmentMultiAccountStatement,
  ingestStatement,
};
