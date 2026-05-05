const MarketingMaterial = require("../models/MarketingMaterial");

//upload MarketinfMaterial
const uploadmarketingMaterial = async (req, res) => {
  try {
    const material = await MarketingMaterial.create({
      title: req.body.title,
      description: req.body.description,
      fileUrl: "/uploads/marketing/" + req.file.filename,
      fileType: req.file.mimetype,
    });

    res.status(201).json({
      message: "Marketing material upload successfully",
      data: material,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Upload failed",
    });
  }
};

//Get All Materials
const getMarketingMaterials = async (req, res) => {
  try {
    const data = await MarketingMaterial.find().sort({
      createdAt: -1,
    });

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const updatedData = data.map((item) => ({
      ...item._doc, // important for mongoose
      file: item.file ? `${baseUrl}${item.file}` : null,
      //  change "file" to your actual field name
    }));

    res.status(200).json({
      success: true,
      data: updatedData,
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch data",
    });
  }
};

module.exports = { uploadmarketingMaterial, getMarketingMaterials };
