const { extractPrefillProfile, matchPrefill, sameNames } = require("../utils/prefillMatch");

// Shape returned by POST .../prefill-by-mobile/fetch (sample from Finpass)
const sampleBody = {
  success: true,
  status_code: 200,
  message: "Prefill fetched successfully",
  data: {
    doc_id: "prefill_6b09f0d4_5be3a2c306ab7d379635a79d",
    mobile: "7678126262",
    prefill: {
      client_id: "prefill_by_mobile_zTpexnbKljDvhkXmRieP",
      mobile: "7678126262",
      details: {
        personal_info: { full_name: "KARAN SAPRA", dob: "2001-06-06", gender: "Male" },
        phone_info: [{ type_code: "mobile", number: "7678126262" }],
        identity_info: {
          pan_number: [{ id_number: "OPQPS8271Q" }],
          other_id: [{ id_number: "40030779661740" }],
        },
      },
    },
  },
};

const profile = extractPrefillProfile(sampleBody);

describe("extractPrefillProfile", () => {
  it("pulls the name, mobiles and PANs out of the response", () => {
    expect(profile.fullName).toBe("KARAN SAPRA");
    expect(profile.mobiles).toContain("7678126262");
    expect(profile.pans).toEqual(["OPQPS8271Q"]);
  });

  it("returns null when there is no prefill record", () => {
    expect(extractPrefillProfile({ success: false, data: null })).toBeNull();
  });
});

describe("matchPrefill", () => {
  it("matches when name, mobile and PAN all agree", () => {
    const result = matchPrefill({ name: "Karan Sapra", mobile: "7678126262", pan: "opqps8271q" }, profile);
    expect(result.matched).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("ignores case, extra spaces and honorifics in the name", () => {
    expect(sameNames("  mr. karan   SAPRA ", "KARAN SAPRA")).toBe(true);
  });

  it("does not match a different name", () => {
    const result = matchPrefill({ name: "Rahul Sapra", mobile: "7678126262", pan: "OPQPS8271Q" }, profile);
    expect(result.matched).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.reason).toMatch(/name/);
  });

  it("does not match a partial name", () => {
    const result = matchPrefill({ name: "Karan", mobile: "7678126262", pan: "OPQPS8271Q" }, profile);
    expect(result.matched).toBe(false);
  });

  it("does not match a PAN that is not on the record", () => {
    const result = matchPrefill({ name: "Karan Sapra", mobile: "7678126262", pan: "ABCDE1234F" }, profile);
    expect(result.matched).toBe(false);
    expect(result.panMatch).toBe(false);
    expect(result.reason).toMatch(/PAN/);
  });

  it("does not match a mobile that is not on the record", () => {
    const result = matchPrefill({ name: "Karan Sapra", mobile: "9999999999", pan: "OPQPS8271Q" }, profile);
    expect(result.matched).toBe(false);
    expect(result.mobileMatch).toBe(false);
  });

  it("treats a missing record as a mismatch", () => {
    const result = matchPrefill({ name: "Karan Sapra", mobile: "7678126262", pan: "OPQPS8271Q" }, null);
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("No record found");
  });
});
