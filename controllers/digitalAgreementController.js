const DigitalAgreement = require("../models/DigitalAgreement");
const Franchise = require("../models/Franchise");
const User = require("../models/User");
const Package = require("../models/Package");
const Setting = require("../models/Setting");
const KycRequest = require("../models/KycRequest");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { PDFDocument, rgb } = require("pdf-lib");

const drawTextFromTop = (page, text, x, yFromTop, options = {}) => {
  const { height } = page.getSize();

  page.drawText(text || "", {
    x,
    y: height - yFromTop,
    ...options,
  });
};

// Coordinates for PDF editing
const PDF_COORDINATES = {
  // Page 1 coordinates
  page1: {
    date: {x: 410.0, y_top: 109.33, y_bottom: 732.47},
    name: { x: 111.33, y_top: 456.0, y_bottom: 385.8 },
    pan: { x: 104.67, y_top: 477.33, y_bottom: 364.47 },
    phone: { x: 119.33, y_top: 501.33, y_bottom: 340.47 },
    aadhar: { x: 120.67, y_top: 526.0, y_bottom: 315.8 },
    address: { x: 129.33, y_top: 552.0, y_bottom: 289.8 },
    packagePrice: { x: 76.0, y_top: 468.0, y_bottom: 373.8 }, // Page 2
  },
  // Page 8 coordinates
  page8: {
    address: { x: 158.67, y_top: 211.33, y_bottom: 630.47 },
    name: { x: 114.0, y_top: 630.67, y_bottom: 211.13 },
    date: { x: 108.0, y_top: 678.0, y_bottom: 163.8 },
    mobile: { x: 114.67, y_top: 702.0, y_bottom: 139.8 },
    address2: { x: 126.67, y_top: 725.33, y_bottom: 116.47 },
    pan: { x: 112.0, y_top: 751.33, y_bottom: 90.47 },
  },
  // Page 9 coordinates
  page9: {
    aadhar: { x: 121.33, y_top: 85.33, y_bottom: 756.47 },
  },
};

// Helper function to get Surepass API key
const getSurepassApiKeyValue = async () => {
  try {
    const setting = await Setting.findOne({ key: "surepass_api_key" });
    return setting ? setting.value : process.env.SUREPASS_API_KEY;
  } catch (error) {
    console.error("Error fetching Surepass API key:", error);
    return null;
  }
};

