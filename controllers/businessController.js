const axios = require("axios");
const BusinessForm = require("../models/BusinessForm");
const CustomerPackage = require("../models/CustomerPackage");
const Franchise = require("../models/Franchise");
const CreditReport = require("../models/CreditReport");
const User = require("../models/User");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { sendBusinessFormSubmissionEmail } = require("../utils/emailService");
const googleSheetsService = require("../utils/googleSheetsService");
const Transaction = require("../models/Transaction");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Validation for business form submission
const validateBusinessForm = (data) => {
  const requiredFields = [
    "customerName",
    "customerEmail",
    "customerPhone",
    "pincode",
    "state",
    "language",
    "occupation",
    "monthlyIncome",
    "fullAddress",
    "selectedPackage",
  ];

  for (const field of requiredFields) {
    if (!data[field] || data[field].toString().trim() === "") {
      return { isValid: false, message: `${field} is required` };
    }
  }

  // Check if optional fields are provided, and if so, validate them
  if (data.panNumber && data.panNumber.toString().trim() !== "") {
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(data.panNumber.toUpperCase())) {
      return { isValid: false, message: "Invalid PAN number format" };
    }
  }

  if (data.aadharNumber && data.aadharNumber.toString().trim() !== "") {
    const aadharRegex = /^\d{12}$/;
    if (!aadharRegex.test(data.aadharNumber)) {
      return { isValid: false, message: "Aadhar number must be 12 digits" };
    }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.customerEmail)) {
    return { isValid: false, message: "Invalid email format" };
  }

  // Validate phone number (10 digits)
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(data.customerPhone)) {
    return { isValid: false, message: "Phone number must be 10 digits" };
  }

  // Validate PAN number (10 characters)
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (data.panNumber && !panRegex.test(data.panNumber.toUpperCase())) {
    return { isValid: false, message: "Invalid PAN number format" };
  }

  // Validate Aadhar number (12 digits)
  const aadharRegex = /^\d{12}$/;
  if (data.aadharNumber && !aadharRegex.test(data.aadharNumber)) {
    return { isValid: false, message: "Aadhar number must be 12 digits" };
  }

  // Validate monthly income is a positive number
  if (isNaN(data.monthlyIncome) || Number(data.monthlyIncome) <= 0) {
    return {
      isValid: false,
      message: "Monthly income must be a positive number",
    };
  }

  // Validate package ID format
  if (!data.selectedPackage || data.selectedPackage.length !== 24) {
    return { isValid: false, message: "Invalid package selection" };
  }

  return { isValid: true };
};

