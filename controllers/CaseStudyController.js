const caseStudy = require("../models/CaseStudy");

const createCaseStudy = async (req, res) => {
  try {
    console.log("API HIT");
    console.log(req.body);
    console.log(req.files);

    const { title, description } = req.body;

    if (!req.files?.beforeWorking || !req.files?.afterWorking) {
      return res.status(400).json({
        message: "Both PDF files are required",
      });
    }

    const newCaseStudy = await caseStudy.create({
      title,
      description,
      beforeWorking:
        "/uploads/case-study/" + req.files.beforeWorking[0].filename,

      afterWorking: "/uploads/case-study/" + req.files.afterWorking[0].filename,

      createdBy: req.user?._id || null,
    });

    console.log("DATA SAVED");

    return res.status(201).json({
      message: "Case Study created successfully",
      data: newCaseStudy,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create case study",
      error: error.message,
    });
  }
};
const getCaseStudies = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const caseStudies = await caseStudy.find().sort({ createdAt: -1 });
    const updatedData = caseStudies.map((item) => ({
      ...item._doc,
      beforeWorking: `${baseUrl}${item.beforeWorking}`,
      afterWorking: `${baseUrl}${item.afterWorking}`,
    }));
    res.status(200).json({
      success: true,
      data: updatedData,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch case studies",
    });
  }
};

module.exports = { createCaseStudy, getCaseStudies };
