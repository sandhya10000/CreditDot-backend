const axios = require("axios");
const CreditReport = require("../models/CreditReport");
const Setting = require("../models/Setting");
const Franchise = require("../models/Franchise");
const Joi = require("joi");
const fs = require("fs");
const path = require("path");
const { sendCreditReportEmail } = require("../utils/emailService");
const googleSheetsService = require("../utils/googleSheetsService");
const surepassClient = require("../utils/surepassApiClient");
const indiconnectClient = require("../utils/indiconnectApiClient");
const digiApiClient = require("../utils/digiApiClient");
const digiCibilPdf = require("../utils/digiCibilPdf");
const cibilPdfService = require("../utils/cibilPdfService");
const experianCirPdf = require("../utils/experianCirPdf");
// const puppeteer = require("puppeteer");

// Validation schema for credit check
const creditCheckSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    "string.min": "Customer name must be at least 2 characters long",
    "string.max": "Customer name must be less than 100 characters long",
    "any.required": "Customer name is required",
  }),
  mobile: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required()
    .messages({
      "string.pattern.base": "Mobile number must be exactly 10 digits",
      "any.required": "Mobile number is required",
    }),
  email: Joi.string().email().messages({
    "string.email": "Please provide a valid email address",
  }),
  personId: Joi.string().optional(),
  bureau: Joi.string()
    .valid(
      "equifax",
      "experian",
      "cibil",
      "crif",
      "cibil-ongrid",
      "cibil-surepass",
    )
    .default("cibil")
    .messages({
      "any.only":
        "Please select a valid credit bureau (equifax, experian, cibil, crif, )",
    }),
  cibilApiType: Joi.string()
    .valid("indiconnect", "digi", "surepass", "ongrid")
    .optional()
    .default("indiconnect")
    .messages({
      "any.only": "cibilApiType must be indiconnect, digi or surepass",
    }),
  // Fields for all bureaus
  pan: Joi.string().optional(),
  aadhaar: Joi.string().optional(),
  dob: Joi.date().optional(),
  gender: Joi.string().optional(),
  occupation: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  language: Joi.string().optional(),
  // Equifax specific fields
  id_number: Joi.string().optional(),
  id_type: Joi.string().valid("pan", "aadhaar").optional(),
  // Experian Soft-Pull requires pincode (+ dob above)
  pincode: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .optional()
    .messages({
      "string.pattern.base": "Pincode must be exactly 6 digits",
    }),
})
  // Custom validation for Equifax - requires either pan/aadhaar or id_number/id_type
  .custom((value, helpers) => {
    if (value.bureau === "equifax") {
      // Either provide traditional identification (pan or aadhaar)
      // OR provide Equifax-specific identification (id_number and id_type)
      const hasTraditionalId = value.pan || value.aadhaar;
      const hasEquifaxSpecificId = value.id_number && value.id_type;

      if (!hasTraditionalId && !hasEquifaxSpecificId) {
        return helpers.error("any.custom", {
          message:
            "For Equifax bureau, either PAN/Aadhaar must be provided or id_number and id_type must be provided",
        });
      }
    }
    return value;
  });

// Helper function to get Surepass API key value directly
const getSurepassApiKeyValue = async () => {
  try {
    const setting = await Setting.findOne({ key: "surepass_api_key" });
    return setting ? setting.value : process.env.SUREPASS_API_KEY;
  } catch (error) {
    console.error("Error fetching Surepass API key:", error);
    return null;
  }
};

// Helper: is this bureau routed to IndiConnect CIBIL? (franchise-first cutover)
const isIndiconnectCibilBureau = (bureau) =>
  ["cibil", "cibil-ongrid", "cibil-surepass"].includes(bureau);

// IndiConnect credentials: DB Setting first, env fallback (same pattern as Surepass)
const getIndiconnectValue = async (key, envKey) => {
  try {
    const setting = await Setting.findOne({ key });
    if (setting && setting.value) return setting.value;
  } catch (e) {
    console.error(`Error fetching Setting ${key}:`, e.message);
  }
  return process.env[envKey] || null;
};

const getIndiconnectConfig = async (bureau = "cibil") => {
  const pickEnv = (keys) => {
    for (const k of keys) {
      if (process.env[k]) return process.env[k];
    }
    return null;
  };
  const providerKeys =
    bureau === "crif"
      ? [
          "INDICONNECT_CRIF_PROVIDER_CODE",
          "INDICONNECT_EXPERIAN_PROVIDER_CODE",
          "INDICONNECT_CIBIL_PROVIDER_CODE",
          "INDICONNECT_PROVIDERCODE",
        ]
      : bureau === "experian"
        ? [
            "INDICONNECT_EXPERIAN_PROVIDER_CODE",
            "INDICONNECT_CRIF_PROVIDER_CODE",
            "INDICONNECT_CIBIL_PROVIDER_CODE",
            "INDICONNECT_PROVIDERCODE",
          ]
        : [
            "INDICONNECT_CIBIL_PROVIDER_CODE",
            "INDICONNECT_EXPERIAN_PROVIDER_CODE",
            "INDICONNECT_CRIF_PROVIDER_CODE",
            "INDICONNECT_PROVIDERCODE",
          ];
  const endpointKeys =
    bureau === "crif"
      ? ["INDICONNECT_CRIF_ENDPOINT", "INDICONNECT_EXPERIAN_ENDPOINT"]
      : bureau === "experian"
        ? ["INDICONNECT_EXPERIAN_ENDPOINT", "INDICONNECT_CRIF_ENDPOINT"]
        : ["INDICONNECT_CIBIL_ENDPOINT", "INDICONNECT_EXPERIAN_ENDPOINT"];
  const settingKey =
    bureau === "crif"
      ? "indiconnect_crif_provider_code"
      : bureau === "experian"
        ? "indiconnect_experian_provider_code"
        : "indiconnect_cibil_provider_code";
  return {
    baseUrl: (
      (await getIndiconnectValue(
        "indiconnect_base_url",
        "INDICONNECT_BASE_URL",
      )) || "https://api.ccs.indiconnect.in"
    ).replace(/\/$/, ""),
    serviceKey:
      (await getIndiconnectValue(
        "indiconnect_service_key",
        "INDICONNECT_SERVICE_KEY",
      )) || null,
    auth:
      (await getIndiconnectValue("indiconnect_auth", "INDICONNECT_AUTH")) ||
      (() => {
        const indc =
          process.env.INDICONNECT_SECRET_KEY ||
          process.env.INDICONNECT_INDC_KEY ||
          "";
        const ac = process.env.INDICONNECT_ACCESS_KEY || "";
        return indc && ac ? `x-api-access ${indc}:${ac}` : null;
      })(),
    providerCode:
      (await getIndiconnectValue(
        settingKey,
        settingKey.toUpperCase(),
      )) ||
      pickEnv(providerKeys) ||
      null,
    endpoint: pickEnv(endpointKeys) || "/idverifygr/verification",
  };
};

const getIndiconnectCibilConfig = async () => getIndiconnectConfig("cibil");

// Digi CIBIL credentials: DB Setting first, env fallback (same pattern as IndiConnect)
const getDigiValue = async (key, envKey) => {
  try {
    const setting = await Setting.findOne({ key });
    if (setting && setting.value) return setting.value;
  } catch (e) {
    console.error(`Error fetching Setting ${key}:`, e.message);
  }
  return process.env[envKey] || null;
};

const getDigiConfig = async () => ({
  baseUrl: (
    (await getDigiValue("digi_base_url", "DIGI_BASE_URL")) || ""
  ).replace(/\/$/, ""),
  partnerId: await getDigiValue("digi_partner_id", "DIGI_PARTNER_ID"),
  secretKey: await getDigiValue("digi_secret_key", "DIGI_SECRET_KEY"),
  endpoint:
    (await getDigiValue("digi_endpoint", "DIGI_ENDPOINT")) ||
    digiApiClient.DIGI_DEFAULT_ENDPOINT,
});

