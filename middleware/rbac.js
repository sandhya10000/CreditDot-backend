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

    console.log("User has required permissions, proceeding to next middleware");
    next();
  };
};

module.exports = rbac;
