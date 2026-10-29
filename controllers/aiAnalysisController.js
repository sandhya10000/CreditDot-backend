const AIAnalysis = require("../models/AIAnalysis");
const Franchise = require("../models/Franchise");
const Package = require("../models/Package");
const { upload } = require("../utils/fileUpload");
const {
  sendAIAnalysisNotificationToAdmin,
  sendAIAnalysisResponseToFranchise,
} = require("../utils/emailService");
const { processDocument } = require("../utils/claudeService");
const {
  getLanguageConfig,
  isMultiLangEnabled,
  DEFAULT_LANGUAGE_CODE,
} = require("../config/languages");
const { resolveFranchiseAiLimit } = require("../utils/aiLimitService");
const path = require("path");
const fs = require("fs");

// Diamond AI analysis hard cap (backend-only, never exposed to the UI)
const DIAMOND_AI_ANALYSIS_HARD_CAP = parseInt(
  process.env.DIAMOND_AI_ANALYSIS_HARD_CAP || "1000",
  10,
);

/**
 * Atomically increments aiReportsUsed (and aiUsed) on success.
 * For Diamond (unlimited) packages, enforces the hidden DIAMOND_AI_ANALYSIS_HARD_CAP.
 * Returns { ok: true } on success or { ok: false, fairUseLimitReached: true } when
 * the Diamond cap has been exceeded (never happens for Silver/Gold/Platinum).
 */
async function atomicIncrementAiUsage(franchiseId, isUnlimited) {
  if (isUnlimited) {
    // Diamond: enforce hidden hard cap with atomic conditional update
    const updated = await Franchise.findOneAndUpdate(
      { _id: franchiseId, aiReportsUsed: { $lt: DIAMOND_AI_ANALYSIS_HARD_CAP } },
      { $inc: { aiReportsUsed: 1, aiUsed: 1 } },
      { new: false }, // we only need to know if the condition matched
    );
    if (!updated) {
      // Cap already reached (concurrent-safe)
      return { ok: false, fairUseLimitReached: true };
    }
    return { ok: true };
  }

  // Non-Diamond: simple unconditional increment (limit was already checked before analysis)
  await Franchise.findOneAndUpdate(
    { _id: franchiseId },
    { $inc: { aiReportsUsed: 1, aiUsed: 1 } },
  );
  return { ok: true };
}


// Configure multer for PDF uploads
const pdfUpload = upload.single("document");

