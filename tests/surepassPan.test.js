const { toPanDetails } = require("../utils/surepassPanClient");

const demo = {
  data: {
    client_id: "pan_comprehensive_NZAOcvheHYtwohtkWQbH",
    pan_number: "EKRPR1234F",
    full_name: "MR. RATHORE",
    full_name_split: ["MR", "", "RATHORE"],
    masked_aadhaar: "XXXXXXXX1234",
    address: { line_1: "A 000 ", line_2: "Jagatpura", street_name: "S.O", zip: 123456, city: "Jaipur", state: "RAJASTHAN", country: "INDIA", full: "A 000 RAJASTHAN INDIA" },
    email: "RA*********RE@GMAIL.COM",
    phone_number: "12XXXXXX10",
    gender: "M",
    dob: "0001-07-00",
    aadhaar_linked: true,
    category: "person",
  },
  status_code: 200,
  success: true,
  message: null,
  message_code: "success",
};

describe("Surepass PAN mapping", () => {
  it("marks a successful lookup as valid and keeps the fields KYC reads", () => {
    const result = toPanDetails(demo);
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("valid");
    expect(result.data.pan_number).toBe("EKRPR1234F");
    expect(result.data.full_name).toBe("MR. RATHORE");
    expect(result.data.gender).toBe("male");
    expect(result.data.txn_id).toBe("pan_comprehensive_NZAOcvheHYtwohtkWQbH");
    expect(result.data.address.city).toBe("Jaipur");
    expect(result.data.address.zip).toBe(123456);
  });

  it("treats a failed lookup as invalid and passes Surepass's message through", () => {
    const result = toPanDetails({ success: false, message: "Invalid PAN" });
    expect(result.success).toBe(false);
    expect(result.data.status).toBe("invalid");
    expect(result.message).toBe("Invalid PAN");
  });

  it("does not mark valid when the PAN number is missing", () => {
    expect(toPanDetails({ success: true, data: {} }).data.status).toBe("invalid");
  });
});
