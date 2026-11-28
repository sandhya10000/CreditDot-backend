const {
  computeAmounts,
  validateEntry,
  summarizeEntries,
  parseEntryDate,
  isValidMonth,
} = require("../config/workTracking");

const base = {
  entryDate: "2026-11-15",
  category: "business",
  amount: 1000,
  gstMode: "without_gst",
};

describe("GST calculation", () => {
  it("adds 18% when the amount is without GST", () => {
    expect(computeAmounts({ category: "business", amount: 1000, gstMode: "without_gst" })).toEqual({
      baseAmount: 1000,
      gstAmount: 180,
      totalAmount: 1180,
      gstMode: "without_gst",
    });
  });

  it("splits the amount when it already includes GST", () => {
    const result = computeAmounts({ category: "credit_score_repair", amount: 1180, gstMode: "with_gst" });
    expect(result.baseAmount).toBe(1000);
    expect(result.gstAmount).toBe(180);
    expect(result.totalAmount).toBe(1180);
  });

  it("keeps base + GST equal to total after rounding", () => {
    const result = computeAmounts({ category: "business", amount: 999.99, gstMode: "with_gst" });
    expect(round(result.baseAmount + result.gstAmount)).toBe(result.totalAmount);
  });

  it("never adds GST to franchise amounts", () => {
    expect(computeAmounts({ category: "franchise", amount: 5000 })).toEqual({
      baseAmount: 5000,
      gstAmount: 0,
      totalAmount: 5000,
      gstMode: null,
    });
  });
});

describe("validateEntry", () => {
  it("accepts a valid GST entry and computes the amounts on the server", () => {
    const { errors, value } = validateEntry(base);
    expect(errors).toEqual([]);
    expect(value.totalAmount).toBe(1180);
    expect(value.entryMonth).toBe("2026-11");
    expect(value.entryDate.toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });

  it("accepts any date, including dates in the past and future", () => {
    expect(validateEntry({ ...base, entryDate: "2020-01-01" }).errors).toEqual([]);
    expect(validateEntry({ ...base, entryDate: "2040-06-30" }).errors).toEqual([]);
  });

  it("requires a franchise tier for franchise entries", () => {
    const { errors } = validateEntry({ entryDate: "2026-11-01", category: "franchise", amount: 500 });
    expect(errors.join(" ")).toMatch(/franchise tier/);
  });

  it("accepts a franchise tier and skips GST", () => {
    const { errors, value } = validateEntry({
      entryDate: "2026-11-01",
      category: "franchise",
      franchiseTier: "platinum",
      amount: 500,
    });
    expect(errors).toEqual([]);
    expect(value.gstMode).toBeNull();
    expect(value.totalAmount).toBe(500);
  });

  it("requires a GST choice for GST categories", () => {
    const { errors } = validateEntry({ ...base, gstMode: undefined });
    expect(errors.join(" ")).toMatch(/With GST/);
  });

  it.each([
    ["empty amount", ""],
    ["text amount", "abc"],
    ["zero amount", 0],
    ["negative amount", -10],
    ["too many decimals", 10.005],
    ["amount above the limit", 1000000001],
  ])("rejects %s", (_label, amount) => {
    const { errors } = validateEntry({ ...base, amount });
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(["2026-02-31", "15-11-2026", "2026-13-01", "", undefined])("rejects date %p", (entryDate) => {
    expect(validateEntry({ ...base, entryDate }).errors).toContain("A valid date is required");
  });

  it("rejects unknown categories and tiers", () => {
    expect(validateEntry({ ...base, category: "salary" }).errors.length).toBeGreaterThan(0);
    const { errors } = validateEntry({
      entryDate: "2026-11-01",
      category: "franchise",
      franchiseTier: "gold",
      amount: 10,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("summarizeEntries", () => {
  const entries = [
    { category: "franchise", franchiseTier: "silver", baseAmount: 1000, gstAmount: 0, totalAmount: 1000 },
    { category: "franchise", franchiseTier: "diamond", baseAmount: 2000, gstAmount: 0, totalAmount: 2000 },
    { category: "business", franchiseTier: null, baseAmount: 1000, gstAmount: 180, totalAmount: 1180 },
    { category: "credit_score_repair", franchiseTier: null, baseAmount: 500, gstAmount: 90, totalAmount: 590 },
  ];

  it("totals with and without GST for incentive calculation", () => {
    const summary = summarizeEntries(entries);
    expect(summary.totalWithoutGst).toBe(4500);
    expect(summary.totalWithGst).toBe(4770);
    expect(summary.totalGst).toBe(270);
    expect(summary.count).toBe(4);
  });

  it("breaks totals down by category and franchise tier", () => {
    const summary = summarizeEntries(entries);
    expect(summary.byCategory.franchise.count).toBe(2);
    expect(summary.byCategory.business.totalAmount).toBe(1180);
    expect(summary.byTier.silver.baseAmount).toBe(1000);
    expect(summary.byTier.diamond.baseAmount).toBe(2000);
    expect(summary.byTier.platinum.count).toBe(0);
  });

  it("returns zeros for no entries", () => {
    const summary = summarizeEntries([]);
    expect(summary.totalWithGst).toBe(0);
    expect(summary.count).toBe(0);
  });
});

describe("date and month helpers", () => {
  it("parses only real calendar dates", () => {
    expect(parseEntryDate("2026-11-28")).toBeInstanceOf(Date);
    expect(parseEntryDate("2024-02-29")).toBeInstanceOf(Date);
    expect(parseEntryDate("2026-02-29")).toBeNull();
  });

  it("validates YYYY-MM months", () => {
    expect(isValidMonth("2026-11")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("11-2026")).toBe(false);
  });
});

const round = (value) => Math.round(value * 100) / 100;