// Shared Experian Soft-Pull runner (Credit Bureau_S).
// Throws { statusCode, body } on credential/config/provider failures so
// callers stay lean. Returns { parsed, response } on usable results.
const runExperianSoftPull = async ({
  firstName,
  lastName,
  mobile,
  panNumber,
  dob,
  pincode,
  consentIp,
}) => {
  const fail = (statusCode, message, extra = {}) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.body = { message, ...extra };
    throw err;
  };
  const cfg = await getIndiconnectConfig("experian");
  if (!cfg.serviceKey || !cfg.auth || !cfg.providerCode) {
    fail(500, "IndiConnect Experian credentials not configured (service-key / auth / provider code)");
  }
  const appId = await getIndiconnectValue(
    "indiconnect_experian_app_id",
    "INDICONNECT_EXPERIAN_MY_APP_ID",
  );
  if (!appId) {
    fail(500, "IndiConnect Experian app id (myAppId) not configured");
  }
  const ep = cfg.endpoint.startsWith("/") ? cfg.endpoint : `/${cfg.endpoint}`;
  const url = `${cfg.baseUrl}${ep}`;
  const query = indiconnectClient.buildExperianSpQuery({
    firstName,
    lastName,
    mobile,
    panNumber,
    dob,
    pincode,
    consentIp,
  });
  const headers = indiconnectClient.buildExperianSpHeaders(cfg.providerCode);
  headers.myAppId = appId;
  let response;
  try {
    response = await axios.post(
      url,
      { query, variables: {} },
      { headers, timeout: 60000 },
    );
  } catch (apiError) {
    if (apiError.code === "ETIMEDOUT" || apiError.code === "ECONNABORTED") {
      fail(504, "Request timeout when connecting to Experian. Please try again later.", { error: "TIMEOUT_ERROR" });
    }
    if (apiError.isAxiosError && !apiError.response) {
      fail(502, "Network error when connecting to Experian.", { error: "NETWORK_ERROR" });
    }
    if (apiError.response?.status === 429) {
      fail(429, "Too many requests to Experian. Please try again later.", { error: "RATE_LIMIT_EXCEEDED" });
    }
    const ed = apiError?.response?.data;
    if (ed?.message_code === "balance_exhausted" || ed?.message === "API Balance Exhausted. Please recharge.") {
      fail(503, "Service is temporarily unavailable. Please try again later.");
    }
    if (apiError.response) {
      fail(apiError.response.status, apiError.response.data?.message || "Experian check failed", { error: apiError.response.data });
    }
    fail(500, apiError.message || "Experian check failed");
  }
  const parsed = indiconnectClient.parseExperianSpResponse(response.data);
  const failReason = indiconnectClient.indiconnectFailed(parsed);
  if (failReason) {
    fail(502, failReason, { error: parsed.error || null, txnId: parsed.txn_id || null });
  }
  console.log(
    `IndiConnect Experian-SP: score=${parsed.score ?? "null"} conf=${parsed.scoreConfidence ?? "-"} match=${parsed.exactMatch ?? "-"} report=${parsed.creditProfileHeader?.ReportNumber ?? "-"} txn=${parsed.txn_id}`,
  );
  return { parsed, response };
};

