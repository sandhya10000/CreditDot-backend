// Monthly Working & Business Tracking: entry categories, GST rules, validation and
// monthly totals. Pure functions only, so they can be unit tested without a database.

const GST_RATE = 0.18;

// Upper bound for a single entry (in rupees). Guards against typos like an extra zero.
const MAX_ENTRY_AMOUNT = 100000000;

const CATEGORIES = {
  franchise: { key: "franchise", label: "Franchise", usesGst: false, usesTier: true },
  credit_score_repair: {
    key: "credit_score_repair",
    label: "Credit Score Repair",
    usesGst: true,
    usesTier: false,
  },
  business: {
    key: "business",
    label: "Business (Total Amount Collected)",
    usesGst: true,
    usesTier: false,
  },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);
const FRANCHISE_TIERS = ["silver", "platinum", "diamond"];
const GST_MODES = ["with_gst", "without_gst"];

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Splits the amount the user typed into base, GST and total.
// Franchise amounts carry no GST. For GST categories the typed amount is either
// the base ("without_gst") or already includes GST ("with_gst").
const computeAmounts = ({ category, amount, gstMode }) => {
  const value = round2(Number(amount));
  if (!CATEGORIES[category]?.usesGst) {
    return { baseAmount: value, gstAmount: 0, totalAmount: value, gstMode: null };
  }
  if (gstMode === "with_gst") {
    const baseAmount = round2(value / (1 + GST_RATE));
    return {
      baseAmount,
      gstAmount: round2(value - baseAmount),
      totalAmount: value,
      gstMode,
    };
  }
  const gstAmount = round2(value * GST_RATE);
  return {
    baseAmount: value,
    gstAmount,
    totalAmount: round2(value + gstAmount),
    gstMode,
  };
};

// Accepts "YYYY-MM-DD" only and rejects impossible dates such as 2026-02-31.
const parseEntryDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const isValidMonth = (value) =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

// Validates a submitted entry. Returns { errors, value } where value holds the cleaned
// fields and the server-computed amounts. Amounts are never taken from the client.
const validateEntry = (input = {}) => {
  const errors = [];
  const category = input.category;
  const entryDate = parseEntryDate(input.entryDate);

  if (!entryDate) errors.push("A valid date is required");
  if (!CATEGORIES[category]) errors.push("Choose a category");

  let franchiseTier = null;
  if (CATEGORIES[category]?.usesTier) {
    if (!FRANCHISE_TIERS.includes(input.franchiseTier)) {
      errors.push("Choose a franchise tier (Silver, Platinum or Diamond)");
    } else {
      franchiseTier = input.franchiseTier;
    }
  }

  const rawAmount = input.amount;
  const amountText = typeof rawAmount === "string" ? rawAmount.trim() : rawAmount;
  const amount = amountText === "" || amountText === null ? NaN : Number(amountText);
  if (!Number.isFinite(amount)) {
    errors.push("Amount must be a number");
  } else if (amount <= 0) {
    errors.push("Amount must be greater than zero");
  } else if (amount > MAX_ENTRY_AMOUNT) {
    errors.push(`Amount cannot exceed ${MAX_ENTRY_AMOUNT.toLocaleString("en-IN")}`);
  } else if (round2(amount) !== amount) {
    errors.push("Amount can have at most two decimal places");
  }

  let gstMode = null;
  if (CATEGORIES[category]?.usesGst) {
    if (!GST_MODES.includes(input.gstMode)) {
      errors.push("Choose With GST or Without GST");
    } else {
      gstMode = input.gstMode;
    }
  }

  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > 300) errors.push("Notes cannot exceed 300 characters");

  if (errors.length) return { errors, value: null };

  return {
    errors,
    value: {
      entryDate,
      entryMonth: input.entryDate.slice(0, 7),
      category,
      franchiseTier,
      amount: round2(amount),
      notes,
      ...computeAmounts({ category, amount, gstMode }),
    },
  };
};

// Totals for a list of saved entries. Franchise amounts count as "without GST".
const summarizeEntries = (entries = []) => {
  const emptyCategory = () => ({ count: 0, baseAmount: 0, gstAmount: 0, totalAmount: 0 });
  const byCategory = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, emptyCategory()]));
  const byTier = Object.fromEntries(FRANCHISE_TIERS.map((tier) => [tier, emptyCategory()]));
  const totals = emptyCategory();

  for (const entry of entries) {
    const bucket = byCategory[entry.category];
    if (!bucket) continue;
    for (const target of [bucket, totals]) {
      target.count += 1;
      target.baseAmount = round2(target.baseAmount + entry.baseAmount);
      target.gstAmount = round2(target.gstAmount + entry.gstAmount);
      target.totalAmount = round2(target.totalAmount + entry.totalAmount);
    }
    if (entry.category === "franchise" && byTier[entry.franchiseTier]) {
      const tier = byTier[entry.franchiseTier];
      tier.count += 1;
      tier.baseAmount = round2(tier.baseAmount + entry.baseAmount);
      tier.totalAmount = round2(tier.totalAmount + entry.totalAmount);
    }
  }

  return {
    byCategory,
    byTier,
    // Used for incentive calculation: "without GST" and "with GST" totals
    totalWithoutGst: totals.baseAmount,
    totalWithGst: totals.totalAmount,
    totalGst: totals.gstAmount,
    count: totals.count,
  };
};

module.exports = {
  GST_RATE,
  MAX_ENTRY_AMOUNT,
  CATEGORIES,
  CATEGORY_KEYS,
  FRANCHISE_TIERS,
  GST_MODES,
  round2,
  computeAmounts,
  parseEntryDate,
  isValidMonth,
  validateEntry,
  summarizeEntries,
};