// Submit business form and initiate payment
//need to be check here after all points clear
const submitBusinessForm = async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      panNumber,
      aadharNumber,
      pincode,
      state,
      language,
      occupation,
      monthlyIncome,
      fullAddress,
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      selectedPackage,
      dob,
      gender,
      bankAccountNumber,
      ifscCode,

      //Admin
      manualAmount,
      franchiseId,
    } = req.body;

    // Check if selected package exists and is active
    // const customerPackage = await CustomerPackage.findById(selectedPackage);
    // if (!customerPackage || !customerPackage.isActive) {
    //   return res
    //     .status(400)
    //     .json({ message: "Invalid or inactive package selected" });
    // }
    let customerPackage = null;

    // Only validate package for non-admin users
    if (selectedPackage) {
      customerPackage = await CustomerPackage.findById(selectedPackage);

      if (!customerPackage || !customerPackage.isActive) {
        return res.status(400).json({
          message: "Invalid or inactive package selected",
        });
      }
    }

    // Get last customer
    const lastCustomer = await BusinessForm.findOne({
      customerId: { $exists: true },
    }).sort({ createdAt: -1 });

    // Default first ID
    let nextCustomerId = "CUST-0001";

    if (lastCustomer && lastCustomer.customerId) {
      const lastNumber = parseInt(lastCustomer.customerId.split("-")[1]);

      const nextNumber = lastNumber + 1;

      nextCustomerId = `CUST-${String(nextNumber).padStart(4, "0")}`;
    }
    // Create business form entry
    const businessForm = new BusinessForm({
      customerId: nextCustomerId,
      //Admin case franchiseId from body
      //Franchise login case req.user.franchiseId

      franchiseId: franchiseId || req.user.franchiseId || null,
      createdBy: req.user._id,

      createdByRole: req.user.role,
      entrySource: req.user.role === "franchise" ? "Franchise" : "Direct Login",
      manualAmount: Number(manualAmount) || 0,
      customerName,
      customerEmail: customerEmail.toLowerCase(),
      customerPhone,
      panNumber: panNumber ? panNumber.toUpperCase() : undefined,
      aadharNumber: aadharNumber || undefined,
      pincode,
      state,
      language,
      occupation,
      monthlyIncome,
      fullAddress,
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      selectedPackage: selectedPackage || null,
      dob,
      gender,
      bankAccountNumber,
      ifscCode,
    });

    await businessForm.save();

    // Sync with Google Sheets (Business Login tab only - franchise dashboard entries)
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncBusinessLoginData(); // Sync to business login/MIS tab
    } catch (syncError) {
      console.error(
        "Failed to sync business form data with Google Sheets:",
        syncError,
      );
    }
    // ADMIN CASE → DIRECT SUCCESS
    // =========================
    if (!selectedPackage) {
      //create manual transaction
      await Transaction.create({
        userId: req.user._id,
        franchiseId: franchiseId || req.user.franchiseId,
        amount: Number(manualAmount || 0),
        currency: "INR",
        orderId: `ADMIN_${Date.now()}`,
        status: "paid",
        paymentMethod: "admin_recharge",
        remarks: "Admin manually created business",
        metadata: {
          businessFormId: businessForm._id,
        },
      });
      return res.json({
        message: "Business form submitted successfully",
        businessFormId: businessForm._id,
      });
    }

    // Create Razorpay order
    const basePrice = customerPackage.price;
    const gstAmount =
      (customerPackage.price * (customerPackage.gstPercentage || 0)) / 100;
    const totalPriceWithGST = basePrice + gstAmount;

    const options = {
      amount: totalPriceWithGST * 100, // amount in paise
      currency: "INR",
      receipt: `receipt_${businessForm._id}`,
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    // Update business form with order ID
    businessForm.razorpayOrderId = order.id;
    await businessForm.save();

    res.json({
      message: "Business form submitted successfully",
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      businessFormId: businessForm._id,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Verify payment and update business form
const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      businessFormId,
    } = req.body;

    // Find the business form with populated selected package
    const businessForm = await BusinessForm.findById(businessFormId).populate(
      "selectedPackage",
      "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
    );
    if (!businessForm) {
      return res.status(404).json({ message: "Business form not found" });
    }

    // Verify payment signature
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
    const generatedSignature = hmac.digest("hex");

    if (generatedSignature !== razorpay_signature) {
      businessForm.paymentStatus = "failed";
      await businessForm.save();
      return res.status(400).json({ message: "Payment verification failed" });
    }

    // Update business form with payment details
    businessForm.paymentStatus = "paid";
    businessForm.razorpayPaymentId = razorpay_payment_id;
    businessForm.razorpaySignature = razorpay_signature;
    await businessForm.save();

    // Sync with Google Sheets to update payment status (Business Login tab only)
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncBusinessLoginData(); // Sync updated payment status
    } catch (syncError) {
      console.error(
        "Failed to sync business login data with Google Sheets:",
        syncError,
      );
    }

    // Send email notifications
    try {
      // Get franchise user details
      const franchise = await Franchise.findById(businessForm.franchiseId);
      const franchiseUser = await User.findById(franchise.userId);

      // Get admin users
      const adminUsers = await User.find({ role: "admin" });

      // Send email to franchise user and all admins
      const recipients = [franchiseUser, ...adminUsers];
      for (const recipient of recipients) {
        if (recipient && recipient.email) {
          await sendBusinessFormSubmissionEmail(
            recipient,
            businessForm,
            franchise,
          );
        }
      }
    } catch (emailError) {
      console.error(
        "Failed to send business form submission email:",
        emailError,
      );
    }

    res.json({
      message: "Payment verified successfully",
      businessForm,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get business forms for franchise user
const getFranchiseBusinessForms = async (req, res) => {
  try {
    const businessForms = await BusinessForm.find({
      franchiseId: req.user.franchiseId,
    })
      .populate(
        "selectedPackage",
        "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
      )
      .populate("franchiseId", "businessName")
      .sort({ createdAt: -1 });

    res.json(businessForms);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all business forms (admin only)
const getAllBusinessForms = async (req, res) => {
  try {
    const businessForms = await BusinessForm.find()
      .populate(
        "selectedPackage",
        "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
      )
      .populate("franchiseId", "businessName")
      .sort({ createdAt: -1 });

    res.json(businessForms);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
//

const closeBusinessCase = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminRemark } = req.body;

    const updatedCase = await BusinessForm.findByIdAndUpdate(
      id,
      {
        workStatus: "Closed",
        closedAt: new Date(),
        adminRemark: adminRemark || "Case completed",
      },
      { new: true },
    );

    if (!updatedCase) {
      return res.status(404).json({ message: "Case not found" });
    }

    res.status(200).json({
      message: "Case closed successfully",
      data: updatedCase,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Get or fetch businessform data on mini crm
// Get single business form by customerId
const getSingleBusinessForm = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Find customer by customerId
    const businessForms = await BusinessForm.findOne({
      customerId: customerId,
    })
      .populate(
        "selectedPackage",
        "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
      )
      .populate("franchiseId", "businessName")
      .sort({ createdAt: -1 });

    if (!businessForms) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }
    const report = await CreditReport.find({
      pan: businessForms.panNumber,
    }).sort({ updatedAt: -1 });

    let bankInfo = null;
    if (businessForms?.bankAccountNumber && businessForms?.ifscCode) {
      try {
        const payload = {
          id_number: businessForms.bankAccountNumber,
          ifsc: businessForms.ifscCode,
          ifsc_details: true,
        };
        const verifyResponse = await axios.post(
          "https://kyc-api.surepass.io/api/v1/bank-verification",
          payload,
          {
            headers: {
              Authorization: `Bearer ${process.env.SUREPASS_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );

        bankInfo = verifyResponse.data;
      } catch (apiError) {
        console.log(apiError?.response?.data);

        bankInfo = {
          success: false,
          error: apiError?.response?.data || apiError.message,
        };
      }
    }
    res.status(200).json({
      success: true,
      data: {
        customerData: businessForms,
        report: report,
        bankInfo,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
};
const uploadDocBusiness = async (req, res) => {
  try {
    console.log(req.files);

    const documents = {
      panCard: req.files?.panCard?.[0]?.path || "",

      aadharFront: req.files?.aadharFront?.[0]?.path || "",

      aadharBack: req.files?.aadharBack?.[0]?.path || "",

      cancelCheque: req.files?.cancelCheque?.[0]?.path || "",

      bankProof: req.files?.bankProof?.[0]?.path || "",

      extraBankDoc: req.files?.extraBankDoc?.[0]?.path || "",
    };

    res.status(200).json({
      success: true,
      message: "Documents uploaded successfully",
      data: documents,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Upload failed",
    });
  }
};
module.exports = {
  submitBusinessForm,
  verifyPayment,
  getFranchiseBusinessForms,
  getAllBusinessForms,
  closeBusinessCase,
  getSingleBusinessForm,
  uploadDocBusiness,
};
