const { permissionForRoute, SCOPABLE_KEYS } = require("../config/permissions");

const rbac = (...roles) => {
  return (req, res, next) => {
    console.log("RBAC middleware hit, required roles:", roles);
    if (!req.user) {
      console.log("No authenticated user found, authentication required");
      return res.status(401).json({ message: "Authentication required" });
    }
    console.log("RBAC FILE:", __filename);
    console.log(
      "Checking permissions for user role:A",
      req.user.role,
      "Required roles:",
      roles,
    );

    if (!roles.includes(req.user.role)) {
      console.log(
        "Access forbidden: user role",
        req.user.role,
        "does not match required roles:",
        roles,
      );
      return (
        res
          .status(403)
          // .json({ message: "Access forbidden: insufficient permissions" });
          .json({ message: JSON.stringify(roles) })
      );
    }

    // Staff accounts are limited to the sections granted by their role.
    // Full admins (no staffRole) are not checked here.
    if (req.user.role === "admin" && req.user.staffRole) {
      const section = permissionForRoute(req.baseUrl + req.path);
      if (!section || !(req.user.permissions || []).includes(section)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this section" });
      }
      // Business Managers may only use sections that are scoped to their franchises
      if (req.user.scopedToOwnFranchises && !SCOPABLE_KEYS.includes(section)) {
        return res
          .status(403)
          .json({ message: "This section is not available to Business Managers" });
      }
    }

    console.log("User has required permissions, proceeding to next middleware");
    next();
  };
};

module.exports = rbac;
