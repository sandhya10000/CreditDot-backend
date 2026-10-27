// Admin sections that a staff role can be granted.
// This is the single source of truth for the backend and for the Roles page.
// To add a section: add it to PERMISSIONS, then add a path rule to ROUTE_RULES.
const PERMISSIONS = [
  { key: "dashboard", label: "Dashboard & Reports" },
  { key: "franchises", label: "Franchises" },
  { key: "packages", label: "Packages" },
  { key: "leads", label: "Leads & Website Enquiries" },
  { key: "finance", label: "Payouts, Transactions & Recharge" },
  { key: "credit", label: "Credit Reports & Credit Check" },
  { key: "kyc", label: "KYC" },
  { key: "business", label: "Business Forms & AMC" },
  { key: "ai_analysis", label: "AI Analysis" },
  { key: "support_tickets", label: "Support Tickets" },
  { key: "blogs", label: "Blogs" },
  { key: "relationship_managers", label: "Relationship Managers" },
  { key: "google_sheets", label: "Google Sheets" },
  { key: "users", label: "Users" },
  { key: "marketing", label: "Marketing Materials, Case Studies & Rewards" },
  { key: "settings", label: "Settings & API Keys" },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Sections a Business Manager role may hold. Their data is limited to franchises
// they own, so sections without a franchise link (settings, users) are excluded.
const SCOPABLE_KEYS = [
  "dashboard",
  "franchises",
  "packages",
  "leads",
  "finance",
  "credit",
  "kyc",
  "business",
  "ai_analysis",
  "support_tickets",
];

// First matching rule wins. Matched against req.baseUrl + req.path,
// e.g. "/api/admin/leads/12". Any path with no rule is denied to staff.
const ROUTE_RULES = [
  [/^\/api\/admin\/(marketing|case-studies|reward)/, "marketing"],
  [/^\/api\/admin\/dashboard/, "dashboard"],
  [/^\/api\/admin\/download-stats/, "dashboard"],
  [/^\/api\/(dashboard|analytics)/, "dashboard"],
  [/^\/api\/admin\/users/, "users"],
  [/^\/api\/admin\/(leads|franchise-leads|credit-repair)/, "leads"],
  [/^\/api\/leads/, "leads"],
  [/^\/api\/admin\/(transactions|payouts|credits|manual-payments)/, "finance"],
  [/^\/api\/admin\/credit-reports/, "credit"],
  [/^\/api\/credit\/(reports\/all|credit-check-v2)/, "credit"],
  [/^\/api\/credit\/settings/, "settings"],
  [/^\/api\/admin\/settings/, "settings"],
  [/^\/api\/credit\/(check|reports|customer-report|generate-experian-report)/, "credit"],
  [/^\/api\/admin\/franchises\/(credits|recharge)/, "finance"],
  // Franchise name picker used by the Business form (not the Franchises pages)
  [/^\/api\/franchises\/admin\/allFranchises-Namelist/, "business"],
  [/^\/api\/admin\/franchises|^\/api\/franchises/, "franchises"],
  [/^\/api\/kyc/, "kyc"],
  // Read-only package list used when creating franchises; needs Franchises, not Packages
  [/^\/api\/packages\/options/, "franchises"],
  [/^\/api\/(customer-)?packages/, "packages"],
  [/^\/api\/admin\/business|^\/api\/(all|amc)(\/|$)|^\/api\/business/, "business"],
  [/^\/api\/franchise\/(?!reward)/, "business"],
  [/^\/api\/digital-agreements/, "business"],
  [/^\/api\/ai-analysis/, "ai_analysis"],
  [/^\/api\/admin\/support/, "support_tickets"],
  [/^\/api\/blogs/, "blogs"],
  [/^\/api\/relationship-managers/, "relationship_managers"],
  [/^\/api\/google-sheets/, "google_sheets"],
];

const permissionForRoute = (fullPath) => {
  const rule = ROUTE_RULES.find(([pattern]) => pattern.test(fullPath));
  return rule ? rule[1] : null;
};

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  SCOPABLE_KEYS,
  ROUTE_RULES,
  permissionForRoute,
};
