const FranchiseCounter = require("../models/FranchiseCounter");
const Franchise = require("../models/Franchise");

const generateFranchiseCode = async () => {
  while (true) {
    const counter = await FranchiseCounter.findOneAndUpdate(
      { _id: "franchiseCode" },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    const franchiseCode = `FP-${String(counter.seq).padStart(3, "0")}`;

    const exists = await Franchise.exists({ franchiseCode });

    if (!exists) {
      return franchiseCode;
    }
  }
};

module.exports = generateFranchiseCode;

module.exports = generateFranchiseCode;
