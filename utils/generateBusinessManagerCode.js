const FranchiseCounter = require("../models/FranchiseCounter");

// Atomic serial for Business Managers: RM-1, RM-2, ... Codes are never reused.
const generateBusinessManagerCode = async () => {
  const counter = await FranchiseCounter.findOneAndUpdate(
    { _id: "businessManagerCode" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `RM-${counter.seq}`;
};

module.exports = generateBusinessManagerCode;
