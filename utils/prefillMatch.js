// Matches the customer's name, mobile and PAN against the Finpass prefill-by-mobile
// response. Pure functions only, so they can be unit tested.

// Honorifics that appear in bureau/PAN names but not in what partners type
const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SHRIMATI", "SMT", "KUMARI"]);

// "Karan  Sapra." -> "KARAN SAPRA"; compared as a set of words so order and case don't matter
const nameTokens = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !TITLES.has(token))
    .sort();

const sameNames = (a, b) => {
  const left = nameTokens(a);
  const right = nameTokens(b);
  return left.length > 0 && left.length === right.length && left.every((t, i) => t === right[i]);
};

const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

// Pulls the fields we match on out of a Finpass prefill response body.
// Returns null when the response has no prefill record.
const extractPrefillProfile = (body) => {
  const prefill = body?.data?.prefill;
  const details = prefill?.details;
  if (!details) return null;

  const mobiles = [
    prefill.mobile,
    body?.data?.mobile,
    ...(Array.isArray(details.phone_info) ? details.phone_info.map((p) => p?.number) : []),
  ]
    .map(digitsOnly)
    .filter(Boolean);

  const pans = (details.identity_info?.pan_number || [])
    .map((p) => String(p?.id_number || "").toUpperCase().trim())
    .filter(Boolean);

  return {
    fullName: details.personal_info?.full_name || "",
    mobiles,
    pans,
  };
};

// Compares what the partner entered with the prefill record.
// All three must match for the customer to be accepted.
const matchPrefill = ({ name, mobile, pan }, profile) => {
  if (!profile) {
    return { matched: false, nameMatch: false, mobileMatch: false, panMatch: false, reason: "No record found" };
  }

  const mobileMatch = profile.mobiles.includes(digitsOnly(mobile));
  const panMatch = profile.pans.includes(String(pan || "").toUpperCase().trim());
  const nameMatch = sameNames(name, profile.fullName);

  const mismatched = [
    !nameMatch && "name",
    !mobileMatch && "mobile",
    !panMatch && "PAN",
  ].filter(Boolean);

  return {
    matched: nameMatch && mobileMatch && panMatch,
    nameMatch,
    mobileMatch,
    panMatch,
    reason: mismatched.length ? `${mismatched.join(", ")} did not match the records` : null,
  };
};

module.exports = {
  nameTokens,
  sameNames,
  extractPrefillProfile,
  matchPrefill,
};
