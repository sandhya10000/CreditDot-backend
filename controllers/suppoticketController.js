const mongoose = require("mongoose");
const SupportTicket = require("../models/SupportTicket");
const TicketReply = require("../models/TicketReply");
const {
  sendSupportTicketCreatedEmail,
  sendSupportTicketReplyEmail,
  sendSupportTicketStatusEmail,
} = require("../utils/emailService");

const { STATUSES, PRIORITIES } = SupportTicket;
const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || "support@creditdost.co.in";

// Email failures must never fail the API call that triggered them
const notify = (promise) =>
  promise.catch((err) => console.error("Support ticket email failed:", err));

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isAdmin = (req) => req.user.role === "admin";

const toAttachments = (files = []) =>
  files.map((f) => ({
    url: `/uploads/support-tickets/${f.filename}`,
    originalName: f.originalname,
    mimeType: f.mimetype,
    size: f.size,
  }));

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (res, err) => {
  const status = err.name === "ValidationError" ? 400 : 500;
  return fail(res, status, err.message);
};

// Franchise users may only see their own tickets; a missing ticket and a
// foreign ticket both return 404 so ids cannot be probed.
const findAccessibleTicket = async (req, id) => {
  const query = SupportTicket.findById(id).populate("user", "name email");
  const ticket = await query;
  if (!ticket) return null;
  if (!isAdmin(req) && String(ticket.user?._id) !== String(req.user._id)) {
    return null;
  }
  return ticket;
};

const createTicket = async (req, res) => {
  try {
    const count = await SupportTicket.countDocuments();
    const ticketNumber = `TKT-${String(count + 1).padStart(6, "0")}`;

    const ticket = await SupportTicket.create({
      ticketNumber,
      user: req.user._id,
      franchiseId: req.user.franchiseId,
      subject: req.body.subject,
      category: req.body.category,
      message: req.body.message,
      attachments: toAttachments(req.files),
    });

    notify(sendSupportTicketCreatedEmail(ticket, req.user));

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: ticket,
    });
  } catch (err) {
    handleError(res, err);
  }
};

const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({
      user: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: tickets,
    });
  } catch (err) {
    handleError(res, err);
  }
};

const getTicket = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid ticket id");

    const ticket = await findAccessibleTicket(req, req.params.id);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const replies = await TicketReply.find({ ticket: ticket._id })
      .populate("author", "name")
      .sort({ createdAt: 1 });

    res.json({ success: true, data: { ticket, replies } });
  } catch (err) {
    handleError(res, err);
  }
};

const replyToTicket = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid ticket id");

    const ticket = await findAccessibleTicket(req, req.params.id);
    if (!ticket) return fail(res, 404, "Ticket not found");

    const admin = isAdmin(req);
    if (!admin && ticket.status === "Closed") {
      return fail(res, 400, "This ticket is closed and cannot receive replies");
    }

    const reply = await TicketReply.create({
      ticket: ticket._id,
      author: req.user._id,
      authorRole: admin ? "admin" : "franchise_user",
      message: req.body.message,
      attachments: toAttachments(req.files),
    });

    // Franchise replies reopen a resolved ticket; admin replies mark it in progress
    if (!admin && ticket.status === "Resolved") ticket.status = "Pending";
    if (admin && ticket.status === "Pending") ticket.status = "In Progress";
    ticket.lastActivityAt = new Date();
    await ticket.save();

    if (admin) {
      if (ticket.user?.email) {
        notify(sendSupportTicketReplyEmail(ticket, ticket.user.email, reply, "admin"));
      }
    } else {
      notify(sendSupportTicketReplyEmail(ticket, SUPPORT_INBOX, reply, "franchise_user"));
    }

    res.status(201).json({
      success: true,
      message: "Reply added",
      data: await reply.populate("author", "name"),
    });
  } catch (err) {
    handleError(res, err);
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAllTickets = async (req, res) => {
  try {
    const { status, category, priority, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const filter = {};
    if (STATUSES.includes(status)) filter.status = status;
    if (SupportTicket.CATEGORIES.includes(category)) filter.category = category;
    if (PRIORITIES.includes(priority)) filter.priority = priority;
    if (search && search.trim()) {
      const pattern = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ subject: pattern }, { ticketNumber: pattern }];
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("user", "name email")
        .populate("assignedTo", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SupportTicket.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
};

const updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!STATUSES.includes(status)) {
      return fail(res, 400, `Status must be one of: ${STATUSES.join(", ")}`);
    }
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid ticket id");

    const ticket = await SupportTicket.findById(req.params.id).populate(
      "user",
      "name email",
    );
    if (!ticket) return fail(res, 404, "Ticket not found");

    const changed = ticket.status !== status;
    ticket.status = status;
    ticket.lastActivityAt = new Date();
    await ticket.save();

    if (changed && ticket.user?.email) {
      notify(sendSupportTicketStatusEmail(ticket, ticket.user, status));
    }

    res.json({
      success: true,
      message: "Ticket status updated",
      data: ticket,
    });
  } catch (err) {
    handleError(res, err);
  }
};

// Admin-only: change priority and assign/unassign the ticket to the acting admin
const updateTicketMeta = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid ticket id");

    const update = {};
    if (req.body.priority !== undefined) {
      if (!PRIORITIES.includes(req.body.priority)) {
        return fail(res, 400, `Priority must be one of: ${PRIORITIES.join(", ")}`);
      }
      update.priority = req.body.priority;
    }
    if (req.body.assignment === "me") update.assignedTo = req.user._id;
    if (req.body.assignment === "none") update.assignedTo = null;

    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true },
    )
      .populate("user", "name email")
      .populate("assignedTo", "name");

    if (!ticket) return fail(res, 404, "Ticket not found");

    res.json({ success: true, message: "Ticket updated", data: ticket });
  } catch (err) {
    handleError(res, err);
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicket,
  replyToTicket,
  getAllTickets,
  updateTicketStatus,
  updateTicketMeta,
};
