const Reward = require("../models/Reward");

const uploadRewards = async (req, res) => {
  try {
    const { title, description, validityDays } = req.body;
    if (!req.file) {
      return res.status(400).json({
        message: " File is required",
      });
    }
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + Number(validityDays));

    const reward = await Reward.create({
      title,
      description,
      validityDays,
      expiryDate,
      fileUrl: "/uploads/rewards/" + req.file.filename,
      fileType: req.file.mimetype,
    });
    res.status(201).json({
      message: "Reward upload successfully",
      data: reward,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: "Upload failed",
    });
  }
};
// Get Rewards (Only Active)
const getRewards = async (req, res) => {
  try {
    const data = await Reward.find().sort({ createdAt: -1 });

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const updatedData = data.map((item) => ({
      ...item._doc,

      //  Correct field name
      fileUrl: item.fileUrl ? `${baseUrl}${item.fileUrl}` : null,

      fileType: item.fileType,
      expiryDate: item.expiryDate,
    }));

    console.log("All Rewards:", updatedData);

    res.status(200).json(updatedData);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Failed to fetch rewards",
    });
  }
};

module.exports = { uploadRewards, getRewards };