// Get Surepass API key (admin only)
const getSurepassApiKey = async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: "surepass_api_key" });

    if (!setting) {
      return res
        .status(404)
        .json({ message: "Surepass API key not configured" });
    }

    // Return only a masked version of the API key for security
    const maskedKey =
      setting.value.substring(0, 4) +
      "..." +
      setting.value.substring(setting.value.length - 4);

    res.json({
      message: "Surepass API key retrieved successfully",
      apiKey: maskedKey,
      hasApiKey: true,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Map bureau names to Surepass API endpoints and request data format
const getBureauConfig = (bureau) => {
  const configs = {
    cibil: {
      endpoint:
        "https://kyc-api.surepass.io/api/v1/credit-report-cibil/fetch-report-pdf",
      formatData: (data) => ({
        mobile: data.mobile,
        pan: data.pan,
        name: data.name,
        gender: data.gender ? data.gender.toLowerCase() : "male",
        consent: "Y",
      }),
    },
    crif: {
      endpoint:
        "https://kyc-api.surepass.app/api/v1/credit-report-crif/fetch-report-pdf",
      formatData: (data) => {
        // Split name into first and last name
        const nameParts = data.name.split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || " ";

        return {
          first_name: firstName,
          last_name: lastName,
          mobile: data.mobile,
          pan: data.pan,
          consent: "Y",
          raw: false,
        };
      },
    },
    experian: {
      endpoint:
        "https://kyc-api.surepass.io/api/v1/credit-report-experian/fetch-report-pdf",
      formatData: (data) => ({
        name: data.name,
        consent: "Y",
        mobile: data.mobile,
        pan: data.pan,
      }),
    },
    equifax: {
      endpoint:
        "https://kyc-api.surepass.io/api/v1/credit-report-v2/fetch-pdf-report",
      formatData: (data) => {
        // If id_number and id_type are provided directly (from frontend), use them
        // Otherwise, fall back to the traditional method of using pan or aadhaar
        if (data.id_number && data.id_type) {
          return {
            name: data.name,
            id_number: data.id_number,
            id_type: data.id_type,
            mobile: data.mobile,
            consent: "Y",
          };
        } else {
          // Fallback to traditional method
          return {
            name: data.name,
            id_number: data.pan || data.aadhaar,
            id_type: data.pan ? "pan" : "aadhaar",
            mobile: data.mobile,
            consent: "Y",
          };
        }
      },
    },
  };
  return configs[bureau] || configs.cibil;
};

// Check credit score for specific bureau
const checkCreditScore = async (req, res) => {
  try {
    let franchise = null;
    // Validate request body
    const { error } = creditCheckSchema.validate(req.body, {
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
      name,
      mobile,
      personId,
      bureau = "cibil",
      pan,
      aadhaar,
      dob,
      gender,
    } = req.body;

    if (req.user.role !== "admin") {
      // Check same mobile/pan credit report in last 15 days
      // Apply 15 days restriction ONLY for CIBIL

      const lastReport = await CreditReport.findOne({
        mobile,
        pan,
        bureau,
      }).sort({ createdAt: -1 });

      if (lastReport) {
        const lastDate = new Date(lastReport.createdAt);
        const currentDate = new Date();

        const diffTime = currentDate - lastDate;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);

        if (diffDays < 15) {
          const remainingDays = Math.ceil(15 - diffDays);

          return res.status(400).json({
            message: `This report has already been downloaded. Try again after ${remainingDays} days.`,
          });
        }
      }

      // Get franchise details to check credits
      franchise = await Franchise.findById(req.user.franchiseId);
      if (!franchise) {
        return res.status(404).json({ message: "Franchise not found" });
      }

      //Check if franchise has enough credits
      if (franchise.credits < 1) {
        return res.status(400).json({
          message: "Insufficient credits to generate credit report",
        });
      }
    }

    // Get Surepass API key

    let response;

    try {
      if (isIndiconnectCibilBureau(bureau)) {
        // ---- CIBIL via IndiConnect (franchise-first cutover, htmlUrl accepted) ----
        const cfg = await getIndiconnectCibilConfig();
        if (!cfg.serviceKey || !cfg.auth || !cfg.providerCode) {
          return res.status(500).json({
            message:
              "IndiConnect CIBIL credentials not configured (service-key / auth / provider code)",
          });
        }
        const ep = cfg.endpoint.startsWith("/")
          ? cfg.endpoint
          : `/${cfg.endpoint}`;
        const url = `${cfg.baseUrl}${ep}`;
        const payload = indiconnectClient.buildCibilPayload({
          pan,
          name,
          mobile,
        });
        response = await axios.post(url, payload, {
          headers: {
            "Content-Type": "application/json",
            "service-key": cfg.serviceKey,
            Authorization: cfg.auth,
            providercode: cfg.providerCode,
          },
          timeout: 60000,
        });
        // stash parsed view for the extractor below without changing response shape
        response.__indiconnect = indiconnectClient.parseCibilResponse(
          response.data,
        );
        response.__indiconnectBureau = "cibil";
        {
          const failReason =
            indiconnectClient.indiconnectFailed(response.__indiconnect);
          if (failReason) {
            return res.status(502).json({
              message: failReason,
              error: response.__indiconnect.error || null,
              txnId: response.__indiconnect.txn_id || null,
            });
          }
        }
      } else if (bureau === "crif") {
        // ---- CRIF via IndiConnect (full replace of Surepass) ----
        const cfg = await getIndiconnectConfig(bureau);
        if (!cfg.serviceKey || !cfg.auth || !cfg.providerCode) {
          return res.status(500).json({
            message: `IndiConnect ${bureau.toUpperCase()} credentials not configured (service-key / auth / provider code)`,
          });
        }
        const ep = cfg.endpoint.startsWith("/")
          ? cfg.endpoint
          : `/${cfg.endpoint}`;
        const url = `${cfg.baseUrl}${ep}`;
        const payload = indiconnectClient.buildCrifPayload({
          pan,
          name,
          mobile,
        });
        response = await axios.post(url, payload, {
          headers: {
            "Content-Type": "application/json",
            "service-key": cfg.serviceKey,
            Authorization: cfg.auth,
            providercode: cfg.providerCode,
          },
          timeout: 60000,
        });
        const parse = indiconnectClient.parseCrifResponse;
        response.__indiconnect = parse(response.data);
        response.__indiconnectBureau = bureau;
        {
          const failReason =
            indiconnectClient.indiconnectFailed(response.__indiconnect);
          if (failReason) {
            return res.status(502).json({
              message: failReason,
              error: response.__indiconnect.error || null,
              txnId: response.__indiconnect.txn_id || null,
            });
          }
        }
        console.log(
          `IndiConnect ${bureau.toUpperCase()}: score=${response.__indiconnect.score ?? "null"} pdf=${response.__indiconnect.reportUrl ? "yes" : "no"} bureau=${response.__indiconnect.bureauStatus}/${response.__indiconnect.bureauMessage} txn=${response.__indiconnect.txn_id}`,
        );
      } else if (bureau === "experian") {
        // ---- Experian Soft-Pull via IndiConnect ----
        const { pincode } = req.body;
        const missing = [];
        if (!pincode) missing.push("pincode");
        if (!dob) missing.push("dob");
        if (missing.length) {
          return res.status(400).json({
            message: "Missing required fields for Experian",
            missingFields: missing,
          });
        }
        const split = indiconnectClient.splitFullName(name);
        if (!split) {
          return res.status(400).json({
            message: "Full name must contain first and last name for Experian",
          });
        }
        try {
          const out = await runExperianSoftPull({
            firstName: split.firstName,
            lastName: split.lastName,
            mobile,
            panNumber: pan,
            dob:
              dob instanceof Date
                ? dob.toISOString().slice(0, 10)
                : String(dob).slice(0, 10),
            pincode,
            consentIp: req.ip,
          });
          response = out.response;
          response.__indiconnect = out.parsed;
          response.__indiconnectBureau = "experian";
        } catch (spErr) {
          return res
            .status(spErr.statusCode || 500)
            .json(spErr.body || { message: spErr.message });
        }
      } else {
        const surepassApiKey = await getSurepassApiKeyValue();
        if (!surepassApiKey) {
          return res
            .status(500)
            .json({ message: "Surepass API key not configured" });
        }

        const bureauConfig = getBureauConfig(
          bureau !== "cibil-surepass" ? bureau : "cibil",
        );

        const requestData = bureauConfig.formatData({
          name,
          mobile,
          personId,
          pan,
          aadhaar,
          dob,
          gender,
          // Pass through Equifax-specific fields if provided
          id_number: req.body.id_number || null,
          id_type: req.body.id_type || null,
        });

        const start = Date.now();
        response = await surepassClient.makeCreditCheckRequest(
          surepassApiKey,
          bureauConfig.endpoint,
          requestData,
        );
        console.log(`Credit bureau response took ${Date.now() - start} ms`);
      }
    } catch (apiError) {
      console.error("API ERROR:", apiError);
      const errorData = apiError?.response?.data;

      // Hide Surepass Balance Exhausted message
      if (
        errorData?.message_code === "balance_exhausted" ||
        errorData?.message === "API Balance Exhausted. Please recharge."
      ) {
        return res.status(503).json({
          success: false,
          message:
            "Service is temporarily unavailable. Please try again later.",
        });
      }
      if (apiError.code === "ETIMEDOUT" || apiError.code === "ECONNABORTED") {
        return res.status(504).json({
          message:
            "Request timeout when connecting to credit bureau. Please try again later.",
          error: "TIMEOUT_ERROR",
        });
      }

      // Handle network errors
      if (apiError.isAxiosError && !apiError.response) {
        return res.status(502).json({
          message:
            "Network error when connecting to credit bureau. Please check your internet connection and try again.",
          error: "NETWORK_ERROR",
        });
      }

      // Handle rate limiting specifically (HTTP 429)
      if (apiError.response?.status === 429) {
        console.error(
          "Surepass API rate limit exceeded:",
          apiError.response.data,
        );
        return res.status(429).json({
          message:
            "Too many requests to credit bureau. Please try again later.",
          error: "RATE_LIMIT_EXCEEDED",
        });
      }

      // Forward the error from Surepass API if available
      if (apiError.response) {
        return res.status(apiError.response.status).json({
          message: apiError.response.data.message || "Credit check failed",
          error: apiError.response.data || apiError.message,
        });
      }

      return res.status(500).json({
        message: "Credit bureau API failed",
        error: apiError.message,
      });
    }

    let score = null;
    let reportUrl = null;

    const indiconnectBureau = response.__indiconnectBureau || null;

    if (isIndiconnectCibilBureau(bureau)) {
      const parsed =
        response.__indiconnect ||
        indiconnectClient.parseCibilResponse(response.data);
      score = parsed.score;
      // Prefer the direct S3 PDF link; fall back to the CIBIL web page link
      reportUrl = parsed.pdfUrl || parsed.htmlUrl;
      response.__indiconnect = parsed;
      console.log(
        `IndiConnect CIBIL: score=${score ?? "null"} pdf=${parsed.pdfUrl ? "yes" : "no"} html=${parsed.htmlUrl ? "yes" : "no"} bureau=${parsed.bureauStatus}/${parsed.bureauMessage} txn=${parsed.txn_id}`,
      );
    } else if (indiconnectBureau === "crif" || indiconnectBureau === "experian") {
      const parsed = response.__indiconnect;
      score = parsed.score;
      reportUrl = parsed.reportUrl;
    } else {
      score =
        response?.data?.data?.score ||
        response?.data?.data?.credit_score ||
        null;
      reportUrl =
        response?.data?.data?.report_url ||
        response?.data?.data?.pdf_url ||
        response?.data?.data?.credit_report_link ||
        response.data.data.report_link ||
        null;
    }

    const isIndiconnectCibil = isIndiconnectCibilBureau(bureau);
    // Any bureau served via IndiConnect in this request (cibil/crif/experian)
    const isIndiconnectBureau = Boolean(indiconnectBureau);
    const reportTableData = {
      userId: req.user.id,
      franchiseId: req.user.role === "admin" ? null : req.user.franchiseId,
      name,
      mobile,
      pan,
      aadhaar,
      dob,
      gender,
      score,

      bureau: ["cibil-ongrid", "cibil-surepass"].includes(bureau)
        ? "cibil"
        : bureau,
      reportData: response.data,
      reportUrl,
      // IndiConnect rows with a report URL: direct PDF links download inline;
      // htmlUrl-only rows are rendered to PDF in background after responding
      ...(isIndiconnectBureau && reportUrl
        ? { pdfStatus: "pending" }
        : {}),
    };

    const creditReport = new CreditReport(reportTableData);

    await creditReport.save();

    // Sync with Google Sheets
    googleSheetsService
      .initialize()
      .then(() => googleSheetsService.syncCreditScoreData())
      .catch((syncError) => {
        console.error(
          "Failed to sync credit score data with Google Sheets:",
          syncError,
        );
      });

    // Deduct credit from franchise
    if (req.user.role !== "admin" && franchise) {
      franchise.credits -= 1;
      await franchise.save();
    }

    // Experian Soft-Pull: render our styled PDF from the bureau JSON
    // (the bureau returns Excel data, not a PDF link).
    if (
      indiconnectBureau === "experian" &&
      response.__indiconnect &&
      !creditReport.localPath
    ) {
      try {
        const gen = await experianCirPdf.generateExperianPdf(
          response.__indiconnect,
          { name, mobile, pan },
        );
        if (gen) {
          const reportsDir = path.join(__dirname, "../reports");
          if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
          }
          const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;
          fs.writeFileSync(path.join(reportsDir, filename), gen.buffer);
          creditReport.localPath = `/reports/${filename}`;
          creditReport.pdfStatus = "ready";
          await creditReport.save();
          console.log(
            `Experian styled PDF generated: ${filename} (score ${gen.model.score})`,
          );
        }
      } catch (genErr) {
        console.error("EXPERIAN PDF GENERATE FAILED:", genErr.message);
      }
    }

    // If we have a report URL, download and save the PDF locally.
    // Direct PDF links (Surepass + IndiConnect) download inline;
    // IndiConnect htmlUrl-only rows use the background renderer below.
    if (
      reportUrl &&
      !creditReport.localPath &&
      (!isIndiconnectBureau || !indiconnectClient.isHtmlReportUrl(reportUrl))
    ) {
      try {
        const reportsDir = path.join(__dirname, "../reports");

        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;
        const localFilePath = path.join(reportsDir, filename);

        const pdfResponse = await axios({
          method: "GET",
          url: reportUrl,
          responseType: "stream",
          timeout: 180000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const writer = fs.createWriteStream(localFilePath);

        pdfResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        creditReport.localPath = `/reports/${filename}`;
        if (isIndiconnectBureau) creditReport.pdfStatus = "ready";
        await creditReport.save();
      } catch (downloadError) {
        console.error("PDF DOWNLOAD ERROR:", downloadError.message);
      }
    }

    const noCibilRecord =
      isIndiconnectCibil &&
      (response.__indiconnect?.bureauStatus === 2 ||
        /no\s*record\s*found/i.test(
          response.__indiconnect?.bureauMessage || "",
        ));

    res.status(200).json({
      message: noCibilRecord
        ? "No CIBIL record found for these details"
        : `Credit report retrieved successfully from ${bureau.toUpperCase()}`,
      provider: isIndiconnectBureau ? "indiconnect" : "surepass",
      creditReport: {
        id: creditReport._id,
        name: creditReport.name,
        mobile: creditReport.mobile,
        pan: creditReport.pan,
        aadhaar: creditReport.aadhaar,
        score: creditReport.score,
        bureau: creditReport.bureau,
        reportUrl: creditReport.reportUrl,
        localPath: creditReport.localPath,
        pdfStatus: creditReport.pdfStatus || null,
        txnId: response.__indiconnect?.txn_id || null,
        createdAt: creditReport.createdAt,
      },
      remainingCredits:
        req.user.role !== "admin" && franchise ? franchise.credits : null,
    });

    // Background: render IndiConnect CIBIL htmlUrl-only rows to local PDF
    // (non-blocking, link-only fallback on failure). Runs after responding.
    // Rows with a direct PDF link were already downloaded inline above.
    if (
      isIndiconnectCibil &&
      reportUrl &&
      indiconnectClient.isHtmlReportUrl(reportUrl)
    ) {
      cibilPdfService.renderCibilPdfInBackground(
        CreditReport,
        creditReport._id,
        reportUrl,
      );
    }

    console.log(response.data, "ongrid-----");
  } catch (error) {
    console.error("Credit check error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
      // Don't expose sensitive error details in production
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  }
};

// Check credit score for specific bureau (public version for Experian only)
const checkCreditScorePublic = async (req, res) => {
  try {
    console.log("=== Starting checkCreditScorePublic ===");
    console.log("Request body received:", JSON.stringify(req.body, null, 2));

    // Validate request body
    const { error } = creditCheckSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      console.log("Validation failed:", error.details);
      const errorMessages = error.details.map((detail) => detail.message);
      return res.status(400).json({
        message: "Validation error",
        details: errorMessages,
      });
    }

    const {
      name,
      mobile,
      email, // Add email
      personId,
      bureau = "experian",
      pan,
      aadhaar,
      dob,
      gender,
      occupation,
      city,
      state,
      language,
    } = req.body;

    console.log("Parsed form data:", { name, mobile, email, bureau, pan });

    // Only allow Experian for public access
    if (bureau !== "experian") {
      console.log(
        "Bureau validation failed - only Experian allowed for public access",
      );
      return res.status(400).json({
        message: "Only Experian credit reports are available for public access",
      });
    }

    // Experian Soft-Pull requires pincode + dob on top of the base fields
    const { pincode: pubPincode } = req.body;
    {
      const missing = [];
      if (!pubPincode) missing.push("pincode");
      if (!dob) missing.push("dob");
      if (missing.length) {
        return res.status(400).json({
          message: "Missing required fields for Experian",
          missingFields: missing,
        });
      }
    }
    const pubSplit = indiconnectClient.splitFullName(name);
    if (!pubSplit) {
      return res.status(400).json({
        message: "Full name must contain first and last name for Experian",
      });
    }

    // Make request to IndiConnect Soft-Pull API
    let response;
    try {
      const out = await runExperianSoftPull({
        firstName: pubSplit.firstName,
        lastName: pubSplit.lastName,
        mobile,
        panNumber: pan,
        dob:
          dob instanceof Date
            ? dob.toISOString().slice(0, 10)
            : String(dob).slice(0, 10),
        pincode: pubPincode,
        consentIp: req.ip,
      });
      response = out.response;
      response.__indiconnect = out.parsed;
      response.__indiconnectBureau = "experian";

      console.log("IndiConnect API response received:", {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        score: response.__indiconnect.score,
        txn: response.__indiconnect.txn_id,
      });
    } catch (apiError) {
      // Structured errors from the Soft-Pull runner (config/validation/
      // provider failures) already carry HTTP semantics
      if (apiError.statusCode && apiError.body) {
        return res.status(apiError.statusCode).json(apiError.body);
      }
      console.error("IndiConnect API error occurred:");
      console.error("- Message:", apiError.message);
      console.error("- Code:", apiError.code);
      console.error("- Is Axios Error:", apiError.isAxiosError);
      console.error("- Response Status:", apiError.response?.status);
      console.error(
        "- Response Data:",
        JSON.stringify(apiError.response?.data, null, 2),
      );
      const errorData = apiError?.response?.data;

      // Hide Surepass Balance Exhausted message
      if (
        errorData?.message_code === "balance_exhausted" ||
        errorData?.message === "API Balance Exhausted. Please recharge."
      ) {
        return res.status(503).json({
          success: false,
          message:
            "Service is temporarily unavailable. Please try again later.",
        });
      }

      // Handle timeout specifically
      if (apiError.code === "ETIMEDOUT" || apiError.code === "ECONNABORTED") {
        return res.status(504).json({
          message:
            "Request timeout when connecting to credit bureau. Please try again later.",
          error: "TIMEOUT_ERROR",
        });
      }

      // Handle network errors
      if (apiError.isAxiosError && !apiError.response) {
        return res.status(502).json({
          message:
            "Network error when connecting to credit bureau. Please check your internet connection and try again.",
          error: "NETWORK_ERROR",
        });
      }

      // Handle rate limiting specifically (HTTP 429)
      if (apiError.response?.status === 429) {
        console.error(
          "IndiConnect API rate limit exceeded:",
          apiError.response.data,
        );
        return res.status(429).json({
          message:
            "Too many requests to credit bureau. Please try again later.",
          error: "RATE_LIMIT_EXCEEDED",
        });
      }

      // Forward the error from IndiConnect API if available
      if (apiError.response) {
        return res.status(apiError.response.status).json({
          message: "Credit check failed",
          error: apiError.response.data || apiError.message,
        });
      }

      // Generic error
      return res.status(500).json({
        message: "An error occurred while checking credit score",
        error: apiError.message,
      });
    }

    // Extract score + report URL from the IndiConnect Experian result
    const parsedPublic = response.__indiconnect;
    let score = parsedPublic ? parsedPublic.score : null;
    console.log("Score extracted from IndiConnect result:", score);

    // Extract report URL from response
    let reportUrl = parsedPublic ? parsedPublic.reportUrl : null;
    console.log("Report URL extracted:", reportUrl);

    // Save credit report without user/franchise association for public reports
    console.log("Creating credit report record in database...");
    const creditReport = new CreditReport({
      name,
      mobile,
      email, // Add email
      pan,
      aadhaar,
      dob,
      gender,
      score,
      bureau,
      reportData: response.data,
      reportUrl: reportUrl,
      isPublic: true, // Mark as public report
      occupation,
      city,
      state,
      language,
    });

    await creditReport.save();
    console.log("Credit report saved to database with ID:", creditReport._id);

    // Experian Soft-Pull: render our styled PDF from the bureau JSON
    // (the bureau returns Excel data, not a PDF link).
    if (response.__indiconnect && !creditReport.localPath) {
      try {
        const gen = await experianCirPdf.generateExperianPdf(
          response.__indiconnect,
          { name, mobile, pan },
        );
        if (gen) {
          const reportsDir = path.join(__dirname, "../reports");
          if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
          }
          const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;
          fs.writeFileSync(path.join(reportsDir, filename), gen.buffer);
          creditReport.localPath = `/reports/${filename}`;
          await creditReport.save();
          console.log(
            `Experian public styled PDF generated: ${filename} (score ${gen.model.score})`,
          );
        }
      } catch (genErr) {
        console.error("EXPERIAN PDF GENERATE FAILED:", genErr.message);
      }
    }

    // Sync with Google Sheets for public reports
    try {
      console.log("Attempting to sync with Google Sheets...");
      await googleSheetsService.initialize();
      await googleSheetsService.syncPublicCreditScoreData();
      console.log("Google Sheets sync completed");
    } catch (syncError) {
      console.error(
        "Failed to sync public credit score data with Google Sheets:",
        syncError,
      );
    }

    // If we have a report URL, download and save the PDF locally (for public reports too)
    if (reportUrl) {
      console.log("Downloading PDF report from URL:", reportUrl);
      try {
        // Create reports directory if it doesn't exist
        const reportsDir = path.join(__dirname, "../reports");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        // Generate a unique filename
        const timestamp = Date.now();
        const filename = `credit_report_${creditReport._id}_${timestamp}.pdf`;
        const localPath = path.join(reportsDir, filename);

        // Download the PDF with timeout
        const pdfResponse = await axios({
          method: "GET",
          url: reportUrl,
          responseType: "stream",
          timeout: 30000, // 30 second timeout
        });

        // Save the PDF to local storage
        const writer = fs.createWriteStream(localPath);
        pdfResponse.data.pipe(writer);

        // Wait for the download to complete
        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        // Update the credit report with the local path
        creditReport.localPath = `/reports/${filename}`;
        await creditReport.save();
        console.log("PDF downloaded and saved locally:", localPath);
      } catch (downloadError) {
        console.error("Error downloading PDF:", downloadError);
        // We don't fail the entire request if PDF download fails
      }
    } else {
      console.log("No report URL found, skipping PDF download");
    }

    console.log("Attempting to send emails to user and admin...");
    // Send email to user and admin
    try {
      // Send email to user
      console.log("Sending email to user:", { email, name });
      await sendCreditReportEmail(
        { email: email, name: name }, // Use the email from request
        creditReport,
      );
      console.log("User email sent successfully");

      // Send email to admin
      const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
      console.log("Sending email to admin:", adminEmail);
      await sendCreditReportEmail(
        { email: adminEmail, name: "Admin" },
        creditReport,
      );
      console.log("Admin email sent successfully");
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      console.error("Email error stack:", emailError.stack);
      // Don't fail the request if email sending fails
    }

    console.log("=== Completed checkCreditScorePublic successfully ===");

    res.json({
      message: `Credit report retrieved successfully from ${bureau.toUpperCase()}`,
      provider: "indiconnect",
      creditReport: {
        id: creditReport._id,
        name: creditReport.name,
        mobile: creditReport.mobile,
        pan: creditReport.pan,
        aadhaar: creditReport.aadhaar,
        score: creditReport.score,
        bureau: creditReport.bureau,
        reportUrl: creditReport.reportUrl,
        localPath: creditReport.localPath,
        txnId: response.__indiconnect?.txn_id || null,
        createdAt: creditReport.createdAt,
      },
    });
  } catch (error) {
    console.error("Credit check error:", error);
    console.error("Full error stack:", error.stack);
    res.status(500).json({
      message: "Server error",
      error: error.message,
      // Don't expose sensitive error details in production
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  }
};

// Get credit reports for franchise
const getCreditReports = async (req, res) => {
  try {
    let reports;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    if (req.user.role === "admin") {
      reports = await CreditReport.find()
        .populate("franchiseId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await CreditReport.countDocuments();
      res.status(200).json({
        total,
        page,
        totalPages: Math.ceil(total / limit),
        reports,
      });
    } else {
      const filter = {
        franchiseId: req.user.franchiseId,
      };
      reports = await CreditReport.find(filter)
        .populate("franchiseId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await CreditReport.countDocuments(filter);
      res.status(200).json({
        total,
        page,
        totalPages: Math.ceil(total / limit),
        reports,
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all credit reports (admin only)
const getAllCreditReports = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search?.trim() || "";
    const bureau = req.query.bureau?.trim() || "";
    const skip = (page - 1) * limit;
    const filter = {};
    if (search) {
      const matchingFranchises = await Franchise.find({
        businessName: { $regex: search, $options: "i" },
      }).select("_id");
      const franchiseIds = matchingFranchises.map((f) => f._id);

      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { franchiseName: { $regex: search, $options: "i" } },
        { pan: { $regex: search, $options: "i" } },
      ];

      if (franchiseIds.length > 0) {
        filter.$or.push({ franchiseId: { $in: franchiseIds } });
      }
    }
    if (bureau) {
      filter.bureau = { $regex: new RegExp(`^${bureau}$`, 'i') };
    }
    const reports = await CreditReport.find(filter)
      .select(
        "name mobile score bureau reportUrl localPath franchiseName city state createdAt userId franchiseId pan",
      )
      .populate({
        path: "userId",
        select: "name email",
      })
      .populate({
        path: "franchiseId",
        select: "businessName",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await CreditReport.countDocuments(filter);

    return res.status(200).json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      reports,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
//get particular franchise record
// Get all reports of a particular franchise
const getFranchiseReports = async (req, res) => {
  try {
    const { franchiseId } = req.params;

    const reports = await CreditReport.find({
      franchiseId,
    })
      .select(
        "name mobile score bureau reportUrl localPath city state pan createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      franchiseId,
      totalReports: reports.length,
      reports,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Get credit report by ID
const getCreditReportById = async (req, res) => {
  try {
    const report = await CreditReport.findById(req.params.id)
      .populate("userId", "name email")
      .populate("franchiseId", "businessName");

    if (!report) {
      return res.status(404).json({ message: "Credit report not found" });
    }

    // Check permissions
    if (
      req.user.role === "franchise_user" &&
      report.franchiseId.toString() !== req.user.franchiseId.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(report);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update Surepass API key (admin only)
const updateSurepassApiKey = async (req, res) => {
  try {
    const { apiKey } = req.body;

    let setting = await Setting.findOne({ key: "surepass_api_key" });

    if (setting) {
      setting.value = apiKey;
      await setting.save();
    } else {
      setting = new Setting({
        key: "surepass_api_key",
        value: apiKey,
        description: "Surepass API Key for credit checks",
      });
      await setting.save();
    }

    res.json({
      message: "Surepass API key updated successfully",
      setting,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get IndiConnect keys (admin only, masked)
const getIndiconnectKeys = async (req, res) => {
  try {
    const keys = [
      "indiconnect_base_url",
      "indiconnect_service_key",
      "indiconnect_auth",
      "indiconnect_cibil_provider_code",
      "indiconnect_crif_provider_code",
      "indiconnect_experian_provider_code",
    ];
    const out = {};
    for (const k of keys) {
      const s = await Setting.findOne({ key: k });
      const v = s ? String(s.value) : process.env[k.toUpperCase()] || null;
      out[k] = v
        ? { hasValue: true, masked: `${v.slice(0, 4)}...${v.slice(-4)}` }
        : { hasValue: false, masked: null };
    }
    // also report env-effective provider code fallback chain
    out.effective_cibil_provider_code = await (async () =>
      (await getIndiconnectCibilConfig()).providerCode)();
    out.effective_crif_provider_code = await (async () =>
      (await getIndiconnectConfig("crif")).providerCode)();
    out.effective_experian_provider_code = await (async () =>
      (await getIndiconnectConfig("experian")).providerCode)();
    res.json({ message: "IndiConnect keys retrieved", keys: out });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update IndiConnect keys (admin only)
// body: { base_url?, service_key?, auth?, cibil_provider_code?, crif_provider_code?, experian_provider_code? }
const updateIndiconnectKeys = async (req, res) => {
  try {
    const map = {
      base_url: "indiconnect_base_url",
      service_key: "indiconnect_service_key",
      auth: "indiconnect_auth",
      cibil_provider_code: "indiconnect_cibil_provider_code",
      crif_provider_code: "indiconnect_crif_provider_code",
      experian_provider_code: "indiconnect_experian_provider_code",
    };
    const updated = [];
    for (const [bodyKey, settingKey] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined && req.body[bodyKey] !== "") {
        let s = await Setting.findOne({ key: settingKey });
        if (s) {
          s.value = req.body[bodyKey];
          await s.save();
        } else {
          s = new Setting({
            key: settingKey,
            value: req.body[bodyKey],
            description: `IndiConnect ${bodyKey}`,
          });
          await s.save();
        }
        updated.push(settingKey);
      }
    }
    res.json({ message: "IndiConnect keys updated", updated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get Digi CIBIL keys (admin only, masked)
const getDigiKeys = async (req, res) => {
  try {
    const keys = [
      "digi_base_url",
      "digi_partner_id",
      "digi_secret_key",
      "digi_endpoint",
    ];
    const out = {};
    for (const k of keys) {
      const s = await Setting.findOne({ key: k });
      const v = s ? String(s.value) : process.env[k.toUpperCase()] || null;
      out[k] = v
        ? { hasValue: true, masked: `${v.slice(0, 4)}...${v.slice(-4)}` }
        : { hasValue: false, masked: null };
    }
    res.json({ message: "Digi keys retrieved", keys: out });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update Digi CIBIL keys (admin only)
// body: { base_url?, partner_id?, secret_key?, endpoint? }
const updateDigiKeys = async (req, res) => {
  try {
    const map = {
      base_url: "digi_base_url",
      partner_id: "digi_partner_id",
      secret_key: "digi_secret_key",
      endpoint: "digi_endpoint",
    };
    const updated = [];
    for (const [bodyKey, settingKey] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined && req.body[bodyKey] !== "") {
        let s = await Setting.findOne({ key: settingKey });
        if (s) {
          s.value = req.body[bodyKey];
          await s.save();
        } else {
          s = new Setting({
            key: settingKey,
            value: req.body[bodyKey],
            description: `Digi ${bodyKey}`,
          });
          await s.save();
        }
        updated.push(settingKey);
      }
    }
    res.json({ message: "Digi keys updated", updated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//Get report for a particular user with customer Id

const getSingleCreditReports = async (req, res) => {
  try {
    const { pan } = req.params;

    const report = await CreditReport.findOne({ pan })
      .populate("userId", "name email")
      .populate("franchiseId", "businessName");

    // Not found
    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Credit report not found",
      });
    }

    // Custom response
    const formattedReport = {
      _id: report._id,

      panCard: report.pan,

      bureau: report.bureau,

      creditScore: report.score,

      date: report.createdAt,

      reportUrl: report.reportUrl,
    };

    res.status(200).json({
      success: true,
      data: formattedReport,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

//Post api logic for cibil (indiconnect/digi/surepass), crif, experian, equifax
const checkCreditScoreV2 = async (req, res) => {
  try {
    // VALIDATION
    const { error } = creditCheckSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details.map((d) => d.message),
      });
    }

    // REQUEST BODY
    let {
      name,
      mobile,
      bureau = "cibil",
      cibilApiType = "indiconnect",
      pan,
    } = req.body;

    // Legacy cached frontends may still send "ongrid" — route to IndiConnect
    if (cibilApiType === "ongrid") cibilApiType = "indiconnect";

    let response;

    // API KEYS
    const surepassApiKey = await getSurepassApiKeyValue();

    // =========================
    // CIBIL -> INDICONNECT (same cutover as franchise /credit/check)
    // =========================
    if (bureau === "cibil" && cibilApiType === "indiconnect") {
      const cfg = await getIndiconnectCibilConfig();
      if (!cfg.serviceKey || !cfg.auth || !cfg.providerCode) {
        return res.status(500).json({
          message:
            "IndiConnect CIBIL credentials not configured (service-key / auth / provider code)",
        });
      }
      const ep = cfg.endpoint.startsWith("/")
        ? cfg.endpoint
        : `/${cfg.endpoint}`;
      const url = `${cfg.baseUrl}${ep}`;
      const payload = indiconnectClient.buildCibilPayload({
        pan,
        name,
        mobile,
      });
      response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          "service-key": cfg.serviceKey,
          Authorization: cfg.auth,
          providercode: cfg.providerCode,
        },
        timeout: 60000,
      });
      response.__indiconnect = indiconnectClient.parseCibilResponse(
        response.data,
      );
      response.__indiconnectBureau = "cibil";
      {
        const failReason =
          indiconnectClient.indiconnectFailed(response.__indiconnect);
        if (failReason) {
          return res.status(502).json({
            success: false,
            message: failReason,
            provider: "indiconnect",
            apiType: "indiconnect",
            error: response.__indiconnect.error || null,
            txnId: response.__indiconnect.txn_id || null,
          });
        }
      }
      console.log(
        `IndiConnect V2 CIBIL: score=${response.__indiconnect.score ?? "null"} pdf=${response.__indiconnect.pdfUrl ? "yes" : "no"} html=${response.__indiconnect.htmlUrl ? "yes" : "no"} bureau=${response.__indiconnect.bureauStatus}/${response.__indiconnect.bureauMessage} txn=${response.__indiconnect.txn_id}`,
      );
    }

    // =========================
    // CIBIL -> DIGI (VerifyHub-compatible v7 contract)
    // =========================
    else if (bureau === "cibil" && cibilApiType === "digi") {
      const digiCfg = await getDigiConfig();
      if (!digiCfg.baseUrl || !digiCfg.partnerId || !digiCfg.secretKey) {
        return res.status(500).json({
          message:
            "Digi CIBIL credentials not configured (base url / partner id / secret key)",
        });
      }
      const saveDigiFailedRow = async (reportData) => {
        const failedReport = new CreditReport({
          userId: req.user?.id,
          franchiseId: req.user?.franchiseId,
          name,
          mobile,
          pan,
          score: null,
          bureau: "cibil",
          reportData,
          reportUrl: null,
          pdfStatus: "failed",
        });
        await failedReport.save();
        return failedReport;
      };
      let digiRes;
      try {
        console.log(
          `DIGI REQ url=${String(digiCfg.baseUrl).replace(/\/$/, "")}${digiCfg.endpoint.startsWith("/") ? digiCfg.endpoint : `/${digiCfg.endpoint}`} partnerId=${String(digiCfg.partnerId).trim()} pan=${String(pan || "").toUpperCase()}`,
        );
        digiRes = await digiApiClient.makeCibilRequest(
          { pan, name, mobile },
          digiCfg,
        );
      } catch (digiErr) {
        const st = digiErr.response?.status;
        // Raw provider error, server-side only (never forwarded to client).
        // Critical for diagnosing auth failures (wrong host, IP block, bad
        // partnerId, expired/skewed token, etc.).
        console.error("DIGI ERROR status:", st ?? digiErr.code ?? "none");
        try {
          console.error(
            "DIGI ERROR data:",
            JSON.stringify(digiErr.response?.data ?? null).slice(0, 2000),
          );
        } catch (logErr) {
          console.error("DIGI ERROR data: <unserializable>");
        }
        const dmsg =
          digiErr.response?.data?.message || digiErr.message || "Digi check failed";
        // Auth failures are free — no Failed row (VerifyHub parity)
        if (digiApiClient.isDigiAuthFailure(st, dmsg)) {
          return res.status(502).json({
            success: false,
            message: "Bureau authentication failed. Please try again later.",
            provider: "digi",
            apiType: "digi",
          });
        }
        const failedReport = await saveDigiFailedRow(
          digiErr.response?.data || { message: digiErr.message },
        );
        if (digiErr.code === "ETIMEDOUT" || digiErr.code === "ECONNABORTED") {
          return res.status(504).json({
            success: false,
            message: "Request timeout when connecting to Digi CIBIL. Please try again later.",
            provider: "digi",
            apiType: "digi",
            creditReportId: failedReport._id,
          });
        }
        if (digiErr.isAxiosError && !digiErr.response) {
          return res.status(502).json({
            success: false,
            message: "Network error when connecting to Digi CIBIL.",
            provider: "digi",
            apiType: "digi",
            creditReportId: failedReport._id,
          });
        }
        if (st === 429) {
          return res.status(429).json({
            success: false,
            message: "Too many requests to Digi CIBIL. Please try again later.",
            provider: "digi",
            apiType: "digi",
            creditReportId: failedReport._id,
          });
        }
        return res.status(st || 500).json({
          success: false,
          message: dmsg,
          provider: "digi",
          apiType: "digi",
          error: digiErr.response?.data || null,
          creditReportId: failedReport._id,
        });
      }
      const digiParsed = digiApiClient.parseDigiResponse(digiRes.data);
      // Empty cibilData = no bureau record — Failed row + normalized message
      // so the franchise/admin no-record handling keeps working unchanged.
      if (!digiParsed.hasResult) {
        const failedReport = await saveDigiFailedRow(digiRes.data);
        return res.status(404).json({
          success: false,
          message: "No Bureau Record Found For The Provided Inputs.",
          provider: "digi",
          apiType: "digi",
          creditReportId: failedReport._id,
        });
      }
      response = digiRes;
      response.__digi = digiParsed;
      response.__digiBureau = "digi";
      console.log(
        `Digi V2 CIBIL: score=${digiParsed.score ?? "null"} bureauMessage=${digiParsed.bureauMessage ?? "-"}`,
      );
    }

    // =========================
    // CIBIL -> SUREPASS
    // =========================
    else if (bureau === "cibil" && cibilApiType === "surepass") {
      const bureauConfig = getBureauConfig("cibil");

      const requestData = bureauConfig.formatData({
        name,
        mobile,
        pan,
      });

      response = await surepassClient.makeCreditCheckRequest(
        surepassApiKey,
        bureauConfig.endpoint,
        requestData,
      );
    }

    // =========================
    // CRIF -> INDICONNECT (full replace of Surepass)
    // =========================
    else if (bureau === "crif") {
      const cfg = await getIndiconnectConfig(bureau);
      if (!cfg.serviceKey || !cfg.auth || !cfg.providerCode) {
        return res.status(500).json({
          message: `IndiConnect ${bureau.toUpperCase()} credentials not configured (service-key / auth / provider code)`,
        });
      }
      const ep = cfg.endpoint.startsWith("/")
        ? cfg.endpoint
        : `/${cfg.endpoint}`;
      const payload = indiconnectClient.buildCrifPayload({
        pan,
        name,
        mobile,
      });
      response = await axios.post(`${cfg.baseUrl}${ep}`, payload, {
        headers: {
          "Content-Type": "application/json",
          "service-key": cfg.serviceKey,
          Authorization: cfg.auth,
          providercode: cfg.providerCode,
        },
        timeout: 60000,
      });
      response.__indiconnect =
        indiconnectClient.parseCrifResponse(response.data);
      response.__indiconnectBureau = bureau;
      {
        const failReason =
          indiconnectClient.indiconnectFailed(response.__indiconnect);
        if (failReason) {
          return res.status(502).json({
            success: false,
            message: failReason,
            error: response.__indiconnect.error || null,
            txnId: response.__indiconnect.txn_id || null,
          });
        }
      }
      console.log(
        `IndiConnect V2 ${bureau.toUpperCase()}: score=${response.__indiconnect.score ?? "null"} pdf=${response.__indiconnect.reportUrl ? "yes" : "no"} bureau=${response.__indiconnect.bureauStatus}/${response.__indiconnect.bureauMessage} txn=${response.__indiconnect.txn_id}`,
      );
    }

    // =========================
    // EXPERIAN -> SOFT-PULL (full replace of Surepass)
    // =========================
    else if (bureau === "experian") {
      const { dob: v2dob, pincode: v2pincode } = req.body;
      const missing = [];
      if (!v2pincode) missing.push("pincode");
      if (!v2dob) missing.push("dob");
      if (missing.length) {
        return res.status(400).json({
          message: "Missing required fields for Experian",
          missingFields: missing,
        });
      }
      const split = indiconnectClient.splitFullName(name);
      if (!split) {
        return res.status(400).json({
          message: "Full name must contain first and last name for Experian",
        });
      }
      try {
        const out = await runExperianSoftPull({
          firstName: split.firstName,
          lastName: split.lastName,
          mobile,
          panNumber: pan,
          dob:
            v2dob instanceof Date
              ? v2dob.toISOString().slice(0, 10)
              : String(v2dob).slice(0, 10),
          pincode: v2pincode,
          consentIp: req.ip,
        });
        response = out.response;
        response.__indiconnect = out.parsed;
        response.__indiconnectBureau = "experian";
      } catch (spErr) {
        const code = spErr.statusCode || 500;
        if (code === 502 || code === 504 || code === 429 || code === 503) {
          return res.status(code).json({
            success: false,
            message: spErr.body?.message || spErr.message,
            error: spErr.body?.error || null,
            txnId: spErr.body?.txnId || null,
          });
        }
        throw spErr;
      }
    }

    // =========================
    // OTHER BUREAUS (equifax and legacy cibil variants -> Surepass)
    // =========================
    else {
      const bureauConfig = getBureauConfig(bureau);

      const requestData = bureauConfig.formatData({
        name,
        mobile,
        pan,
      });

      response = await surepassClient.makeCreditCheckRequest(
        surepassApiKey,
        bureauConfig.endpoint,
        requestData,
      );
    }

    // =========================
    // SCORE
    // =========================
    let score = null;

    if (bureau === "cibil" && cibilApiType === "indiconnect") {
      score = response.__indiconnect?.score ?? null;
    } else if (bureau === "cibil" && cibilApiType === "digi") {
      score = response.__digi?.score ?? null;
    } else if (
      response.__indiconnectBureau === "crif" ||
      response.__indiconnectBureau === "experian"
    ) {
      score = response.__indiconnect.score;
    } else {
      score =
        response?.data?.data?.score ||
        response?.data?.data?.credit_score ||
        null;
    }

    // =========================
    // REPORT URL
    // =========================
    let reportUrl = null;

    if (bureau === "cibil" && cibilApiType === "indiconnect") {
      // Prefer the direct PDF link; fall back to the CIBIL web page link
      reportUrl =
        response.__indiconnect?.pdfUrl || response.__indiconnect?.htmlUrl || null;
    } else if (bureau === "cibil" && cibilApiType === "digi") {
      // Digi v7 returns bureau JSON only — our styled PDF is rendered locally below
      reportUrl = null;
    } else if (
      response.__indiconnectBureau === "crif" ||
      response.__indiconnectBureau === "experian"
    ) {
      reportUrl = response.__indiconnect.reportUrl;
    } else {
      reportUrl =
        response?.data?.data?.report_url ||
        response?.data?.data?.pdf_url ||
        response?.data?.data?.credit_report_link ||
        null;
    }

    // =========================
    // SAVE IN DATABASE
    // =========================
    const isV2IndiconnectCibil =
      bureau === "cibil" && cibilApiType === "indiconnect";
    const isV2DigiCibil = bureau === "cibil" && cibilApiType === "digi";
    const creditReport = new CreditReport({
      userId: req.user?.id,
      franchiseId: req.user?.franchiseId,

      name,
      mobile,
      pan,

      score,
      bureau,

      reportData: response.data,
      reportUrl,
      // IndiConnect CIBIL with a report URL: direct PDF links download inline;
      // htmlUrl-only rows are rendered to PDF in background after responding
      ...(isV2IndiconnectCibil && reportUrl ? { pdfStatus: "pending" } : {}),
    });

    await creditReport.save();

    // Experian Soft-Pull: render our styled PDF from the bureau JSON.
    if (
      response.__indiconnectBureau === "experian" &&
      response.__indiconnect &&
      !creditReport.localPath
    ) {
      try {
        const gen = await experianCirPdf.generateExperianPdf(
          response.__indiconnect,
          { name, mobile, pan },
        );
        if (gen) {
          const reportsDir = path.join(__dirname, "../reports");
          if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
          }
          const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;
          fs.writeFileSync(path.join(reportsDir, filename), gen.buffer);
          creditReport.localPath = `/reports/${filename}`;
          await creditReport.save();
          console.log(
            `Experian V2 styled PDF generated: ${filename} (score ${gen.model.score})`,
          );
        }
      } catch (genErr) {
        console.log("EXPERIAN PDF GENERATE FAILED", genErr.message);
      }
    }

    // Digi CIBIL: render our styled PDF from the bureau JSON
    // (Digi v7 returns cibilData, not a PDF link).
    if (isV2DigiCibil && response.__digi && !creditReport.localPath) {
      try {
        const gen = await digiCibilPdf.generateDigiCibilPdf(response.__digi, {
          name,
          mobile,
          pan,
        });
        if (gen) {
          const reportsDir = path.join(__dirname, "../reports");
          if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
          }
          const filename = `cibil_digi_report_${creditReport._id}_${Date.now()}.pdf`;
          fs.writeFileSync(path.join(reportsDir, filename), gen.buffer);
          creditReport.localPath = `/reports/${filename}`;
          creditReport.pdfStatus = "ready";
          await creditReport.save();
          console.log(
            `Digi V2 styled PDF generated: ${filename} (score ${gen.model.score ?? "null"})`,
          );
        }
      } catch (genErr) {
        console.log("DIGI PDF GENERATE FAILED", genErr.message);
      }
    }

    // =========================
    // DOWNLOAD PDF LOCALLY
    // =========================
    // Direct PDF links download inline; IndiConnect htmlUrl-only rows use the
    // background renderer (never download an HTML page as .pdf).
    if (
      reportUrl &&
      !creditReport.localPath &&
      (!isV2IndiconnectCibil ||
        !indiconnectClient.isHtmlReportUrl(reportUrl))
    ) {
      try {
        // CREATE REPORTS FOLDER
        const reportsDir = path.join(__dirname, "../reports");

        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        // FILE NAME
        const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;

        const localFilePath = path.join(reportsDir, filename);

        // DOWNLOAD PDF
        const pdfResponse = await axios({
          method: "GET",
          url: reportUrl,
          responseType: "stream",
          timeout: 30000,
        });

        // SAVE PDF
        const writer = fs.createWriteStream(localFilePath);

        pdfResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        // SAVE LOCAL PATH
        creditReport.localPath = `/reports/${filename}`;

        await creditReport.save();
      } catch (downloadError) {
        console.log("PDF DOWNLOAD ERROR", downloadError.message);
      }
    }

    // =========================
    // FINAL RESPONSE
    // =========================
    // IndiConnect CIBIL htmlUrl-only rows render to local PDF in background
    // (non-blocking, link fallback on failure).
    if (
      isV2IndiconnectCibil &&
      reportUrl &&
      indiconnectClient.isHtmlReportUrl(reportUrl)
    ) {
      cibilPdfService.renderCibilPdfInBackground(
        CreditReport,
        creditReport._id,
        reportUrl,
      );
    }

    const v2NoCibilRecord =
      isV2IndiconnectCibil &&
      (response.__indiconnect?.bureauStatus === 2 ||
        /no\s*record\s*found/i.test(
          response.__indiconnect?.bureauMessage || "",
        ));

    return res.status(200).json({
      message: v2NoCibilRecord
        ? "No CIBIL record found for these details"
        : `${bureau.toUpperCase()} report fetched successfully`,
      apiType: cibilApiType,
      provider: isV2DigiCibil
        ? "digi"
        : response.__indiconnectBureau
          ? "indiconnect"
          : "surepass",

      creditReport: {
        id: creditReport._id,
        name: creditReport.name,
        mobile: creditReport.mobile,
        pan: creditReport.pan,

        bureau: creditReport.bureau,
        score: creditReport.score,

        reportUrl: creditReport.reportUrl,
        localPath: creditReport.localPath,
        pdfStatus: creditReport.pdfStatus || null,
        txnId: response.__indiconnect?.txn_id || null,

        createdAt: creditReport.createdAt,
      },

      data: response.data,
    });
  } catch (apiError) {
    console.log("FULL API ERROR");
    console.log(apiError);

    // TIMEOUT
    if (apiError.code === "ETIMEDOUT" || apiError.code === "ECONNABORTED") {
      return res.status(504).json({
        message: "Request timeout",
        error: "TIMEOUT_ERROR",
      });
    }

    // NETWORK ERROR
    if (apiError.isAxiosError && !apiError.response) {
      return res.status(502).json({
        message: "Network error",
        error: "NETWORK_ERROR",
      });
    }

    // RATE LIMIT
    if (apiError?.response?.status === 429) {
      return res.status(429).json({
        message: "Too many requests",
        error: "RATE_LIMIT_EXCEEDED",
      });
    }

    if (apiError?.response) {
      return res.status(apiError.response.status).json({
        success: false,

        message: apiError.response.data?.message || "Credit check failed",

        error: apiError.response.data?.message_code || apiError.message,

        data: apiError.response.data?.data || null,
      });
    }

    // DEFAULT ERROR
    return res.status(500).json({
      message: "Credit bureau API failed",
      error: apiError.message,
    });
  }
};

// POST /api/credit/generate-experian-report
// Dedicated Experian Soft-Pull endpoint (auth required).
// Body: panNumber, fullName, mobileNumber, dob (YYYY-MM-DD), pincode,
//       customerConsent ("Y"), + optional email, stateName, cityName, orderId
const generateExperianReport = async (req, res) => {
  try {
    if (!req.user?._id && !req.user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const {
      panNumber,
      fullName,
      mobileNumber,
      email,
      dob,
      pincode,
      customerConsent,
    } = req.body;

    // 1. Required fields
    const missing = [];
    if (!panNumber) missing.push("panNumber");
    if (!fullName) missing.push("fullName");
    if (!mobileNumber) missing.push("mobileNumber");
    if (!dob) missing.push("dob");
    if (!pincode) missing.push("pincode");
    if (!customerConsent) missing.push("customerConsent");
    if (missing.length) {
      return res
        .status(400)
        .json({ message: "Missing required fields", missingFields: missing });
    }
    if (customerConsent !== "Y") {
      return res.status(400).json({
        message: "Customer consent is required (customerConsent must be 'Y')",
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dob))) {
      return res.status(400).json({
        message: "dob must be in YYYY-MM-DD format",
      });
    }
    const split = indiconnectClient.splitFullName(fullName);
    if (!split) {
      return res.status(400).json({
        message: "fullName must contain first and last name",
      });
    }
    const pan = String(panNumber).toUpperCase();

    // 2. Duplicate check (15-day mobile/PAN window, franchise users)
    let franchise = null;
    if (req.user.role !== "admin") {
      const lastReport = await CreditReport.findOne({
        mobile: mobileNumber,
        pan,
        bureau: "experian",
      }).sort({ createdAt: -1 });
      if (lastReport) {
        const diffDays =
          (new Date() - new Date(lastReport.createdAt)) /
          (1000 * 60 * 60 * 24);
        if (diffDays < 15) {
          const remainingDays = Math.ceil(15 - diffDays);
          return res.status(400).json({
            message: `This report has already been downloaded. Try again after ${remainingDays} days.`,
          });
        }
      }
      franchise = await Franchise.findById(req.user.franchiseId);
      if (!franchise) {
        return res.status(404).json({ message: "Franchise not found" });
      }
      if (franchise.credits < 1) {
        return res.status(400).json({
          message: "Insufficient credits to generate credit report",
        });
      }
    }

    // 3. Soft-Pull call
    let parsed;
    let rawData;
    try {
      const out = await runExperianSoftPull({
        firstName: split.firstName,
        lastName: split.lastName,
        mobile: mobileNumber,
        panNumber: pan,
        dob: String(dob).slice(0, 10),
        pincode,
        consentIp: req.ip,
      });
      parsed = out.parsed;
      rawData = out.response.data;
    } catch (spErr) {
      return res
        .status(spErr.statusCode || 500)
        .json(spErr.body || { message: spErr.message });
    }

    // 4. Save report row
    const creditReport = new CreditReport({
      userId: req.user.id || req.user._id,
      franchiseId: req.user.role === "admin" ? null : req.user.franchiseId,
      name: fullName,
      mobile: mobileNumber,
      email: email || undefined,
      pan,
      dob: new Date(dob),
      score: parsed.score,
      bureau: "experian",
      reportData: rawData,
      reportUrl: null,
    });
    await creditReport.save();

    // 5. Styled PDF from the bureau JSON
    let localPath = null;
    try {
      const gen = await experianCirPdf.generateExperianPdf(parsed, {
        name: fullName,
        mobile: mobileNumber,
        pan,
      });
      if (gen) {
        const reportsDir = path.join(__dirname, "../reports");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        const filename = `credit_report_${creditReport._id}_${Date.now()}.pdf`;
        fs.writeFileSync(path.join(reportsDir, filename), gen.buffer);
        localPath = `/reports/${filename}`;
        creditReport.localPath = localPath;
        creditReport.pdfStatus = "ready";
        await creditReport.save();
      }
    } catch (genErr) {
      console.error("EXPERIAN PDF GENERATE FAILED:", genErr.message);
    }
    if (!localPath) {
      return res.status(500).json({
        message: "Failed to generate Experian report PDF",
        creditReportId: creditReport._id,
      });
    }

    // 6. Deduct credit post-success only
    if (req.user.role !== "admin" && franchise) {
      franchise.credits -= 1;
      await franchise.save();
    }

    // 7. Success response (their platform's shape)
    const cph = parsed.creditProfileHeader || {};
    return res.status(200).json({
      success: true,
      status: "success",
      creditReportId: creditReport._id,
      score: parsed.score,
      scoreConfidence: parsed.scoreConfidence,
      exactMatch: parsed.exactMatch,
      reportNumber: cph.ReportNumber ?? null,
      reportDate: cph.ReportDate ?? null,
      reportTime: cph.ReportTime ?? null,
      version: cph.Version ?? null,
      pdfUrl: localPath,
      data: {
        header: parsed.header,
        userMessage: parsed.userMessage,
        totalCAPS: parsed.totalCaps,
        caisAccount: parsed.caisAccount,
        caps: parsed.caps,
        nonCreditCAPS: parsed.nonCreditCaps,
        currentApplication: parsed.currentApplication,
      },
    });
  } catch (error) {
    console.error("generateExperianReport error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  checkCreditScore,
  checkCreditScorePublic, // Add the new public function
  getCreditReports,
  getAllCreditReports,
  getCreditReportById,
  getSurepassApiKey,
  updateSurepassApiKey,
  getSurepassApiKeyValue, // Export the helper function
  getIndiconnectKeys,
  updateIndiconnectKeys,
  getDigiKeys,
  updateDigiKeys,
  getDigiConfig,
  getIndiconnectCibilConfig,
  getIndiconnectConfig,
  isIndiconnectCibilBureau,
  getSingleCreditReports,
  checkCreditScoreV2,
  getFranchiseReports,
  generateExperianReport,
};