// Upload PDF document by franchise user
const uploadDocument = async (req, res) => {
  try {
    // Handle file upload
    pdfUpload(req, res, async (err) => {
      if (err) {
        return res
          .status(400)
          .json({ message: "File upload error", error: err.message });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Check if file is a PDF or HTML
      const fileExtension = path.extname(req.file.originalname).toLowerCase();
      if (
        fileExtension !== ".pdf" &&
        fileExtension !== ".html" &&
        fileExtension !== ".htm"
      ) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ message: "Only PDF and HTML files are allowed" });
      }

      // Get franchise details with assigned packages
      const franchise = await Franchise.findOne({
        userId: req.user.id,
      })
        .populate("userId", "name email")
        .populate("assignedPackages");

      if (!franchise) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Franchise not found" });
      }

      // Check package limits
      const limitInfo = resolveFranchiseAiLimit(franchise);
      if (!limitInfo.hasActivePackage) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          code: "AI_NO_ACTIVE_PACKAGE",
          message:
            "No active package found. Please purchase or activate a package to use AI report analysis.",
          used: limitInfo.used,
          limit: limitInfo.limit,
        });
      }

      if (!limitInfo.isUnlimited && limitInfo.used >= limitInfo.limit) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          code: "AI_LIMIT_REACHED",
          message: `You have used all ${limitInfo.limit} AI report analyses in your ${limitInfo.packageName} package. Please upgrade to continue.`,
          used: limitInfo.used,
          limit: limitInfo.limit,
        });
      }

      // Parse and whitelist language (only when MULTILANG_ENABLED flag is true)
      const requestedLang = isMultiLangEnabled() && req.body && req.body.language ? req.body.language : DEFAULT_LANGUAGE_CODE;
      const langConfig = getLanguageConfig(requestedLang);
      const effectiveLanguage = isMultiLangEnabled() ? langConfig.code : DEFAULT_LANGUAGE_CODE;
      const effectiveLanguageName = isMultiLangEnabled() ? langConfig.name : "English";

      // Create AI Analysis document record
      const aiAnalysisDoc = new AIAnalysis({
        franchise: franchise._id,
        franchiseName: franchise.businessName,
        franchiseEmail: franchise.email,
        uploadedDocument: req.file.path,
        uploadedDocumentName: req.file.originalname,
        status: "uploaded",
        language: effectiveLanguage,
        languageName: effectiveLanguageName,
      });

      await aiAnalysisDoc.save();

      // Send admin notification email (non-blocking)
      (async () => {
        try {
          const fileBuffer = fs.readFileSync(req.file.path);
          await sendAIAnalysisNotificationToAdmin(
            franchise,
            req.file.originalname,
            fileBuffer,
          );
        } catch (emailError) {
          console.error("Failed to send admin notification email:", emailError);
        }
      })();

      // Trigger automatic Claude AI analysis
      // Run asynchronously to not block the response
      (async () => {
        try {
          // Update status to processing
          aiAnalysisDoc.claudeAnalysisStatus = "processing";
          await aiAnalysisDoc.save();

          // ===== TEMP-DEBUG-START (remove after staging debugging) =====
          console.log('[TEMP-DEBUG] About to process document:', {
            NODE_ENV: process.env.NODE_ENV,
            reqFile: req.file ? { path: req.file.path, key: req.file.key, location: req.file.location, originalname: req.file.originalname, size: req.file.size } : null,
            language: effectiveLanguage,
          });
          // ===== TEMP-DEBUG-END =====

          // Process document with Claude
          const analysisResult = await processDocument(
            req.file.path,
            req.file.originalname,
            null, // Use default prompt from env
            effectiveLanguage,
          );

          // Generate HTML file name: English keeps legacy format, non-English adds language code
          const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
          const htmlFileName = effectiveLanguage === DEFAULT_LANGUAGE_CODE
            ? `analysis_${baseName}_${Date.now()}.html`
            : `analysis_${baseName}_${effectiveLanguage}_${Date.now()}.html`;

          const htmlFilePath = path.join(
            path.dirname(req.file.path),
            htmlFileName,
          );

          // ===== TEMP-DEBUG-START (remove after staging debugging) =====
          console.log('[TEMP-DEBUG] Writing HTML report to:', htmlFilePath);
          // ===== TEMP-DEBUG-END =====

          // Save HTML analysis to file
          fs.writeFileSync(htmlFilePath, analysisResult.content, "utf-8");

          // Atomically increment AI usage counter on successful analysis.
          // For Diamond users the hidden hard cap is enforced inside atomicIncrementAiUsage.
          const incResult = await atomicIncrementAiUsage(
            franchise._id,
            limitInfo.isUnlimited,
          );
          if (!incResult.ok && incResult.fairUseLimitReached) {
            // Update document status so the UI shows the failure cleanly
            aiAnalysisDoc.claudeAnalysisStatus = "failed";
            aiAnalysisDoc.claudeAnalysisError =
              "You have reached the maximum AI analysis usage for your plan. Please contact your Relationship Manager.";
            await aiAnalysisDoc.save();
            // Return early — do NOT send email or mark completed
            return;
          }


          // Update document with analysis
          aiAnalysisDoc.claudeAnalysisHtml = htmlFilePath;
          aiAnalysisDoc.claudeAnalysisFileName = htmlFileName;
          aiAnalysisDoc.analysisPrompt = process.env.AI_ANALYSIS_PROMPT;
          aiAnalysisDoc.isAutoAnalyzed = true;
          aiAnalysisDoc.claudeAnalysisStatus = "completed";
          aiAnalysisDoc.analyzedAt = new Date();
          await aiAnalysisDoc.save();

          // Send email with analysis report to franchise user
          try {
            // ===== TEMP-DEBUG-START (remove after staging debugging) =====
            console.log('[TEMP-DEBUG] Reading HTML report for email attachment from:', htmlFilePath);
            // ===== TEMP-DEBUG-END =====
            const htmlBuffer = fs.readFileSync(htmlFilePath);
            await sendAIAnalysisResponseToFranchise(
              {
                email: aiAnalysisDoc.franchiseEmail,
                businessName: aiAnalysisDoc.franchiseName,
              },
              htmlFileName,
              htmlBuffer,
            );
            // Update status to email_sent after successful email delivery
            aiAnalysisDoc.claudeAnalysisStatus = "email_sent";
            aiAnalysisDoc.emailSentAt = new Date();
            await aiAnalysisDoc.save();
          } catch (emailError) {
            // ===== TEMP-DEBUG-START (remove after staging debugging) =====
            console.error('[TEMP-DEBUG] Email send error in uploadDocument:', {
              message: emailError.message,
              code: emailError.code,
              command: emailError.command,
              response: emailError.response,
              stack: emailError.stack,
            });
            // ===== TEMP-DEBUG-END =====
            console.error("Failed to send analysis report email:", emailError);
            // Keep status as 'completed' but log the error
            aiAnalysisDoc.claudeAnalysisError =
              "Analysis completed but email failed to send";
            await aiAnalysisDoc.save();
          }
        } catch (analysisError) {
          // ===== TEMP-DEBUG-START (remove after staging debugging) =====
          console.error('[TEMP-DEBUG] AI analysis FULL ERROR:', {
            message: analysisError.message,
            stack: analysisError.stack,
            code: analysisError.code,
            httpStatus: analysisError.status,
            errorType: analysisError.constructor?.name,
            filePath: req.file?.path,
            fileKey: req.file?.key,
            fileLocation: req.file?.location,
            NODE_ENV: process.env.NODE_ENV,
            CLAUDE_MODEL: process.env.CLAUDE_MODEL,
            CLAUDE_API_KEY_SET: !!process.env.CLAUDE_API_KEY,
          });
          // ===== TEMP-DEBUG-END =====
          console.error("Claude analysis failed:", analysisError.message);
          // Update status to failed but don't delete the document
          aiAnalysisDoc.claudeAnalysisStatus = "failed";

          // Sanitize error message - hide sensitive API details from users
          let sanitizedError = "Analysis failed. Please contact admin.";

          // Check if it's a Claude API error with credit balance issue
          if (
            analysisError.message &&
            analysisError.message.includes("credit balance is too low")
          ) {
            sanitizedError = "Analysis failed. Please contact admin.";
          } else if (
            analysisError.message &&
            analysisError.message.includes("400")
          ) {
            // For other 400 errors, also show generic message
            sanitizedError = "Analysis failed. Please contact admin.";
          } else {
            // For other errors, still use generic message for security
            sanitizedError = "Analysis failed. Please contact admin.";
          }

          aiAnalysisDoc.claudeAnalysisError = sanitizedError;
          await aiAnalysisDoc.save();
        }
      })();

      res.status(201).json({
        message:
          "Document uploaded successfully. AI analysis will be performed automatically.",
        document: aiAnalysisDoc,
      });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all documents for admin
