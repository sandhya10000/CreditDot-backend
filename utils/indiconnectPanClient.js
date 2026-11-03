const axios = require("axios");

// IndiConnect PAN Verification (Premium) over GraphQL
const PAN_PREMIUM_QUERY = `mutation VerifyPanPremium($input: VerifyInput!) {
  verify(input: $input) {
    ok
    message
    status
    result {
      __typename
      ... on BTPanPremiumResult {
        txn_id
        api_name
        api_category
        billable
        message
        status
        datetime
        pan_number
        full_name
        full_name_split
        masked_aadhaar
        address {
          district_code
          district_name
          district_name_vernacular
          state
          state_code
        }
        email
        phone_number
        gender
        dob
        aadhaar_linked
        category
        less_info
        is_director {
          found
          info
        }
        is_sole_proprietor {
          found
          info
        }
        doi
        raw
      }
    }
    error {
      status
      message
      raw
    }
  }
}`;

// Calls IndiConnect and returns the raw verify object
const fetchPanPremium = async (pan, cfg) => {
  const { data } = await axios.post(
    `${cfg.baseUrl}${cfg.endpoint.startsWith("/") ? cfg.endpoint : `/${cfg.endpoint}`}`,
    {
      query: PAN_PREMIUM_QUERY,
      variables: { input: { documentType: "verify-pan-premium", pan } },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "service-key": cfg.serviceKey,
        Authorization: cfg.auth,
        providercode: cfg.providerCode,
      },
      timeout: 60000,
    },
  );

  if (Array.isArray(data?.errors) && data.errors.length) {
    const err = new Error(data.errors[0].message || "IndiConnect PAN request failed");
    err.graphqlErrors = data.errors;
    throw err;
  }
  return data?.data?.verify || null;
};

const GENDER_MAP = { M: "male", F: "female", T: "transgender" };

// Maps the IndiConnect verify result to the shape the franchise profile and approval
// flow already read from Surepass PAN comprehensive:
//   { success, message, data: { status: "valid" | "invalid", full_name, dob, gender, address: {...}, ... } }
const toPanDetails = (verify) => {
  const result = verify?.result || {};
  const raw = result.raw || {};
  const rawResult = raw.result || {};
  const verified = verify?.ok === true && Number(result.status) === 1;

  const rawAddress = rawResult.address || {};
  const topAddress = result.address || {};

  return {
    success: verified,
    message: verified
      ? "PAN verified successfully"
      : verify?.message || verify?.error?.message || result.message || "PAN verification failed",
    data: {
      status: verified ? "valid" : "invalid",
      txn_id: result.txn_id || null,
      pan_number: result.pan_number || null,
      full_name: result.full_name || rawResult.full_name || null,
      full_name_split: result.full_name_split || [],
      masked_aadhaar: result.masked_aadhaar || null,
      aadhaar_linked: result.aadhaar_linked ?? rawResult.aadhaar_linked ?? null,
      dob: result.dob || rawResult.dob || null,
      gender: GENDER_MAP[result.gender] || GENDER_MAP[rawResult.gender] || result.gender || null,
      email: result.email || rawResult.email || null,
      phone_number: result.phone_number || rawResult.phone_number || null,
      category: result.category || rawResult.category || null,
      address: {
        line_1: rawAddress.line_1 || null,
        line_2: rawAddress.line_2 || null,
        street_name: rawAddress.street_name || null,
        zip: rawAddress.zip || null,
        city: rawAddress.city || null,
        state: rawAddress.state || topAddress.state || null,
        country: rawAddress.country || null,
        full: rawAddress.full || null,
      },
      datetime: result.datetime || raw.datetime || null,
    },
  };
};

module.exports = {
  fetchPanPremium,
  toPanDetails,
};
