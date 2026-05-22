const Remark = require("../models/Remark");

const addCustomerRemarks = async (req, res) => {
  try {
    const { customerId, message } = req.body;
    if (!customerId || !message) {
      return res.status(400).json({
        success: false,
        message: "Customer ID and message are required",
      });
    }

    const remark = await Remark.create({
      customerId,
      message,
      createdBy: {
        userId: req.user.id,
        name: req.user.name,
        role: req.user.role,
      },
    });
    res.status(200).json({
      success: true,
      message: "Customer remark added successfully.",
      data: remark,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};
const getCustomerRemarks = async (req, res) => {
  try {
    const { customerId } = req.params;

    const remarks = await Remark.find({
      customerId,
    })
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: remarks,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = { addCustomerRemarks, getCustomerRemarks };
