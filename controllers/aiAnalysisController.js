const AIAnalysis = require("../models/AIAnalysis");
const Franchise = require("../models/Franchise");
const { upload } = require("../utils/fileUpload");
const {
  sendAIAnalysisNotificationToAdmin,
  sendAIAnalysisResponseToFranchise,
} = require("../utils/emailService");
const { processDocument } = require("../utils/claudeService");
const path = require("path");
const fs = require("fs");

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

      // Get franchise details
      const franchise = await Franchise.findOne({
        userId: req.user.id,
      }).populate("userId", "name email");

      if (!franchise) {
        // Delete the uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Franchise not found" });
      }

      // Create AI Analysis document record
      const aiAnalysisDoc = new AIAnalysis({
        franchise: franchise._id,
        franchiseName: franchise.businessName,
        franchiseEmail: franchise.email,
        uploadedDocument: req.file.path,
        uploadedDocumentName: req.file.originalname,
        status: "uploaded",
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

          // Process document with Claude
          const analysisResult = await processDocument(
            req.file.path,
            req.file.originalname,
            null, // Use default prompt from env
          );

          // Generate HTML file name
          const htmlFileName = `analysis_${path.basename(req.file.originalname, path.extname(req.file.originalname))}_${Date.now()}.html`;
          const htmlFilePath = path.join(
            path.dirname(req.file.path),
            htmlFileName,
          );

          // Save HTML analysis to file
          fs.writeFileSync(htmlFilePath, analysisResult.content, "utf-8");

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
            console.error("Failed to send analysis report email:", emailError);
            // Keep status as 'completed' but log the error
            aiAnalysisDoc.claudeAnalysisError =
              "Analysis completed but email failed to send";
            await aiAnalysisDoc.save();
          }
        } catch (analysisError) {
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
    const documents = await AIAnalysis.find()
      .populate("franchise", "businessName email")
      .sort({ createdAt: -1 });

    res.json(documents);
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

    // Update status to processing
    document.claudeAnalysisStatus = "processing";
    document.analysisPrompt = req.body.prompt || process.env.AI_ANALYSIS_PROMPT;
    await document.save();

    // Run analysis asynchronously
    (async () => {
      try {
        // Process document with Claude
        const analysisResult = await processDocument(
          document.uploadedDocument,
          document.uploadedDocumentName,
          req.body.prompt || null,
        );

        // Generate HTML file name
        const htmlFileName = `analysis_${path.basename(document.uploadedDocumentName, path.extname(document.uploadedDocumentName))}_${Date.now()}.html`;
        const htmlFilePath = path.join(
          path.dirname(document.uploadedDocument),
          htmlFileName,
        );

        // Save HTML analysis to file
        fs.writeFileSync(htmlFilePath, analysisResult.content, "utf-8");

        // Update document with analysis
        document.claudeAnalysisHtml = htmlFilePath;
        document.claudeAnalysisFileName = htmlFileName;
        document.isAutoAnalyzed = false; // Manual analysis
        document.claudeAnalysisStatus = "completed";
        document.analyzedAt = new Date();
        await document.save();

        // Send email with analysis report to franchise user
        try {
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
          console.error("Failed to send analysis report email:", emailError);
        }
      } catch (analysisError) {
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
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Download Claude analysis HTML file
const downloadClaudeAnalysis = async (req, res) => {
  try {
    //I have changed here for ai analysis unlimited download limit
    const franchise = await Franchise.findOne({ userId: req.user.id });
    if (franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }
    const document = await AIAnalysis.findById(req.params.id);

    if (!document || !document.claudeAnalysisHtml) {
      return res.status(404).json({ message: "Analysis not found" });
    }

    if (document.franchise.toString() !== franchise._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    if (franchise.credits <= 0) {
      return res.status(400).json({
        message: "Credit limit exhausted. Please contact admin.",
      });
    }
    if (!fs.existsSync(document.claudeAnalysisHtml)) {
      return res.status(404).json({ message: "Analysis file not found" });
    }
    //Credit minus
    franchise.credits -= 1;
    await franchise.save();
    document.downloadCount = (document.downloadCount || 0) + 1;
    await document.save();
    //Send File
    res.sendFile(path.resolve(document.claudeAnalysisHtml));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
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
};
