const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");
const attachments = require("../middleware/supportUpload");

const {
  createTicket,
  getMyTickets,
  getTicket,
  replyToTicket,
  getAllTickets,
  updateTicketStatus,
  updateTicketMeta,
  getSupportUnreadCount,
  markTicketRead,
} = require("../controllers/suppoticketController");

// Franchise routes
//@route POST /api/support/create-ticket
router.post("/support/create-ticket", auth, attachments, createTicket);

//@route GET /api/support/my-tickets
router.get("/support/my-tickets", auth, getMyTickets);

//@route GET /api/support/tickets/:id (owner only)
router.get("/support/tickets/:id", auth, getTicket);

//@route POST /api/support/tickets/:id/reply (owner only)
router.post("/support/tickets/:id/reply", auth, attachments, replyToTicket);

// Admin routes
//@route GET /api/admin/support/all-tickets?status&category&priority&search&page&limit
router.get("/admin/support/all-tickets", auth, rbac("admin"), getAllTickets);

//@route GET /api/admin/support/unread-count  (new tickets/replies not yet opened by an admin)
router.get("/admin/support/unread-count", auth, rbac("admin"), getSupportUnreadCount);

//@route GET /api/admin/support/tickets/:id
router.get("/admin/support/tickets/:id", auth, rbac("admin"), getTicket);

//@route PATCH /api/admin/support/tickets/:id/read
router.patch("/admin/support/tickets/:id/read", auth, rbac("admin"), markTicketRead);

//@route POST /api/admin/support/tickets/:id/reply
router.post(
  "/admin/support/tickets/:id/reply",
  auth,
  rbac("admin"),
  attachments,
  replyToTicket,
);

//@route PATCH /api/admin/support/tickets/:id/status
router.patch(
  "/admin/support/tickets/:id/status",
  auth,
  rbac("admin"),
  updateTicketStatus,
);

//@route PATCH /api/admin/support/tickets/:id/meta  (priority, assignment)
router.patch(
  "/admin/support/tickets/:id/meta",
  auth,
  rbac("admin"),
  updateTicketMeta,
);

module.exports = router;
