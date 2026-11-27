const surepassClient = require("./surepassApiClient");

// Surepass PAN comprehensive: returns name, DOB, gender, address and Aadhaar-link status.
const PAN_COMPREHENSIVE_URL =
  process.env.SUREPASS_PAN_URL ||
  "https://kyc-api.surepass.app/api/v1/pan/pan-comprehensive";

const GENDER_MAP = { M: "male", F: "female", T: "transgender" };

// Calls Surepass and returns the raw response body
const fetchPanComprehensive = async (pan, apiKey) => {
  if (!apiKey) {
    const err = new Error("Surepass API key is not configured");
    err.code = "SUREPASS_KEY_MISSING";
    throw err;
  }
  const response = await surepassClient.makeRequest(
    apiKey,
    PAN_COMPREHENSIVE_URL,
    { id_number: pan },
    { timeout: 60000 },
  );
  return response.data;
};

// Maps the Surepass body to the shape the franchise profile and KYC approval already read:
//   { success, message, data: { status: "valid" | "invalid", full_name, dob, gender, address: {...}, ... } }
// Surepass has no "status" field, so a PAN counts as valid when the call succeeded and
// the response carries the PAN number.
const toPanDetails = (body) => {
  const d = body?.data || {};
  const verified = body?.success === true && Boolean(d.pan_number);
  const address = d.address || {};

  return {
    success: verified,
    message: verified
      ? "PAN verified successfully"
      : body?.message || "PAN verification failed",
    data: {
      status: verified ? "valid" : "invalid",
      txn_id: d.client_id || null,
      pan_number: d.pan_number || null,
      full_name: d.full_name || null,
      full_name_split: d.full_name_split || [],
      masked_aadhaar: d.masked_aadhaar || null,
      aadhaar_linked: d.aadhaar_linked ?? null,
      dob: d.dob || null,
      gender: GENDER_MAP[d.gender] || d.gender || null,
      email: d.email || null,
      phone_number: d.phone_number || null,
      category: d.category || null,
      address: {
        line_1: address.line_1 || null,
        line_2: address.line_2 || null,
        street_name: address.street_name || null,
        zip: address.zip || null,
        city: address.city || null,
        state: address.state || null,
        country: address.country || null,
        full: address.full || null,
      },
      datetime: null,
    },
  };
};

module.exports = {
  fetchPanComprehensive,
  toPanDetails,
};
