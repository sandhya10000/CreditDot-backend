const axios = require("axios");
const BusinessForm = require("../models/BusinessForm");
const FranchiseCounter = require("../models/FranchiseCounter");
const CustomerPackage = require("../models/CustomerPackage");
const Franchise = require("../models/Franchise");
const CreditReport = require("../models/CreditReport");
const User = require("../models/User");
const { validateAmcTerm } = require("./amcController");
const { scopeFilter, isScoped, ownsFranchise } = require("../utils/franchiseScope");
const cashfree = require("../utils/cashfree");
const mongoose = require("mongoose");
const { getEligibleManagers } = require("../utils/assignBusinessManager");

// Returns the id of an active Business Manager, or null if the value is blank/invalid
const resolveAssignableRmId = async (requestedId) => {
  if (!requestedId || !mongoose.Types.ObjectId.isValid(requestedId)) return null;
  const managers = await getEligibleManagers();
  const match = managers.find((m) => String(m._id) === String(requestedId));
  return match ? match._id : null;
};

// Business Manager that owns a franchise (null if none or franchise missing)
const rmOfFranchise = async (franchiseId) => {
  if (!franchiseId || !mongoose.Types.ObjectId.isValid(franchiseId)) return null;
  const franchise = await Franchise.findById(franchiseId).select("businessManager").lean();
  if (!franchise?.businessManager) return null;
  return resolveAssignableRmId(franchise.businessManager);
};