// Generate PDF with user data using coordinates
const generatePdfWithUserData = async (templatePath, userData) => {
  try {
    if (!fs.existsSync(templatePath)) {
      throw new Error("Template PDF not found");
    }

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    const font = await pdfDoc.embedFont("Helvetica");
    const pages = pdfDoc.getPages();

    const currentDate = new Date().toLocaleDateString("en-IN");
    const blackColor = rgb(0, 0, 0);
    const fontSize = 12;

    /* ---------------- PAGE 1 ---------------- */
    if (pages.length >= 1) {
      const page1 = pages[0];

      drawTextFromTop(
        page1,
        currentDate,
        PDF_COORDINATES.page1.date.x,
        PDF_COORDINATES.page1.date.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page1,
        userData.name,
        PDF_COORDINATES.page1.name.x,
        PDF_COORDINATES.page1.name.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page1,
        userData.pan,
        PDF_COORDINATES.page1.pan.x,
        PDF_COORDINATES.page1.pan.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page1,
        userData.phone,
        PDF_COORDINATES.page1.phone.x,
        PDF_COORDINATES.page1.phone.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page1,
        userData.aadhar,
        PDF_COORDINATES.page1.aadhar.x,
        PDF_COORDINATES.page1.aadhar.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page1,
        userData.address,
        PDF_COORDINATES.page1.address.x,
        PDF_COORDINATES.page1.address.y_top,
        {
          size: fontSize,
          font,
          color: blackColor,
          maxWidth: 300,
          lineHeight: 14,
        }
      );
    }

    /* ---------------- PAGE 2 ---------------- */
    if (pages.length >= 2) {
      const page2 = pages[1];

      drawTextFromTop(
        page2,
        userData.packagePrice,
        PDF_COORDINATES.page1.packagePrice.x,
        PDF_COORDINATES.page1.packagePrice.y_top,
        { size: fontSize, font, color: blackColor }
      );
    }

    /* ---------------- PAGE 8 ---------------- */
    if (pages.length >= 8) {
      const page8 = pages[7];

      drawTextFromTop(
        page8,
        userData.address,
        PDF_COORDINATES.page8.address.x,
        PDF_COORDINATES.page8.address.y_top,
        { size: fontSize, font, color: blackColor, maxWidth: 300 }
      );

      drawTextFromTop(
        page8,
        userData.name,
        PDF_COORDINATES.page8.name.x,
        PDF_COORDINATES.page8.name.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page8,
        currentDate,
        PDF_COORDINATES.page8.date.x,
        PDF_COORDINATES.page8.date.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page8,
        userData.phone,
        PDF_COORDINATES.page8.mobile.x,
        PDF_COORDINATES.page8.mobile.y_top,
        { size: fontSize, font, color: blackColor }
      );

      drawTextFromTop(
        page8,
        userData.address,
        PDF_COORDINATES.page8.address2.x,
        PDF_COORDINATES.page8.address2.y_top,
        { size: fontSize, font, color: blackColor, maxWidth: 300 }
      );

      drawTextFromTop(
        page8,
        userData.pan,
        PDF_COORDINATES.page8.pan.x,
        PDF_COORDINATES.page8.pan.y_top,
        { size: fontSize, font, color: blackColor }
      );


    }

    /* ---------------- PAGE 9 ---------------- */
    if (pages.length >= 9) {
      const page9 = pages[8];

      drawTextFromTop(
        page9,
        userData.aadhar,
        PDF_COORDINATES.page9.aadhar.x,
        PDF_COORDINATES.page9.aadhar.y_top,
        { size: fontSize, font, color: blackColor }
      );
    }

    const pdfBytes = await pdfDoc.save();

    const fileName = `agreement_${Date.now()}_${userData.name.replace(
      /\s+/g,
      "_"
    )}.pdf`;
    const outputPath = path.resolve(
      __dirname,
      "../uploads/agreements",
      fileName
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, pdfBytes);

    return outputPath;
  } catch (err) {
    console.error("PDF generation error:", err);
    throw err;
  }
};

