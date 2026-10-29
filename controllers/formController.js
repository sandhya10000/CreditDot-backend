const Joi = require("joi");
const googleSheetsService = require("../utils/googleSheetsService");
const CreditRepair = require("../models/CreditRepair");
const CreditReport = require("../models/CreditReport");
const ContactForm = require("../models/ContactForm");
const FranchiseOpportunity = require("../models/FranchiseOpportunity");
const BusinessForm = require("../models/BusinessForm");
const SuvidhaCentreApplication = require("../models/SuvidhaCentreApplication");
const User = require("../models/User");
const {
  sendContactFormEmail,
  sendFranchiseOpportunityEmail,
  sendBusinessFormSubmissionEmail,
  sendSuvidhaCentreApplicationEmail,
  sendCreditRepairFormEmail,
  sendApplyForLoanFormEmail,
} = require("../utils/emailService");

// Validation schema for credit repair form
const creditRepairSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  mobileNumber: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  city: Joi.string().optional(),
  state: Joi.string().required(),
  problemType: Joi.string().required(),
  creditScore: Joi.string().optional(),
  message: Joi.string().optional(),
  language: Joi.string().optional(),
  occupation: Joi.string().optional(),
  income: Joi.string().optional(),
});

// Validation schema for contact form
const contactFormSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).optional(),
  subject: Joi.string().optional(),
  message: Joi.string().required(),
});

// Validation schema for franchise opportunity form
const franchiseOpportunitySchema = Joi.object({
  fullName: Joi.string().min(2).max(100).required(),
  mobileNumber: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  email: Joi.string().email().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  profession: Joi.string().required(),
  message: Joi.string().optional(),
  consent: Joi.boolean().required(),
});

// Validation schema for business form (apply for loan)
const businessFormSchema = Joi.object({
  customerName: Joi.string().min(2).max(100).required(),
  customerEmail: Joi.string().email().required(),
  customerPhone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  panNumber: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .required(),
  aadharNumber: Joi.string()
    .pattern(/^[0-9]{12}$/)
    .required(),
  city: Joi.string().optional(),
  state: Joi.string().required(), 
  pincode: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required(),
  occupation: Joi.string().required(),
  monthlyIncome: Joi.number().positive().required(),
  fullAddress: Joi.string().required(),
  language: Joi.string().optional(),
  whatsappNumber: Joi.string().optional(),
  creditScore: Joi.string().optional(),
  loanAmount: Joi.string().optional(),
  loanPurpose: Joi.string().optional(),
  message: Joi.string().optional(),
  selectedPackage: Joi.any().optional(),
}).options({ stripUnknown: true });

// Validation schema for suvidha centre application form
const suvidhaCentreApplicationSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).required(),
  mobileNumber: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required(),
  whatsappNumber: Joi.string().pattern(/^[0-9]{10}$/).optional(),
  email: Joi.string().email().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  pincode: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required(),
  occupation: Joi.string().required(),
  financeExperience: Joi.string().required(),
  smartphoneLaptop: Joi.string().required(),
  communication: Joi.string().required(),
  investmentReadiness: Joi.string().required(),
  consent: Joi.boolean().required(),
});

