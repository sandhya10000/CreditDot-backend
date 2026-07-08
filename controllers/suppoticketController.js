const SupportTicket = require("../models/SupportTicket");

const createTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.create({
      userId: req.user._id,
      subject: req.body.subject,
      category: req.body.category,
      message: req.body.message,
    });

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: ticket,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({
      userId: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: tickets,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const getAllTickets = async (req, res) => {
  const tickets = await SupportTicket.find()
    .populate("user", "name email")
    .sort({ createdAt: -1 });
  res.json({ data: tickets });
};

const updateTicketStatus = async (req, res) => {
  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true },
  );
  res.json({ data: ticket });
};

module.exports = {
  createTicket,
  getMyTickets,
  getAllTickets,
  updateTicketStatus,
};