// Escapes user input so it is matched literally in a regex
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const {
  sendBusinessFormSubmissionEmail,
  sendBusinessWelcomeEmail,
} = require("../utils/emailService");
const googleSheetsService = require("../utils/googleSheetsService");
const Transaction = require("../models/Transaction");


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
// Business login submission emails go only to the partner's RM and full admins
// (admins without a staffRole). Staff accounts and the partner are not included.
const getBusinessLoginRecipients = async (franchise) => {
  const recipients = new Map();

  if (franchise?.businessManager) {
    const rm = await User.findById(franchise.businessManager).select("name email").lean();
    if (rm?.email) recipients.set(rm.email.toLowerCase(), rm);
  }

  const fullAdmins = await User.find({ role: "admin", staffRole: null })
    .select("name email")
    .lean();
  for (const admin of fullAdmins) {
    if (admin.email) recipients.set(admin.email.toLowerCase(), admin);
  }

  return [...recipients.values()];
};

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
      city,
      language,
      occupation,
      monthlyIncome,
      fullAddress,
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      clientIssues,
      selectedPackage,
      dob,
      gender,
      fatherName,
      bankAccountNumber,
      ifscCode,
      documents,
      customerType,
      businessDetails,

      //Admin
      manualAmount,
      franchiseId,
      amc,
      workStatus,

      // Individual customer: optional consultant referral + RM owner
      consultantName,
      consultantPhone,
      consultantEmail,
      assignedRm,
    } = req.body;

    const isBusinessCustomer = customerType === "business";
    if (isBusinessCustomer) {
      const missing = BusinessForm.BUSINESS_DETAIL_FIELDS.filter(
        (field) => !businessDetails?.[field]?.toString().trim(),
      );
      if (missing.length) {
        return res.status(400).json({
          message: `Please fill all business details: ${missing.join(", ")}`,
        });
      }
    }

    // Check if selected package exists and is active

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

    // Admin can enroll the customer in AMC while creating the form (AMC tab)
    let amcTerm = null;
    if (amc && req.user.role === "admin") {
      const { error, term } = validateAmcTerm(amc);
      if (error) return res.status(400).json({ message: error });
      amcTerm = {
        ...term,
        isEnrolled: true,
        enrolledAt: new Date(),
        updatedBy: req.user._id,
        paidAt: term.paymentStatus === "paid" ? new Date() : undefined,
      };
    }

    // Create business form entry
    const businessForm = new BusinessForm({
      ...(amcTerm && { amc: amcTerm }),
      ...(["newly_logged", "in_progress", "closed", "pending"].includes(workStatus) && { workStatus }),
      // customerId: null,
      //Admin case franchiseId from body
      //Franchise login case req.user.franchiseId

      franchiseId: franchiseId || req.user.franchiseId || null,
      createdBy: req.user._id,

      createdByRole: req.user.role,
      entrySource: req.user.role === "franchise" ? "Franchise" : "Direct Login",
      manualAmount: Number(manualAmount) || 0,
      customerType: isBusinessCustomer ? "business" : "individual",
      // Consultant + RM are optional and only meaningful for individual customers
      ...(!isBusinessCustomer && {
        consultant: {
          name: consultantName?.trim() || undefined,
          phone: consultantPhone?.trim() || undefined,
          email: consultantEmail?.trim().toLowerCase() || undefined,
        },
        assignedRm:
          (await resolveAssignableRmId(assignedRm)) ||
          (await rmOfFranchise(franchiseId || req.user.franchiseId)) ||
          null,
      }),
      businessDetails: isBusinessCustomer
        ? {
            directorName: businessDetails.directorName,
            gstUsername: businessDetails.gstUsername,
            gstNumber: businessDetails.gstNumber,
            companyType: businessDetails.companyType,
            companyPanNumber: businessDetails.companyPanNumber,
          }
        : undefined,
      customerName,
      fatherName: fatherName?.trim() || undefined,
      customerEmail: customerEmail.toLowerCase(),
      customerPhone,
      panNumber: panNumber ? panNumber.toUpperCase() : undefined,
      aadharNumber: aadharNumber || undefined,
      pincode,
      state,
      city,
      language,
      occupation,
      monthlyIncome,
      fullAddress,
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      clientIssues: typeof clientIssues === "string" ? clientIssues.trim().slice(0, 1000) : "",
      selectedPackage: selectedPackage || null,
      dob,
      gender,
      bankAccountNumber,
      ifscCode,
      documents,
    });

    await businessForm.save();
    try {
      await sendBusinessWelcomeEmail(businessForm);

      console.log("Sending mail to:", businessForm.customerEmail);
    } catch (emailError) {
      console.error("Welcome email failed:", emailError);
    }
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
      businessForm.paymentStatus = "paid";
      await assignCustomerId(businessForm); // assigns only; does not save
      await businessForm.save();
      return res.json({
        message: "Business form submitted successfully",
        businessFormId: businessForm._id,
      });
    }

    // Create Cashfree order
    const basePrice = customerPackage.price;
    const gstAmount =
      (customerPackage.price * (customerPackage.gstPercentage || 0)) / 100;
    const totalPriceWithGST = Math.round((basePrice + gstAmount) * 100) / 100;

    // Cashfree requires a phone: the customer's, else the partner's
    const phone =
      cashfree.normalizePhone(customerPhone) ||
      cashfree.normalizePhone(
        (await User.findById(req.user._id).select("phone").lean())?.phone,
      );
    if (!phone) {
      return res.status(400).json({
        message: "A valid 10-digit phone number is required for payment",
      });
    }

    const orderId = cashfree.generateOrderId("BIZ");
    const order = await cashfree.createOrder({
      orderId,
      amount: totalPriceWithGST,
      customer: {
        id: businessForm._id,
        name: customerName,
        email: customerEmail,
        phone,
      },
      returnPath: "/franchise/business",
      note: `Business form: ${customerPackage.name}`,
    });

    // Update business form with order ID
    businessForm.paymentGateway = "cashfree";
    businessForm.cashfreeOrderId = orderId;
    await businessForm.save();

    res.json({
      message: "Business form submitted successfully",
      orderId,
      paymentSessionId: order.payment_session_id,
      amount: totalPriceWithGST,
      currency: "INR",
      businessFormId: businessForm._id,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Marks a business form paid and runs the post-payment steps (customer ID, sheet, emails).
// Idempotent: only the caller that flips paymentStatus to "paid" runs the side effects,
// so verify, webhook and reconcile can all call it safely.
const fulfillBusinessForm = async (businessFormId, { paymentId } = {}) => {
  const claimed = await BusinessForm.findOneAndUpdate(
    { _id: businessFormId, paymentStatus: { $ne: "paid" } },
    { $set: { paymentStatus: "paid", ...(paymentId && { cashfreePaymentId: paymentId }) } },
    { new: true },
  );

  const businessForm = await BusinessForm.findById(businessFormId).populate(
    "selectedPackage",
    "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
  );
  if (!claimed) return { businessForm, alreadyPaid: true };

  //Generare Customer ID only after successfuul payment
  await assignCustomerId(businessForm);
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
    const franchise = await Franchise.findById(businessForm.franchiseId);
    const recipients = await getBusinessLoginRecipients(franchise);
    for (const recipient of recipients) {
      await sendBusinessFormSubmissionEmail(recipient, businessForm, franchise);
    }
  } catch (emailError) {
    console.error(
      "Failed to send business form submission email:",
      emailError,
    );
  }

  return { businessForm, alreadyPaid: false };
};

// Expected charge for a business form (package price + its GST)
const businessFormAmount = (form) => {
  const pkg = form.selectedPackage;
  if (!pkg || pkg.price == null) return null;
  const gst = (pkg.price * (pkg.gstPercentage || 0)) / 100;
  return Math.round((pkg.price + gst) * 100) / 100;
};

// Checks a business form order with Cashfree and fulfils it if paid. Used by webhook + reconcile.
const settleBusinessFormOrder = async (orderId) => {
  const form = await BusinessForm.findOne({ cashfreeOrderId: orderId }).populate(
    "selectedPackage",
    "price gstPercentage",
  );
  if (!form || form.paymentStatus === "paid") return form;

  const { paid, cfPaymentId } = await cashfree.confirmOrderPaid(
    orderId,
    businessFormAmount(form),
  );
  if (!paid) return form;

  const result = await fulfillBusinessForm(form._id, { paymentId: cfPaymentId });
  return result.businessForm;
};

// Verify payment and update business form. Body: { orderId, businessFormId }
// Cashfree has no client-side signature, so the order status is read from Cashfree.
const verifyPayment = async (req, res) => {
  try {
    const { orderId, businessFormId } = req.body || {};
    if (!orderId || !businessFormId) {
      return res.status(400).json({ message: "orderId and businessFormId are required" });
    }

    const businessForm = await BusinessForm.findById(businessFormId).populate(
      "selectedPackage",
      "price gstPercentage",
    );
    if (!businessForm || businessForm.cashfreeOrderId !== orderId) {
      return res.status(404).json({ message: "Business form not found" });
    }

    if (businessForm.paymentStatus === "paid") {
      const result = await fulfillBusinessForm(businessForm._id);
      return res.json({ message: "Payment verified successfully", businessForm: result.businessForm });
    }

    const { paid, status, cfPaymentId } = await cashfree.confirmOrderPaid(
      orderId,
      businessFormAmount(businessForm),
    );
    if (!paid) {
      return res.status(400).json({ message: "Payment not completed", status });
    }

    const result = await fulfillBusinessForm(businessForm._id, { paymentId: cfPaymentId });

    res.json({
      message: "Payment verified successfully",
      businessForm: result.businessForm,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get business forms for franchise user
const getFranchiseBusinessForms = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search?.trim() || "";
    const skip = (page - 1) * limit;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { ownerName: { $regex: escapeRegex(search), $options: "i" } },
        { email: { $regex: escapeRegex(search), $options: "i" } },
        { phone: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    const businessForms = await BusinessForm.find({
      franchiseId: req.user.franchiseId,
      ...filter,
    })
      .populate(
        "selectedPackage",
        "name price businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
      )
      .populate("franchiseId", "businessName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await BusinessForm.countDocuments({
      franchiseId: req.user.franchiseId,
      ...filter,
    });

    return res.status(200).json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      businessData: businessForms,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// //get franchise business done details
const getBusinessFormsByFranchise = async (req, res) => {
  try {
    const { _id } = req.params;
    // $and keeps the scope from overwriting the franchiseId being viewed
    const businessForms = await BusinessForm.find({
      $and: [{ franchiseId: _id }, await scopeFilter(req)],
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

// Paid business forms no admin has opened yet, split like the Business MIS sub-pages
const getBusinessUnreadCounts = async (req, res) => {
  try {
    const unread = { isRead: false, paymentStatus: "paid" };
    const [individual, business] = await Promise.all([
      BusinessForm.countDocuments({ ...unread, customerType: { $ne: "business" } }),
      BusinessForm.countDocuments({ ...unread, customerType: "business" }),
    ]);
    res.json({ individual, business, total: individual + business });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Dashboard counts for Business MIS: logged today / this month (IST), and work status pending / closed
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const getBusinessMisCounts = async (req, res) => {
  try {
    // Same visibility as the Business MIS list: scoped users see their own franchises / assigned MIS
    let scope = {};
    if (isScoped(req)) {
      const ownedFranchiseIds = await Franchise.find({ businessManager: req.user._id }).distinct("_id");
      scope = {
        $or: [{ assignedRm: req.user._id }, { franchiseId: { $in: ownedFranchiseIds } }],
      };
    }

    const ist = new Date(Date.now() + IST_OFFSET_MS);
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    const d = ist.getUTCDate();
    const todayStart = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
    const monthStart = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);

    // Follow-up dates are YYYY-MM-DD strings (IST calendar day); week runs Monday to Sunday
    const dayString = (date) => date.toISOString().slice(0, 10);
    const todayKey = dayString(new Date(Date.UTC(y, m, d)));
    const mondayOffset = (ist.getUTCDay() + 6) % 7;
    const weekStartKey = dayString(new Date(Date.UTC(y, m, d - mondayOffset)));
    const weekEndKey = dayString(new Date(Date.UTC(y, m, d - mondayOffset + 6)));

    const [loggedToday, loggedThisMonth, pending, closed, followUpToday, followUpThisWeek] =
      await Promise.all([
        BusinessForm.countDocuments({ ...scope, createdAt: { $gte: todayStart } }),
        BusinessForm.countDocuments({ ...scope, createdAt: { $gte: monthStart } }),
        BusinessForm.countDocuments({ ...scope, workStatus: "pending" }),
        BusinessForm.countDocuments({ ...scope, workStatus: "closed" }),
        BusinessForm.countDocuments({ ...scope, nextFollowUpDate: todayKey }),
        BusinessForm.countDocuments({
          ...scope,
          nextFollowUpDate: { $gte: weekStartKey, $lte: weekEndKey },
        }),
      ]);

    res.json({
      loggedToday,
      loggedThisMonth,
      pending,
      closed,
      followUpToday,
      followUpThisWeek,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Called when an admin opens the individual or business Business MIS list
const markBusinessFormsListRead = async (req, res) => {
  try {
    const { customerType } = req.query;
    if (!["individual", "business"].includes(customerType)) {
      return res.status(400).json({ message: "customerType must be individual or business" });
    }
    const typeFilter =
      customerType === "business" ? { customerType: "business" } : { customerType: { $ne: "business" } };
    const result = await BusinessForm.updateMany(
      { isRead: false, paymentStatus: "paid", ...typeFilter },
      { isRead: true },
    );
    res.json({ success: true, marked: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Called when an admin opens a customer in Business MIS
const markBusinessFormRead = async (req, res) => {
  try {
    const form = await BusinessForm.findByIdAndUpdate(req.params._id, { isRead: true }, { new: true });
    if (!form) return res.status(404).json({ message: "Business form not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getAllBusinessForms = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";
    const paymentStatus = req.query.paymentStatus;

    // Business Managers (scoped users) see MIS assigned to them or from their own franchises; admins see all
    const filter = {};
    if (isScoped(req)) {
      const ownedFranchiseIds = await Franchise.find({ businessManager: req.user._id }).distinct("_id");
      filter.$and = [
        {
          $or: [
            { assignedRm: req.user._id },
            { franchiseId: { $in: ownedFranchiseIds } },
          ],
        },
      ];
    }

    if (
      paymentStatus &&
      ["pending", "paid", "failed"].includes(paymentStatus)
    ) {
      filter.paymentStatus = paymentStatus;
    }

    // Records created before customerType existed count as individual
    if (req.query.customerType === "business") {
      filter.customerType = "business";
    } else if (req.query.customerType === "individual") {
      filter.customerType = { $ne: "business" };
    }

    if (search) {
      const matchingFranchises = await Franchise.find({
        businessName: { $regex: escapeRegex(search), $options: "i" },
      }).select("_id");
      const franchiseIds = matchingFranchises.map((f) => f._id);

      filter.$or = [
        { customerName: { $regex: escapeRegex(search), $options: "i" } },
        { customerEmail: { $regex: escapeRegex(search), $options: "i" } },
        { customerPhone: { $regex: escapeRegex(search), $options: "i" } },
        { customerId: { $regex: escapeRegex(search), $options: "i" } },
      ];

      if (franchiseIds.length > 0) {
        filter.$or.push({ franchiseId: { $in: franchiseIds } });
      }
    }

    const total = await BusinessForm.countDocuments(filter);

    const skip = (page - 1) * limit;

    // Sorting: whitelisted fields only; default is newest first
    const SORT_FIELDS = {
      createdAt: "createdAt",
      customerId: "customerId",
      customerName: "customerName",
    };
    const sortField = SORT_FIELDS[req.query.sortBy] || "createdAt";
    const sortDir = req.query.sortOrder === "asc" ? 1 : -1;
    const sort = { [sortField]: sortDir, _id: sortDir };

    // gstPercentage (for the totalPrice virtual) and franchise phone feed the Business MIS CSV export,
    // matching the customer details page
    let query = BusinessForm.find(filter)
      .populate(
        "selectedPackage",
        "name price gstPercentage businessPayoutPercentage businessPayoutType businessPayoutFixedAmount",
      )
      .populate("franchiseId", "businessName franchiseCode phone")
      .populate("assignedRm", "name staffCode")
      .sort(sort)
      .skip(skip)
      .limit(limit);
    // Numeric-aware, case-insensitive text order so CD9 < CD10 and "adam" < "Bob"
    if (sortField !== "createdAt") {
      query = query.collation({ locale: "en", numericOrdering: true, strength: 2 });
    }
    const businessForms = await query;

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      businessData: businessForms,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
//

//close , hold, In progress
const updateBusinessWorkStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { workStatus } = req.body;
    const isFullAdmin = !req.user.staffRole;

    if (workStatus === "refunded" && !isFullAdmin) {
      return res.status(403).json({ message: "Only Admin can mark a case as Refunded" });
    }

    const scope = { _id: id, ...(await scopeFilter(req)) };
    const existing = await BusinessForm.findOne(scope).select("workStatus");
    if (!existing) {
      return res.status(404).json({ message: "Business form not found" });
    }
    // A refunded case stays refunded unless a full admin changes it
    if (existing.workStatus === "refunded" && !isFullAdmin) {
      return res.status(403).json({ message: "Only Admin can change the status of a Refunded case" });
    }

    const form = await BusinessForm.findOneAndUpdate(
      // Status condition closes the gap if another admin changes it in between
      { ...scope, workStatus: existing.workStatus },
      { workStatus },
      { new: true, runValidators: true },
    );

    if (!form) {
      return res.status(409).json({ message: "The status was just changed by someone else. Please refresh." });
    }

    res.json({
      message: "Work status updated successfully",
      data: form,
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to update work status",
      error: err.message,
    });
  }
};

//Get or fetch businessform data on mini crm
// Get single business form by customerId
const getSingleBusinessForm = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Find customer by customerId (BMs can view all Business MIS data, so no franchise scoping)
    const businessForms = await BusinessForm.findOne({
      customerId: customerId,
    })
      .populate(
        "selectedPackage",
        "name price gstPercentage businessPayoutPercentage businessPayoutType businessPayoutFixedAmount totalPrice",
      )
      .populate("franchiseId", "businessName phone franchiseCode")
      .sort({ createdAt: -1 });

    console.log(businessForms, "businessForms---------");
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
//Update api for customer
const updateBusinessForm = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Only fields the client actually sent are written, so partial edits don't
    // blank out the rest of the record. Workflow fields (work status, AMC, RM,
    // payment) have their own endpoints and are not editable here.
    const EDITABLE_FIELDS = [
      "customerName",
      "customerEmail",
      "customerPhone",
      "whatsappNumber",
      "fatherName",
      "panNumber",
      "aadharNumber",
      "dob",
      "gender",
      "fullAddress",
      "city",
      "state",
      "pincode",
      "language",
      "occupation",
      "monthlyIncome",
      "bankAccountNumber",
      "ifscCode",
      "clientIssues",
    ];
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (typeof updates.customerName === "string") {
      updates.customerName = updates.customerName.trim();
      if (!updates.customerName) {
        return res.status(400).json({
          success: false,
          message: "Customer name cannot be empty",
        });
      }
    }

    if (typeof updates.clientIssues === "string") {
      updates.clientIssues = updates.clientIssues.trim().slice(0, 1000);
    }

    // Optional referral details (individual customers)
    const { consultant } = req.body;
    if (consultant && typeof consultant === "object") {
      for (const key of ["name", "phone", "email"]) {
        if (consultant[key] !== undefined) {
          updates[`consultant.${key}`] = String(consultant[key] ?? "").trim();
        }
      }
    }

    // Business details (business customers); only the fields sent are changed
    const { businessDetails } = req.body;
    if (businessDetails && typeof businessDetails === "object") {
      for (const key of BusinessForm.BUSINESS_DETAIL_FIELDS) {
        if (businessDetails[key] !== undefined) {
          updates[`businessDetails.${key}`] = String(businessDetails[key] ?? "").trim();
        }
      }
    }

    // Franchise link: "" / null unlinks. Scoped managers may only link franchises they own.
    if (req.body.franchiseId !== undefined) {
      const franchiseId = req.body.franchiseId || null;
      if (franchiseId) {
        if (!mongoose.Types.ObjectId.isValid(franchiseId)) {
          return res.status(400).json({ success: false, message: "Invalid franchise" });
        }
        if (!(await ownsFranchise(req, franchiseId))) {
          return res.status(403).json({ success: false, message: "You can only link your own franchises" });
        }
        if (!(await Franchise.exists({ _id: franchiseId }))) {
          return res.status(400).json({ success: false, message: "Franchise not found" });
        }
      }
      updates.franchiseId = franchiseId;
    }

    // Customer package: "" / null clears it; otherwise it must be an active package
    if (req.body.selectedPackage !== undefined) {
      const packageId = req.body.selectedPackage || null;
      if (packageId) {
        const pkg = mongoose.Types.ObjectId.isValid(packageId)
          ? await CustomerPackage.findById(packageId)
          : null;
        if (!pkg || !pkg.isActive) {
          return res.status(400).json({ success: false, message: "Invalid or inactive package selected" });
        }
      }
      updates.selectedPackage = packageId;
    }

    // Load and save (instead of findOneAndUpdate) so the model's validation,
    // including the business-details check, runs on every edit
    const customer = await BusinessForm.findOne({
      customerId,
      ...(await scopeFilter(req)),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    customer.set(updates);
    const updatedCustomer = await customer.save();

    res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: updatedCustomer,
    });
  } catch (error) {
    const isValidationError = error.name === "ValidationError";
    res.status(isValidationError ? 400 : 500).json({
      success: false,
      message: error.message,
    });
  }
};
// controller — admins and staff with the business permission can delete any
// business form, paid or not, so corrupted entries can be removed from MIS
const deleteBusinessForm = async (req, res) => {
  try {
    const { id } = req.params;

    // Same visibility as the MIS list: scoped managers may delete entries
    // assigned to them or belonging to their own franchises
    const filter = { _id: id };
    if (isScoped(req)) {
      const ownedIds = await Franchise.find({ businessManager: req.user._id }).distinct("_id");
      filter.$or = [
        { assignedRm: req.user._id },
        { franchiseId: { $in: ownedIds } },
      ];
    }

    const existing = await BusinessForm.findOne(filter);

    if (!existing) {
      return res.status(404).json({ message: "Business form not found" });
    }

    await BusinessForm.findByIdAndDelete(id);

    res.json({ message: "Business form deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
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

// Numeric max of existing CD<n> IDs (legacy IDs included; 0 if none). Used only to seed the counter.
async function getMaxCustomerSeq() {
  const [row] = await BusinessForm.aggregate([
    { $match: { customerId: { $regex: /^CD\d+$/ } } },
    { $project: { n: { $toInt: { $substrCP: ["$customerId", 2, 100] } } } },
    { $group: { _id: null, max: { $max: "$n" } } },
  ]);
  return row?.max || 0;
}

// Atomic, persistent counter: CD492, CD493, ... Never reset by restarts.
async function nextCustomerSeq() {
  const COUNTER_ID = "customerId";
  const exists = await FranchiseCounter.exists({ _id: COUNTER_ID });
  if (!exists) {
    const seed = await getMaxCustomerSeq();
    try {
      await FranchiseCounter.create({ _id: COUNTER_ID, seq: seed });
    } catch (err) {
      // Another request seeded it concurrently; that is fine.
      if (err.code !== 11000) throw err;
    }
  }
  const counter = await FranchiseCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true },
  );
  return counter.seq;
}

async function assignCustomerId(businessForm) {
  try {
    // Already assigned
    if (businessForm.customerId) {
      return businessForm.customerId;
    }

    const nextNumber = await nextCustomerSeq();
    const customerId = `CD${nextNumber}`;

    businessForm.customerId = customerId;

    return customerId;
  } catch (error) {
    console.error("assignCustomerId error:", error);
    throw error;
  }
}

// Active Business Managers for the "Assign to RM" dropdown
const listAssignableRms = async (req, res) => {
  try {
    const managers = await getEligibleManagers();
    res.json(
      managers.map((m) => ({ _id: m._id, name: m.name, staffCode: m.staffCode })),
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Staff lookup for the Individual Consultant name field (min 3 chars)
const lookupConsultant = async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    if (q.length < 3) return res.json([]);

    const staff = await User.find({
      name: { $regex: escapeRegex(q), $options: "i" },
      staffRole: { $ne: null },
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select("name email phone")
      .limit(5)
      .lean();

    res.json(staff);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Full admins can set or clear the RM on an existing Business MIS entry
const assignBusinessRm = async (req, res) => {
  try {
    const { id } = req.params;
    const { rmId } = req.body;

    const assignedRm = rmId ? await resolveAssignableRmId(rmId) : null;
    if (rmId && !assignedRm) {
      return res.status(400).json({ message: "Selected RM is not an active Business Manager" });
    }

    const updated = await BusinessForm.findByIdAndUpdate(
      id,
      { $set: { assignedRm } },
      { new: true },
    ).populate("assignedRm", "name staffCode");

    if (!updated) {
      return res.status(404).json({ message: "Business form not found" });
    }

    res.json({ message: "RM updated", businessForm: updated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  listAssignableRms,
  lookupConsultant,
  assignBusinessRm,
  updateBusinessForm,
  submitBusinessForm,
  verifyPayment,
  getFranchiseBusinessForms,
  getAllBusinessForms,
  updateBusinessWorkStatus,
  getSingleBusinessForm,
  uploadDocBusiness,
  getBusinessFormsByFranchise,
  deleteBusinessForm,
  assignCustomerId,
  fulfillBusinessForm,
  settleBusinessFormOrder,
  getBusinessUnreadCounts,
  getBusinessMisCounts,
  markBusinessFormRead,
  markBusinessFormsListRead,
};