// Submit credit repair form
const submitCreditRepairForm = async (req, res) => {
  try {
    console.log("Received credit repair form data:", req.body);
    // Validate request body
    const { error } = creditRepairSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      console.log("Validation errors:", error.details);
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const {
      fullName,
      email,
      mobileNumber,
      city,
      state,
      problemType,
      creditScore,
      message,
      language,
      occupation,
      income,
    } = req.body;

    // Save to database
    const creditRepair = new CreditRepair({
      fullName,
      email,
      mobileNumber,
      city,
      state,
      problemType,
      creditScore,
      message,
      language,
      occupation,
      income,
    });
    await creditRepair.save();

    // Send email to admin
    try {
      await sendCreditRepairFormEmail(creditRepair);
    } catch (emailError) {
      console.error("Failed to send credit repair form email to admin:", emailError);
      // Don't fail the request if email sending fails
    }

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncCreditRepairData();
    } catch (syncError) {
      console.error(
        "Failed to sync credit repair data with Google Sheets:",
        syncError
      );
      // Don't fail the request if Google Sheets sync fails
    }

    res.json({
      message: "Credit repair form submitted successfully",
    });
  } catch (error) {
    console.error("Credit repair form submission error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Submit contact form
const submitContactForm = async (req, res) => {
  try {
    // Validate request body
    const { error } = contactFormSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const { name, email, mobileNumber, subject, message } = req.body;

    // Save to database
    const contactForm = new ContactForm({
      name,
      email,
      mobileNumber,
      subject,
      message,
    });
    await contactForm.save();

    // Send email to admin
    try {
      await sendContactFormEmail(contactForm);
    } catch (emailError) {
      console.error("Failed to send contact form email to admin:", emailError);
      // Don't fail the request if email sending fails
    }

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncContactFormData();
    } catch (syncError) {
      console.error(
        "Failed to sync contact form data with Google Sheets:",
        syncError
      );
      // Don't fail the request if Google Sheets sync fails
    }

    res.json({
      message: "Contact form submitted successfully",
    });
  } catch (error) {
    console.error("Contact form submission error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Submit franchise opportunity form
const submitFranchiseOpportunityForm = async (req, res) => {
  try {
    // Validate request body
    const { error } = franchiseOpportunitySchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const {
      fullName,
      mobileNumber,
      email,
      city,
      state,
      profession,
      message,
      consent,
    } = req.body;

    // Save to database
    const franchiseOpportunity = new FranchiseOpportunity({
      fullName,
      mobileNumber,
      email,
      city,
      state,
      profession,
      message,
      consent,
    });
    await franchiseOpportunity.save();

    // Send email to admin
    try {
      await sendFranchiseOpportunityEmail(franchiseOpportunity);
    } catch (emailError) {
      console.error(
        "Failed to send franchise opportunity email to admin:",
        emailError
      );
      // Don't fail the request if email sending fails
    }

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncFranchiseOpportunityData();
    } catch (syncError) {
      console.error(
        "Failed to sync franchise opportunity data with Google Sheets:",
        syncError
      );
      // Don't fail the request if Google Sheets sync fails
    }

    res.json({
      message: "Franchise opportunity form submitted successfully",
    });
  } catch (error) {
    console.error("Franchise opportunity form submission error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Submit business form (apply for loan)
const submitBusinessForm = async (req, res) => {
  try {
    // Validate request body
    const { error } = businessFormSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const {
      customerName,
      customerEmail,
      customerPhone,
      panNumber,
      aadharNumber,
      city,
      state,
      pincode,
      occupation,
      monthlyIncome,
      fullAddress,
      language,
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      selectedPackage,
    } = req.body;

    // Create business form entry
    const businessForm = new BusinessForm({
      customerName,
      customerEmail: customerEmail.toLowerCase(),
      customerPhone,
      panNumber: panNumber ? panNumber.toUpperCase() : null,
      aadharNumber: aadharNumber || null,
      city,
      state,
      pincode,
      occupation,
      monthlyIncome,
      fullAddress,
      // Set default values for fields not provided in public form
      language: language || "en",
      whatsappNumber,
      creditScore,
      loanAmount,
      loanPurpose,
      message,
      selectedPackage: selectedPackage || undefined,
    });

    await businessForm.save();

    // Send email to admin
    try {
      await sendApplyForLoanFormEmail(businessForm);
    } catch (emailError) {
      console.error(
        "Failed to send apply for loan form submission email:",
        emailError
      );
      // Don't fail the request if email sending fails
    }

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncBusinessFormData();
    } catch (syncError) {
      console.error(
        "Failed to sync business form data with Google Sheets:",
        syncError
      );
      // Don't fail the request if Google Sheets sync fails
    }

    res.json({
      message: "Business form submitted successfully",
    });
  } catch (error) {
    console.error("Business form submission error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Submit suvidha centre application form
const submitSuvidhaCentreApplicationForm = async (req, res) => {
  try {
    console.log("Received suvidha centre application form data:", req.body);
    // Validate request body
    const { error } = suvidhaCentreApplicationSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      console.log("Validation errors:", error.details);
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const {
      fullName,
      mobileNumber,
      whatsappNumber,
      email,
      city,
      state,
      pincode,
      occupation,
      financeExperience,
      smartphoneLaptop,
      communication,
      investmentReadiness,
      consent,
    } = req.body;

    // Save to database
    const suvidhaCentreApplication = new SuvidhaCentreApplication({
      fullName,
      mobileNumber,
      whatsappNumber,
      email,
      city,
      state,
      pincode,
      occupation,
      financeExperience,
      smartphoneLaptop,
      communication,
      investmentReadiness,
      consent,
    });
    await suvidhaCentreApplication.save();

    // Send email to admin
    try {
      await sendSuvidhaCentreApplicationEmail(suvidhaCentreApplication);
    } catch (emailError) {
      console.error("Failed to send suvidha centre application email to admin:", emailError);
      // Don't fail the request if email sending fails
    }

    // Sync with Google Sheets
    try {
      await googleSheetsService.initialize();
      await googleSheetsService.syncSuvidhaCentreApplicationData();
    } catch (syncError) {
      console.error(
        "Failed to sync suvidha centre application data with Google Sheets:",
        syncError
      );
      // Don't fail the request if Google Sheets sync fails
    }

    res.json({
      message: "Suvidha Centre application submitted successfully",
    });
  } catch (error) {
    console.error("Suvidha Centre application form submission error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Problem type written by the WhatsApp "Contact Support" webhook. Older leads have no
// `source` value, so this is also used as a fallback to identify them.
const WHATSAPP_PROBLEM_TYPE = "Low credit score (WhatsApp)";

const escapeRegex = (value) => value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ?from=YYYY-MM-DD&to=YYYY-MM-DD on createdAt (IST, both inclusive)
const buildDateClause = ({ from, to }) => {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
  return { createdAt: range };
};

// Filter on the numeric value of the stored creditScore string (non-numeric -> 0)
const buildScoreClause = ({ minScore, maxScore }) => {
  const score = { $convert: { input: "$creditScore", to: "int", onError: 0, onNull: 0 } };
  const conditions = [];
  if (minScore) conditions.push({ $gte: [score, parseInt(minScore, 10)] });
  if (maxScore) conditions.push({ $lte: [score, parseInt(maxScore, 10)] });
  return conditions.length ? { $expr: { $and: conditions } } : null;
};

// Admin endpoints for credit repair forms
const getAllCreditRepairEnquiries = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const clauses = [];

    if (req.query.search) {
      const searchRegex = new RegExp(escapeRegex(req.query.search), "i");
      clauses.push({
        $or: [
          { fullName: searchRegex },
          { mobileNumber: searchRegex },
          { email: searchRegex },
        ],
      });
    }

    if (req.query.source === "whatsapp") {
      clauses.push({ $or: [{ source: "whatsapp" }, { problemType: WHATSAPP_PROBLEM_TYPE }] });
    } else if (req.query.source === "website") {
      clauses.push({ source: { $ne: "whatsapp" } }, { problemType: { $ne: WHATSAPP_PROBLEM_TYPE } });
    }

    if (req.query.problemType) clauses.push({ problemType: req.query.problemType });
    if (req.query.status) clauses.push({ status: req.query.status });
    if (req.query.state) clauses.push({ state: req.query.state });
    if (req.query.language) clauses.push({ language: req.query.language });

    const dateClause = buildDateClause(req.query);
    if (dateClause) clauses.push(dateClause);

    const scoreClause = buildScoreClause(req.query);
    if (scoreClause) clauses.push(scoreClause);

    // Bureau lives on the linked CreditReport, so resolve matching leads through it
    if (req.query.bureau) {
      const leadIds = await CreditReport.distinct("supportLeadId", {
        bureau: req.query.bureau,
        supportLeadId: { $ne: null },
      });
      clauses.push({ _id: { $in: leadIds } });
    }

    const query = clauses.length ? { $and: clauses } : {};

    const enquiries = await CreditRepair.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CreditRepair.countDocuments(query);

    // Attach the linked credit report (bureau, PAN, score, prompt time) for WhatsApp leads
    const reports = await CreditReport.find({
      supportLeadId: { $in: enquiries.map((e) => e._id) },
    })
      .select("supportLeadId bureau pan score lowScorePromptSentAt")
      .lean();
    const reportByLead = new Map(reports.map((r) => [String(r.supportLeadId), r]));

    const data = enquiries.map((enquiry) => {
      const report = reportByLead.get(String(enquiry._id));
      return {
        ...enquiry.toObject(),
        source: enquiry.source || (enquiry.problemType === WHATSAPP_PROBLEM_TYPE ? "whatsapp" : "website"),
        creditReport: report
          ? {
              bureau: report.bureau,
              pan: report.pan,
              score: report.score,
              lowScorePromptSentAt: report.lowScorePromptSentAt,
            }
          : null,
      };
    });

    res.json({
      enquiries: data,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Get credit repair enquiries error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateCreditRepairStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const enquiry = await CreditRepair.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!enquiry) {
      return res.status(404).json({ message: "Enquiry not found" });
    }

    res.json({ message: "Status updated successfully", enquiry });
  } catch (error) {
    console.error("Update credit repair status error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const deleteCreditRepairEnquiry = async (req, res) => {
  try {
    const { id } = req.params;

    const enquiry = await CreditRepair.findByIdAndDelete(id);

    if (!enquiry) {
      return res.status(404).json({ message: "Enquiry not found" });
    }

    res.json({ message: "Enquiry deleted successfully" });
  } catch (error) {
    console.error("Delete credit repair enquiry error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Admin endpoints for website franchise leads
const getAllFranchiseLeads = async (req, res) => {
  try {
    const clauses = [];

    if (req.query.search) {
      const searchRegex = new RegExp(escapeRegex(req.query.search), "i");
      clauses.push({
        $or: [
          { fullName: searchRegex },
          { mobileNumber: searchRegex },
          { email: searchRegex },
          { city: searchRegex },
          { state: searchRegex },
        ],
      });
    }

    if (req.query.status) clauses.push({ status: req.query.status });
    if (req.query.state) clauses.push({ state: req.query.state });
    if (req.query.profession) clauses.push({ profession: req.query.profession });

    const dateClause = buildDateClause(req.query);
    if (dateClause) clauses.push(dateClause);

    const query = clauses.length ? { $and: clauses } : {};

    // Paginated mode when ?page is sent; otherwise the full list (existing callers)
    if (req.query.page) {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 10;
      const [leads, total] = await Promise.all([
        FranchiseOpportunity.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        FranchiseOpportunity.countDocuments(query),
      ]);
      return res.json({
        leads,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    }

    const leads = await FranchiseOpportunity.find(query).sort({ createdAt: -1 });

    res.json({ leads, total: leads.length });
  } catch (error) {
    console.error("Get franchise leads error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateFranchiseLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const lead = await FranchiseOpportunity.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true },
    );

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({ message: "Status updated successfully", lead });
  } catch (error) {
    console.error("Update franchise lead status error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Unread = still "New" and not yet opened by an admin
const UNREAD_NEW = { status: "New", isRead: false };
const WHATSAPP_LEAD = { $or: [{ source: "whatsapp" }, { problemType: WHATSAPP_PROBLEM_TYPE }] };
const WEBSITE_LEAD = { source: { $ne: "whatsapp" }, problemType: { $ne: WHATSAPP_PROBLEM_TYPE } };

// Sidebar badge + per-tab counts for new, unread leads
const getLeadUnreadCounts = async (req, res) => {
  try {
    const [creditRepair, whatsapp, franchise] = await Promise.all([
      CreditRepair.countDocuments({ $and: [UNREAD_NEW, WEBSITE_LEAD] }),
      CreditRepair.countDocuments({ $and: [UNREAD_NEW, WHATSAPP_LEAD] }),
      FranchiseOpportunity.countDocuments(UNREAD_NEW),
    ]);

    res.json({
      creditRepair,
      whatsapp,
      franchise,
      total: creditRepair + whatsapp + franchise,
    });
  } catch (error) {
    console.error("Get lead unread counts error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const markCreditRepairRead = async (req, res) => {
  try {
    const enquiry = await CreditRepair.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );

    if (!enquiry) {
      return res.status(404).json({ message: "Enquiry not found" });
    }

    res.json({ message: "Marked as read", enquiry });
  } catch (error) {
    console.error("Mark credit repair read error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const markFranchiseLeadRead = async (req, res) => {
  try {
    const lead = await FranchiseOpportunity.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.json({ message: "Marked as read", lead });
  } catch (error) {
    console.error("Mark franchise lead read error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  submitCreditRepairForm,
  submitContactForm,
  submitFranchiseOpportunityForm,
  submitBusinessForm,
  submitSuvidhaCentreApplicationForm,
  getAllCreditRepairEnquiries,
  updateCreditRepairStatus,
  deleteCreditRepairEnquiry,
  getAllFranchiseLeads,
  updateFranchiseLeadStatus,
  getLeadUnreadCounts,
  markCreditRepairRead,
  markFranchiseLeadRead,
};
