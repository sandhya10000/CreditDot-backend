const CustomerBureau = require("../models/CustomerBureau");

const saveBureauData = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { bureauCredentials } = req.body;
    let bureauData = await CustomerBureau.findOne({
      customerId,
    });
    if (bureauData) {
      ((bureauData.bureauCredentials = bureauCredentials),
        await bureauData.save());
      return res.status(200).json({
        success: true,
        message: "Bureau Data updated Successfully.",
        data: bureauData,
      });
    }
    bureauData = await CustomerBureau.create({
      customerId,
      bureauCredentials,
    });
    res.status(201).json({
      success: true,
      message: "Bureau Data saved Successfully.",
      data: bureauData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed To Save Bureau Data",
      error: error.message,
    });
  }
};

module.exports = { saveBureauData };