// Generate a public URL for the PDF file
const generatePdfPublicUrl = (pdfPath) => {
  try {
    // Extract filename from the full path
    const fileName = path.basename(pdfPath);
    
    // Debug environment variables
    console.log('Environment variables:');
    console.log('- TUNNEL_URL:', process.env.TUNNEL_URL);
    console.log('- BACKEND_URL:', process.env.BACKEND_URL);  
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    
    // Check if we're using a tunnel service like ngrok
    const tunnelUrl = process.env.TUNNEL_URL;
    
    if (tunnelUrl && tunnelUrl !== 'undefined') {
      // Use the tunnel URL for public access
      const publicUrl = `${tunnelUrl}/backend-uploads/agreements/${fileName}`;
      console.log(`✅ Using tunnel URL: ${publicUrl}`);
      return publicUrl;
    } else {
      console.log('⚠️  TUNNEL_URL not found or invalid, falling back to BACKEND_URL');
    }
    
    // For production, you should use a proper CDN or cloud storage
    // Generate the public URL - assuming the backend serves static files from /backend-uploads
    // The PDFs are stored in Backend/uploads/agreements/
    const publicUrl = `${process.env.BACKEND_URL || 'https://reactbackend.creditdost.co.in'}/backend-uploads/agreements/${fileName}`;
    
    // Warn if using localhost in production-like environment
    if (publicUrl.includes('localhost') && process.env.NODE_ENV === 'production') {
      console.warn('WARNING: Using localhost URL in production environment for PDF upload');
    }
    
    console.log(`📤 Generated URL: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error("Error generating PDF public URL:", error);
    throw error;
  }
};

// Upload PDF to SurePass via link with specific client_id
const uploadPdfToSurepassWithClientId = async (apiKey, pdfLink, clientId) => {
  try {
    console.log(`Attempting to upload PDF with client_id ${clientId} from URL: ${pdfLink}`);
    
    const baseUrl = "https://kyc-api.surepass.app";
    
    // Import the Surepass API client
    const surepassClient = require('../utils/surepassApiClient');
    
    // Use rate-limited client for PDF upload
    const response = await surepassClient.makeRequest(
      apiKey,
      `${baseUrl}/api/v1/esign/upload-pdf`,
      {
        client_id: clientId, // Use the client_id from initialization
        link: pdfLink
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    
    console.log(`SurePass upload response:`, response.data);
    
    if (response.data.success && response.data.data.uploaded) {
      return response.data;
    } else {
      throw new Error(`PDF upload failed: ${response.data.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error("SurePass PDF upload error:", error.message);
    console.error("PDF Link attempted:", pdfLink);
    console.error("Client ID used:", clientId);
    
    // Handle specific error cases
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
      
      // Handle 403 Forbidden - account permission issue
      if (error.response.status === 403) {
        throw new Error("SurePass API key lacks permission for PDF upload.");
      }
      
      // Handle 400 Bad Request
      if (error.response.status === 400) {
        const errorMessage = error.response.data.message || 'Bad request';
        
        // Handle specific SurePass messages
        if (errorMessage.includes('Not allowed, user will upload')) {
          // This is a configuration limitation, not an error
          throw new Error("PDF upload via API not permitted for this SurePass account. User must upload manually.");
        }
        
        if (pdfLink.includes('localhost')) {
          throw new Error("Localhost URLs are not accessible to SurePass. Use a public URL or tunnel service like ngrok.");
        }
        
        throw new Error(`Invalid PDF URL or inaccessible file: ${errorMessage}`);
      }
    }
    
    throw error;
  }
};

// Upload PDF to SurePass via link (legacy function for backward compatibility)
const uploadPdfToSurepass = async (apiKey, pdfLink) => {
  try {
    console.log(`Attempting to upload PDF from URL: ${pdfLink}`);
    
    const baseUrl = "https://kyc-api.surepass.app";
    
    // Import the Surepass API client
    const surepassClient = require('../utils/surepassApiClient');
    
    // First, let's try without a specific client_id to see if SurePass assigns one
    // Based on the error, it seems like we need to let SurePass handle client initialization
    const requestBody = {
      link: pdfLink
    };
    
    // Add client_id only if it's specifically required
    // Some SurePass setups require a predefined client_id
    // We'll try without first, then with a generic one if needed
    
    const response = await surepassClient.makeRequest(
      apiKey,
      `${baseUrl}/api/v1/esign/upload-pdf`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    
    console.log(`SurePass upload response:`, response.data);
    
    if (response.data.success && response.data.data.uploaded) {
      return response.data;
    } else {
      throw new Error(`PDF upload failed: ${response.data.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error("SurePass PDF upload error:", error.message);
    console.error("PDF Link attempted:", pdfLink);
    
    // Handle specific error cases
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
      
      // Handle 403 Forbidden - account permission issue
      if (error.response.status === 403) {
        throw new Error("SurePass API key lacks permission for PDF upload. Falling back to manual process.");
      }
      
      // Handle 400 Bad Request - usually invalid URL
      if (error.response.status === 400) {
        if (pdfLink.includes('localhost')) {
          throw new Error("Localhost URLs are not accessible to SurePass. Use a public URL or tunnel service like ngrok.");
        }
        throw new Error(`Invalid PDF URL or inaccessible file: ${error.response.data.message || 'Bad request'}`);
      }
      
      // Handle 404 Client not found
      if (error.response.status === 404) {
        console.log("Client not found - this might be expected behavior. Proceeding with manual fallback.");
        throw new Error("Client initialization required. Falling back to manual upload process.");
      }
    }
    
    throw error;
  }
};

// Initiate Surepass eSign process
const initiateEsign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { signerName, signerEmail, signerPhone } = req.body;

    // Get Surepass API key
    const apiKey = await getSurepassApiKeyValue();

    if (!apiKey) {
      return res
        .status(500)
        .json({ message: "Surepass API key not configured" });
    }

    // Find the digital agreement for this user
    const digitalAgreement = await DigitalAgreement.findOne({
      userId: req.user.id,
    });

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    if (!digitalAgreement.generatedPdfPath) {
      return res.status(400).json({ message: "Generated PDF not found" });
    }

    // Step 1: Initialize eSign session first to get client_id
    const baseUrl = "https://kyc-api.surepass.app";
    
    console.log("Initializing eSign session...");
    
    // Import the Surepass API client
    const surepassClient = require('../utils/surepassApiClient');
    
    // Initialize without PDF first to get client_id using rate-limited client
    const initResponse = await surepassClient.makeRequest(
      apiKey,
      `${baseUrl}/api/v1/esign/initialize`,
      {
        pdf_pre_uploaded: false, // Start without pre-uploaded PDF
        sign_type: "suresign",
        config: {
          auth_mode: "1",
          reason: "General- Agreement",
        },
        prefill_options: {
          full_name: signerName,
          mobile_number: signerPhone,
          user_email: signerEmail,
        },
        positions: {
          1: [
            {
              x: 100,
              y: 200,
            },
          ],
          2: [
            {
              x: 0,
              y: 0,
            },
          ],
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Extract client_id from initialization response
    const client_id = initResponse.data.data.client_id;
    console.log(`Got client_id: ${client_id}`);
    
    // Step 2: Try to upload PDF using the obtained client_id
    let pdfPreUploaded = true;
    let uploadSuccess = true;
    
    try {
      // Generate public URL for the PDF
      const pdfPublicUrl = generatePdfPublicUrl(digitalAgreement.generatedPdfPath);
      
      // Upload the PDF to SurePass with the client_id
      const uploadResponse = await uploadPdfToSurepassWithClientId(apiKey, pdfPublicUrl, client_id);
      pdfPreUploaded = true;
      uploadSuccess = true;
      console.log("PDF uploaded to SurePass successfully with client_id");
    } catch (uploadError) {
      console.log("PDF upload to SurePass not permitted for this account. User will upload manually in SurePass interface.");
      console.log("Error details:", uploadError.message);
      // This is expected behavior for some SurePass accounts
      // Continue with manual process - user will upload PDF in SurePass interface
      pdfPreUploaded = false;
      uploadSuccess = false;
    }
    
    // Step 3: Update the digital agreement with the client_id and set status to submitted
    digitalAgreement.transactionId = client_id; // Store client_id as transactionId in DB
    digitalAgreement.status = "submitted"; // Mark as submitted for signing
    await digitalAgreement.save();

    res.json({
      message: uploadSuccess 
        ? "eSign process initiated successfully with automatic PDF upload" 
        : "eSign process initiated successfully. Please upload your agreement when prompted in the SurePass interface.",
      redirectUrl: initResponse.data.data.url,
      transactionId: client_id,
      pdfUploadSuccess: uploadSuccess
    });
  } catch (error) {
    console.error("Surepass eSign initiation error:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        message: "eSign initiation failed",
        error: error.response.data,
      });
    }

    res.status(500).json({
      message: "An error occurred while initiating eSign process",
      error: error.message,
    });
  }
};

// Webhook to receive eSign completion notification
const eSignWebhook = async (req, res) => {
  try {
    // Verify webhook signature if needed
    // const signature = req.headers['x-surepass-signature'];
    // const computedSignature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');

    // if (signature !== computedSignature) {
    //   return res.status(401).json({ message: 'Invalid signature' });
    // }

    const { transaction_id, client_id, status, signed_document_url } =
      req.body.data;

    // Find the digital agreement by transaction ID - try multiple possible fields for flexibility
    // According to SurePass documentation and common integration patterns
    const digitalAgreement = await DigitalAgreement.findOne({
      $or: [
        { transactionId: transaction_id }, // Standard transaction_id field
        { transactionId: client_id }, // SurePass client_id field
        { transactionId: req.body.data.id }, // Alternative id field sometimes used
      ],
    });

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    // Update agreement status based on eSign status
    if (status === "completed") {
      // Download and save the signed document
      // Using axios directly here since this is a download operation, not a Surepass API call
      const response = await axios({
        method: "GET",
        url: signed_document_url,
        responseType: "stream",
      });

      // Generate filename for signed document
      const fileName = `signed_agreement_${Date.now()}_${digitalAgreement.userName.replace(
        /\s+/g,
        "_"
      )}.pdf`;
      const outputPath = path.resolve(
        __dirname,
        "../uploads/signed-agreements",
        fileName
      );

      // Ensure the directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Save the signed document
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      // Wait for the file to be written
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // Update the digital agreement - set status to completed
      digitalAgreement.status = "completed";
      digitalAgreement.signedPdfPath = outputPath;
      await digitalAgreement.save();
    } else if (status === "failed") {
      digitalAgreement.status = "pending";
      await digitalAgreement.save();
    }

    res.json({ message: "Webhook received successfully" });
  } catch (error) {
    console.error("eSign webhook error:", error.message);
    res
      .status(500)
      .json({ message: "Webhook processing failed", error: error.message });
  }
};

// Create a new digital agreement for a franchise user
const createDigitalAgreement = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get the franchise associated with the user
    const franchise = await Franchise.findOne({ userId });

    if (!franchise) {
      return res.status(404).json({ message: "Franchise not found" });
    }

    // Get user details
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if an agreement already exists for this user
    const existingAgreement = await DigitalAgreement.findOne({ userId });

    if (existingAgreement) {
      return res
        .status(400)
        .json({ message: "Digital agreement already exists for this user" });
    }

    // Path to the shared template PDF
    const templatePath = path.resolve(
      __dirname,
      "../templates/franchise_agreement_template.pdf"
    );

    // Get user data for PDF editing
    const userData = {
      name: user.name,
      email: user.email,
      phone: user.mobile || "",
      pan: franchise.panNumber || "",
      aadhar: franchise.aadharNumber || "",
      address: franchise.businessAddress || "",
      packagePrice: "Rs. 0", // Default value to avoid encoding issues
    };

    // Get the price of the assigned packages
    if (franchise.assignedPackages && franchise.assignedPackages.length > 0) {
      const packages = await Package.find({ _id: { $in: franchise.assignedPackages } });
      if (packages.length > 0) {
        // Use the price of the first assigned package as the packagePrice
        // Or sum all if multiple packages are assigned
        const totalPrice = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);
        userData.packagePrice = `Rs. ${totalPrice.toLocaleString()}`;
      }
    }

    // Generate PDF with user data
    const generatedPdfPath = await generatePdfWithUserData(
      templatePath,
      userData
    );

    // Create the digital agreement record
    const digitalAgreement = new DigitalAgreement({
      franchiseId: franchise._id,
      userId: userId,
      templatePath: templatePath,
      generatedPdfPath: generatedPdfPath,
      userName: user.name,
      status: "pending",
    });

    await digitalAgreement.save();

    res.status(201).json({
      message: "Digital agreement created successfully",
      agreement: digitalAgreement,
    });
  } catch (error) {
    console.error("Error creating digital agreement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get digital agreement for a franchise user
const getDigitalAgreement = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the digital agreement for the user
    let digitalAgreement = await DigitalAgreement.findOne({ userId })
      .populate("franchiseId", "businessName")
      .populate("userId", "name email");

    if (!digitalAgreement) {
      // Check if user has completed their profile with data from appropriate sources
      const franchise = await Franchise.findOne({ userId });

      if (!franchise) {
        return res.status(404).json({ message: "Franchise not found" });
      }

      // Get user details
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get KYC request to check for Aadhar number
      const kycRequest = await KycRequest.findOne({
        franchiseId: franchise._id,
      });

      // Check if profile is complete with data from appropriate sources
      // PAN should be in franchise record (from SurePass)
      // Aadhar should be in KYC request (from KYC submission)
      // Address should be in franchise record (manually entered) - either businessAddress or address structure
      // Phone should be in franchise record (manually entered)
      const isProfileComplete =
        franchise.panNumber &&
        (kycRequest?.aadhaarNumber || franchise.aadharNumber) &&
        (franchise.businessAddress ||
          (franchise.address?.street && franchise.address?.city)) &&
        franchise.phone;

      if (!isProfileComplete) {
        // Identify which fields are missing
        const missingFields = [];
        if (!franchise.panNumber)
          missingFields.push("PAN Number (from Profile)");
        if (!(kycRequest?.aadhaarNumber || franchise.aadharNumber))
          missingFields.push("Aadhar Number (from KYC)");
        if (
          !(
            franchise.businessAddress ||
            (franchise.address?.street && franchise.address?.city)
          )
        )
          missingFields.push("Business Address (from Profile)");
        if (!franchise.phone)
          missingFields.push("Mobile Number (from Profile)");

        // Profile is not complete, prompt user to update profile first
        return res.status(400).json({
          message: `Please complete your profile. Missing required fields: ${missingFields.join(
            ", "
          )}.`,
          requireProfileUpdate: true,
          missingFields: missingFields,
        });
      }

      // Check if user has purchased a package
      // In a real implementation, you would check if the user has an active package
      // For now, we'll assume they have a package if they've completed their profile

      // Path to the shared template PDF
      const templatePath = path.resolve(
        __dirname,
        "../templates/franchise_agreement_template.pdf"
      );

      // Check if template exists
      if (!fs.existsSync(templatePath)) {
        return res.status(500).json({
          message:
            "Agreement template not found. Please contact administrator.",
        });
      }

      // Get user data for PDF editing
      // This data should come from verified sources (SurePass APIs) and manual entries
      const userData = {
        name: user.name,
        email: user.email,
        phone: franchise.phone || "", // Get phone from franchise record
        pan: franchise.panNumber || "",
        aadhar: kycRequest?.aadhaarNumber || franchise.aadharNumber || "",
        address:
          franchise.businessAddress ||
          (franchise.address
            ? `${franchise.address.street || ""}, ${
                franchise.address.city || ""
              }, ${franchise.address.state || ""} - ${
                franchise.address.pincode || ""
              }`.replace(/^, |, $/g, "")
            : ""),
        packagePrice: "Rs. 0", // Default value, will be updated when package is selected
      };

      // Get the price of the assigned packages
      if (franchise.assignedPackages && franchise.assignedPackages.length > 0) {
        const packages = await Package.find({ _id: { $in: franchise.assignedPackages } });
        if (packages.length > 0) {
          // Use the price of the first assigned package as the packagePrice
          // Or sum all if multiple packages are assigned
          const totalPrice = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);
          userData.packagePrice = `Rs. ${totalPrice.toLocaleString()}`;
        }
      }

      // Generate PDF with user data
      const generatedPdfPath = await generatePdfWithUserData(
        templatePath,
        userData
      );

      // Create the digital agreement record
      digitalAgreement = new DigitalAgreement({
        franchiseId: franchise._id,
        userId: userId,
        templatePath: templatePath,
        generatedPdfPath: generatedPdfPath,
        userName: user.name,
        status: "pending",
      });

      await digitalAgreement.save();
    }

    res.json(digitalAgreement);
  } catch (error) {
    console.error("Error fetching digital agreement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Download the generated PDF
const downloadGeneratedPdf = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the digital agreement for the user
    const digitalAgreement = await DigitalAgreement.findOne({ userId });

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    // Check if generated PDF exists
    if (!fs.existsSync(digitalAgreement.generatedPdfPath)) {
      return res.status(404).json({ message: "Generated PDF not found" });
    }

    // Update status to downloaded
    digitalAgreement.status = "downloaded";
    await digitalAgreement.save();

    // Set headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=franchise_agreement_${digitalAgreement.userName.replace(
        /\s+/g,
        "_"
      )}.pdf`
    );

    // Send the PDF file
    res.sendFile(digitalAgreement.generatedPdfPath);
  } catch (error) {
    console.error("Error downloading PDF:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Submit the signed PDF (Deprecated - Auto-handled by webhook)
const submitSignedPdf = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the digital agreement for the user
    const digitalAgreement = await DigitalAgreement.findOne({ userId });

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    // Inform user that this process is now automated
    res.status(400).json({
      message:
        "Manual submission is no longer required. The system automatically tracks eSign completion via webhook.",
    });
  } catch (error) {
    console.error("Error handling signed PDF submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ADMIN ROUTES

// Get all digital agreements (admin only)
const getAllDigitalAgreements = async (req, res) => {
  try {
    const agreements = await DigitalAgreement.find()
      .populate("franchiseId", "businessName")
      .populate("userId", "name email")
      .sort({ createdAt: -1 });

    res.json(agreements);
  } catch (error) {
    console.error("Error fetching digital agreements:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get a specific digital agreement by ID (admin only)
const getDigitalAgreementById = async (req, res) => {
  try {
    const { id } = req.params;

    const digitalAgreement = await DigitalAgreement.findById(id)
      .populate("franchiseId", "businessName")
      .populate("userId", "name email");

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    res.json(digitalAgreement);
  } catch (error) {
    console.error("Error fetching digital agreement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Approve a digital agreement (admin only)
const approveDigitalAgreement = async (req, res) => {
  try {
    const { id } = req.params;

    const digitalAgreement = await DigitalAgreement.findByIdAndUpdate(
      id,
      { status: "approved" },
      { new: true }
    )
      .populate("franchiseId", "businessName")
      .populate("userId", "name email");

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    res.json({
      message: "Digital agreement approved successfully",
      agreement: digitalAgreement,
    });
  } catch (error) {
    console.error("Error approving digital agreement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reject a digital agreement (admin only)
const rejectDigitalAgreement = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const digitalAgreement = await DigitalAgreement.findByIdAndUpdate(
      id,
      {
        status: "rejected",
        rejectionReason: rejectionReason,
      },
      { new: true }
    )
      .populate("franchiseId", "businessName")
      .populate("userId", "name email");

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    res.json({
      message: "Digital agreement rejected successfully",
      agreement: digitalAgreement,
    });
  } catch (error) {
    console.error("Error rejecting digital agreement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Download signed PDF (admin only)
const downloadSignedPdf = async (req, res) => {
  try {
    const { id } = req.params;

    const digitalAgreement = await DigitalAgreement.findById(id);

    if (!digitalAgreement) {
      return res.status(404).json({ message: "Digital agreement not found" });
    }

    // Check if signed PDF exists
    if (
      !digitalAgreement.signedPdfPath ||
      !fs.existsSync(digitalAgreement.signedPdfPath)
    ) {
      return res.status(404).json({ message: "Signed PDF not found" });
    }

    // Set headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=signed_agreement_${digitalAgreement.userName.replace(
        /\s+/g,
        "_"
      )}.pdf`
    );

    // Send the PDF file
    res.sendFile(digitalAgreement.signedPdfPath);
  } catch (error) {
    console.error("Error downloading signed PDF:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update function to set package price in existing agreement
const updateAgreementPackageDetails = async (userId, packageDetails) => {
  try {
    // Find the digital agreement for the user
    const digitalAgreement = await DigitalAgreement.findOne({ userId });

    if (!digitalAgreement) {
      throw new Error("Digital agreement not found");
    }

    // Get the latest franchise and user data to ensure we have current information
    const franchise = await Franchise.findOne({ userId });
    const user = await User.findById(userId);

    if (!franchise || !user) {
      throw new Error("Franchise or user not found");
    }

    // Get the price of the assigned packages
    let packagePrice = "Rs. 0";
    if (franchise.assignedPackages && franchise.assignedPackages.length > 0) {
      const packages = await Package.find({ _id: { $in: franchise.assignedPackages } });
      if (packages.length > 0) {
        // Sum all assigned packages prices
        const totalPrice = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);
        packagePrice = `Rs. ${totalPrice.toLocaleString()}`;
      }
    }

    // Update the package price in the PDF by regenerating it
    const templatePath = digitalAgreement.templatePath;

    // Get complete user data for PDF editing
    const userData = {
      name: user.name,
      email: user.email,
      phone: user.mobile || "",
      pan: franchise.panNumber || "",
      aadhar: franchise.aadharNumber || "",
      address: franchise.businessAddress || "",
      packagePrice: packagePrice,
    };

    // Regenerate the PDF with updated package details
    const generatedPdfPath = await generatePdfWithUserData(
      templatePath,
      userData
    );

    // Update the digital agreement record with new PDF path
    digitalAgreement.generatedPdfPath = generatedPdfPath;
    await digitalAgreement.save();

    console.log("Package details updated for user:", userId);

    return digitalAgreement;
  } catch (error) {
    console.error("Error updating agreement package details:", error);
    throw error;
  }
};

module.exports = {
  createDigitalAgreement,
  getDigitalAgreement,
  downloadGeneratedPdf,
  submitSignedPdf,
  getAllDigitalAgreements,
  getDigitalAgreementById,
  approveDigitalAgreement,
  rejectDigitalAgreement,
  downloadSignedPdf,
  initiateEsign,
  eSignWebhook,
  updateAgreementPackageDetails,
};
