// Use after rbac("admin"). Only full admins (no staffRole) may pass.
// Stops staff from granting themselves roles or creating other staff.
const requireFullAdmin = (req, res, next) => {
  if (req.user?.staffRole) {
    return res
      .status(403)
      .json({ message: "Only full administrators can manage roles and staff" });
  }
  next();
};

module.exports = requireFullAdmin;