const getAllDocuments = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const documents = await AIAnalysis.find()
      .populate("franchise", "businessName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await AIAnalysis.countDocuments();

    res.status(200).json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      documents,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get document by ID
const getDocumentById = async (req, res) => {
  try {
    const document = await AIAnalysis.findById(req.params.id).populate(
      "franchise",
      "businessName email userId",
    );

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    res.json(document);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Admin responds to document with updated PDF
const respondToDocument = async (req, res) => {
  try {
    // Handle file upload
    pdfUpload(req, res, async (err) => {
      if (err) {
        return res
          .status(400)
          .json({ message: "File upload error", error: err.message });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Check if file is a PDF or HTML
      const fileExtension = path.extname(req.file.originalname).toLowerCase();
      if (
        fileExtension !== ".pdf" &&
        fileExtension !== ".html" &&
        fileExtension !== ".htm"
      ) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ message: "Only PDF and HTML files are allowed" });
      }

      // Find the document
      const document = await AIAnalysis.findById(req.params.id).populate(
        "franchise",
        "businessName email userId",
      );

      if (!document) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Document not found" });
      }

      // Update document with admin response
      document.adminResponseDocument = req.file.path;
      document.adminResponseDocumentName = req.file.originalname;
      document.status = "responded";
      document.respondedAt = new Date();
      document.adminNotes = req.body.notes || "";

      await document.save();

      // Read file buffer and send email notification to franchise user
      try {
        // Read the response file buffer
        const fileBuffer = fs.readFileSync(req.file.path);
        await sendAIAnalysisResponseToFranchise(
          {
            email: document.franchiseEmail,
            businessName: document.franchiseName,
          },
          document.adminResponseDocumentName,
          fileBuffer,
        );
      } catch (emailError) {
        console.error(
          "Failed to send franchise notification email:",
          emailError,
        );
      }

      res.json({
        message: "Response document uploaded successfully",
        document,
      });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get documents for a specific franchise
const getFranchiseDocuments = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    const documents = await AIAnalysis.find({ franchise: franchise._id }).sort({
      createdAt: -1,
    });

    res.json(documents);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Manually trigger Claude AI analysis on a document
const analyzeWithClaude = async (req, res) => {
  try {
    const document = await AIAnalysis.findById(req.params.id).populate(
      "franchise",
      "businessName email userId",
    );

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Check if franchise has active package and is under limit
    const franchise = await Franchise.findById(document.franchise).populate(
      "assignedPackages",
    );
    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    const limitInfo = resolveFranchiseAiLimit(franchise);
    if (!limitInfo.hasActivePackage) {
      return res.status(403).json({
        success: false,
        code: "AI_NO_ACTIVE_PACKAGE",
        message:
          "No active package found. Please purchase or activate a package to use AI report analysis.",
        used: limitInfo.used,
        limit: limitInfo.limit,
      });
    }

    if (!limitInfo.isUnlimited && limitInfo.used >= limitInfo.limit) {
      return res.status(403).json({
        success: false,
        code: "AI_LIMIT_REACHED",
        message: `You have used all ${limitInfo.limit} AI report analyses in your ${limitInfo.packageName} package. Please upgrade to continue.`,
        used: limitInfo.used,
        limit: limitInfo.limit,
      });
    }

    // Check if already analyzed
    if (
      document.claudeAnalysisStatus === "completed" &&
      document.claudeAnalysisHtml
    ) {
      return res.status(400).json({
        message:
          "Document has already been analyzed. Delete and re-upload to analyze again.",
      });
    }

    // Check if file exists
    if (!fs.existsSync(document.uploadedDocument)) {
      return res
        .status(404)
        .json({ message: "Uploaded document file not found" });
    }

    // Resolve and whitelist language (only when MULTILANG_ENABLED flag is true)
    const rawRequestedLang = req.body && req.body.language ? req.body.language : (document.language || DEFAULT_LANGUAGE_CODE);
    const langConfig = getLanguageConfig(rawRequestedLang);
    const effectiveLanguage = isMultiLangEnabled() ? langConfig.code : DEFAULT_LANGUAGE_CODE;
    const effectiveLanguageName = isMultiLangEnabled() ? langConfig.name : "English";

    // Update status to processing and update language
    document.claudeAnalysisStatus = "processing";
    document.analysisPrompt = req.body.prompt || process.env.AI_ANALYSIS_PROMPT;
    document.language = effectiveLanguage;
    document.languageName = effectiveLanguageName;
    await document.save();

    // Run analysis asynchronously
    (async () => {
      try {
        // Process document with Claude
        const analysisResult = await processDocument(
          document.uploadedDocument,
          document.uploadedDocumentName,
          req.body.prompt || null,
          effectiveLanguage,
        );

        // Generate HTML file name: English keeps legacy format, non-English adds language code
        const baseName = path.basename(document.uploadedDocumentName, path.extname(document.uploadedDocumentName));
        const htmlFileName = effectiveLanguage === DEFAULT_LANGUAGE_CODE
          ? `analysis_${baseName}_${Date.now()}.html`
          : `analysis_${baseName}_${effectiveLanguage}_${Date.now()}.html`;

        const htmlFilePath = path.join(
          path.dirname(document.uploadedDocument),
          htmlFileName,
        );

        // ===== TEMP-DEBUG-START (remove after staging debugging) =====
        console.log('[TEMP-DEBUG] Writing HTML report to:', htmlFilePath);
        // ===== TEMP-DEBUG-END =====

        // Save HTML analysis to file
        fs.writeFileSync(htmlFilePath, analysisResult.content, "utf-8");

        // Atomically increment AI usage counter on successful analysis.
        // For Diamond users the hidden hard cap is enforced inside atomicIncrementAiUsage.
        const incResult = await atomicIncrementAiUsage(
          franchise._id,
          limitInfo.isUnlimited,
        );
        if (!incResult.ok && incResult.fairUseLimitReached) {
          document.claudeAnalysisStatus = "failed";
          document.claudeAnalysisError =
            "You have reached the maximum AI analysis usage for your plan. Please contact your Relationship Manager.";
          await document.save();
          return;
        }


        // Update document with analysis
        document.claudeAnalysisHtml = htmlFilePath;
        document.claudeAnalysisFileName = htmlFileName;
        document.isAutoAnalyzed = false; // Manual analysis
        document.claudeAnalysisStatus = "completed";
        document.analyzedAt = new Date();
        await document.save();

        // Send email with analysis report to franchise user
        try {
          // ===== TEMP-DEBUG-START (remove after staging debugging) =====
          console.log('[TEMP-DEBUG] Reading HTML report for email attachment from:', htmlFilePath);
          // ===== TEMP-DEBUG-END =====
          const htmlBuffer = fs.readFileSync(htmlFilePath);
          await sendAIAnalysisResponseToFranchise(
            {
              email: document.franchiseEmail,
              businessName: document.franchiseName,
            },
            htmlFileName,
            htmlBuffer,
          );
        } catch (emailError) {
          // ===== TEMP-DEBUG-START (remove after staging debugging) =====
          console.error('[TEMP-DEBUG] Email send error in analyzeWithClaude:', {
            message: emailError.message,
            code: emailError.code,
            command: emailError.command,
            response: emailError.response,
            stack: emailError.stack,
          });
          // ===== TEMP-DEBUG-END =====
          console.error("Failed to send analysis report email:", emailError);
        }
      } catch (analysisError) {
        // ===== TEMP-DEBUG-START (remove after staging debugging) =====
        console.error('[TEMP-DEBUG] AI analysis FULL ERROR:', {
          message: analysisError.message,
          stack: analysisError.stack,
          code: analysisError.code,
          httpStatus: analysisError.status,
          errorType: analysisError.constructor?.name,
          filePath: req.file?.path,
          fileKey: req.file?.key,
          fileLocation: req.file?.location,
          NODE_ENV: process.env.NODE_ENV,
          CLAUDE_MODEL: process.env.CLAUDE_MODEL,
          CLAUDE_API_KEY_SET: !!process.env.CLAUDE_API_KEY,
        });
        // ===== TEMP-DEBUG-END =====
        console.error("Claude analysis failed:", analysisError.message);

        // Sanitize error message - hide sensitive API details from users
        let sanitizedError = "Analysis failed. Please contact admin.";

        // Check if it's a Claude API error with credit balance issue
        if (
          analysisError.message &&
          analysisError.message.includes("credit balance is too low")
        ) {
          sanitizedError = "Analysis failed. Please contact admin.";
        } else if (
          analysisError.message &&
          analysisError.message.includes("400")
        ) {
          // For other 400 errors, also show generic message
          sanitizedError = "Analysis failed. Please contact admin.";
        } else {
          // For other errors, still use generic message for security
          sanitizedError = "Analysis failed. Please contact admin.";
        }

        document.claudeAnalysisStatus = "failed";
        document.claudeAnalysisError = sanitizedError;
        await document.save();
      }
    })();

    res.json({
      message:
        "AI analysis initiated. You will receive the report via email once completed.",
      documentId: document._id,
      language: effectiveLanguage,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Download Claude analysis HTML file
const downloadClaudeAnalysis = async (req, res) => {
  try {
    const document = await AIAnalysis.findById(req.params.id);

    if (!document || !document.claudeAnalysisHtml) {
      return res.status(404).json({
        message: "Analysis report not found",
      });
    }

    // Franchise user ke liye credit check
    if (req.user.role === "franchise_user") {
      const franchise = await Franchise.findOne({
        userId: req.user._id,
      });

      if (!franchise) {
        return res.status(404).json({
          message: "Franchise not found",
        });
      }

      if (document.franchise.toString() !== franchise._id.toString()) {
        return res.status(403).json({
          message: "Unauthorized access",
        });
      }

    }

    if (!fs.existsSync(document.claudeAnalysisHtml)) {
      return res.status(404).json({
        message: "Analysis file not found",
      });
    }

    document.downloadCount = (document.downloadCount || 0) + 1;

    await document.save();

    return res.sendFile(path.resolve(document.claudeAnalysisHtml));
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
// Get AI Reports by Franchise
const getFranchiseAIDocuments = async (req, res) => {
  try {
    const { franchiseId } = req.params;

    const reports = await AIAnalysis.find({
      franchise: franchiseId,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: reports,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Download or view original uploaded document (Admin only)
const downloadOriginalDocument = async (req, res) => {
  try {
    const document = await AIAnalysis.findById(req.params.id);

    if (!document || !document.uploadedDocument) {
      return res.status(404).json({
        message: "Original uploaded file not found",
      });
    }

    const originalFilename =
      document.uploadedDocumentName ||
      path.basename(document.uploadedDocument) ||
      "original_document";

    // Sanitize filename for Content-Disposition header
    const safeFilename = originalFilename.replace(/["'\r\n]/g, "_");
    const fileExt = path.extname(originalFilename).toLowerCase();
    const isHtml = fileExt === ".html" || fileExt === ".htm";
    const isPdf = fileExt === ".pdf";

    // Set proper Content-Type
    let contentType = "application/octet-stream";
    if (isPdf) {
      contentType = "application/pdf";
    } else if (isHtml) {
      contentType = "text/html; charset=utf-8";
    }

    // Determine disposition: HTML must ALWAYS be attachment to prevent inline execution on app origin
    const dispositionType = isHtml ? "attachment" : req.query.disposition === "attachment" ? "attachment" : "inline";

    // Handle AWS S3 URLs or Keys (production)
    const isS3Url =
      typeof document.uploadedDocument === "string" &&
      (document.uploadedDocument.startsWith("http://") ||
        document.uploadedDocument.startsWith("https://") ||
        document.uploadedDocument.startsWith("s3://") ||
        document.uploadedDocument.startsWith("kyc-documents/"));

    if (isS3Url) {
      try {
        const aws = require("aws-sdk");
        const s3 = new aws.S3({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          region: process.env.AWS_REGION,
        });

        let s3Key = document.uploadedDocument;
        if (s3Key.startsWith("http://") || s3Key.startsWith("https://")) {
          const urlObj = new URL(s3Key);
          s3Key = decodeURIComponent(urlObj.pathname.replace(/^\/+/, ""));
        }

        const bucketName = process.env.AWS_S3_BUCKET_NAME;
        const s3Params = {
          Bucket: bucketName,
          Key: s3Key,
          Expires: 300, // 5 minutes
          ResponseContentType: contentType,
          ResponseContentDisposition: `${dispositionType}; filename="${safeFilename}"`,
        };

        const signedUrl = await s3.getSignedUrlPromise("getObject", s3Params);
        return res.redirect(signedUrl);
      } catch (s3Error) {
        console.error("S3 error getting presigned URL:", s3Error.message);
        return res.status(500).json({
          message: "Failed to access original file from storage",
          error: s3Error.message,
        });
      }
    }

    // Local file handling
    const resolvedPath = path.resolve(document.uploadedDocument);

    // Path traversal check: verify path exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        message: "Original file not found on disk",
      });
    }

    // Set HTTP response headers
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${dispositionType}; filename="${safeFilename}"`
    );

    // Stream file to client
    return res.sendFile(resolvedPath);
  } catch (error) {
    console.error("Error retrieving original document:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get AI Analysis package usage for logged-in franchise user
const getFranchiseAiUsage = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ userId: req.user.id }).populate(
      "assignedPackages",
    );

    if (!franchise) {
      return res.status(404).json({
        success: false,
        message: "Franchise not found",
      });
    }

    const limitInfo = resolveFranchiseAiLimit(franchise);

    return res.status(200).json({
      success: true,
      hasActivePackage: limitInfo.hasActivePackage,
      packageName: limitInfo.packageName,
      used: limitInfo.used,
      limit: limitInfo.limit,
      isUnlimited: limitInfo.isUnlimited,
      remaining: limitInfo.remaining,
    });
  } catch (error) {
    console.error("Error fetching AI analysis usage:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  uploadDocument,
  getAllDocuments,
  getDocumentById,
  respondToDocument,
  getFranchiseDocuments,
  analyzeWithClaude,
  downloadClaudeAnalysis,
  getFranchiseAIDocuments,
  downloadOriginalDocument,
  getFranchiseAiUsage,
};
