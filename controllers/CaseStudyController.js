const caseStudy = require("../models/CaseStudy");

const createCaseStudy = async (req, res) => {
  try {
    console.log("API HIT");
    console.log(req.body);
    console.log(req.files);

    const { title, description, category } = req.body;

    if (!req.files?.beforeWorking || !req.files?.afterWorking) {
      return res.status(400).json({
        message: "Both PDF files are required",
      });
    }
    const allowedCategories = [
      "dpd",
      "inquiries",
      "score_increase",
      "settlement",
      "write_off",
      "suit_filed",
      "post_write_off_closed",
      "fake_loans",
      "sma_removed",
    ];

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({
        message: "Invalid category",
      });
    }

    const newCaseStudy = await caseStudy.create({
      title,
      category,
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
    const { category } = req.query;
    const caseStudies = await caseStudy.find().sort({ createdAt: -1 });
    if (category) {
      filter.category = category;
    }
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
const updateCaseStudy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category } = req.body;

    const updateData = {
      title,
      description,
      category,
    };

    // if new beforeWorking file uploaded
    if (req.files?.beforeWorking?.[0]) {
      updateData.beforeWorking =
        "/uploads/case-study/" + req.files.beforeWorking[0].filename;
    }

    // if new afterWorking file uploaded
    if (req.files?.afterWorking?.[0]) {
      updateData.afterWorking =
        "/uploads/case-study/" + req.files.afterWorking[0].filename;
    }

    const updatedCaseStudy = await caseStudy.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedCaseStudy) {
      return res.status(404).json({ message: "Case Study not found" });
    }

    return res.status(200).json({
      message: "Case Study updated successfully",
      data: updatedCaseStudy,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update case study",
      error: error.message,
    });
  }
};
const deleteCaseStudy = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await caseStudy.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        message: "Case Study not found",
      });
    }

    return res.status(200).json({
      message: "Case Study deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete case study",
      error: error.message,
    });
  }
};

module.exports = {
  createCaseStudy,
  getCaseStudies,
  deleteCaseStudy,
  updateCaseStudy,
};
