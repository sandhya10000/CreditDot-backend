const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const rbac = require("../middleware/rbac");

const {
  createTicket,
  getMyTickets,
  getAllTickets,
  updateTicketStatus,
} = require("../controllers/suppoticketController");

//@route /api/support/create-ticket
//this api is used to post api for customer support
router.post("/support/create-ticket", auth, createTicket);

//GET /api/my-tickets
router.get("/support/my-tickets", auth, getMyTickets);

//admin routes get all ticket
//@route api/admin/support/all-tickets
// Admin only
router.get("/admin/support/all-tickets", auth, rbac("admin"), getAllTickets);
router.patch(
  "/admin/support/tickets/:id/status",
  auth,
  rbac("admin"),
  updateTicketStatus,
);

module.exports = router;
