/**
 * Helper module for managing package-based AI report limits.
 *
 * Limits by Package:
 * - Silver: 10
 * - Gold: 50
 * - Platinum: 300
 * - Diamond: Unlimited
 *
 * Safely parses creditsIncluded when it's numeric or 'Unlimited'.
 */

const PACKAGE_LIMIT_FALLBACKS = {
  Silver: 10,
  Gold: 50,
  Platinum: 300,
  Diamond: "Unlimited",
};

/**
 * Normalizes a creditsIncluded value into { limit: number | null, isUnlimited: boolean }
 * @param {any} creditsIncluded
 * @param {string} [packageName]
 */
function parsePackageLimit(creditsIncluded, packageName = "") {
  if (
    creditsIncluded === "Unlimited" ||
    (typeof creditsIncluded === "string" &&
      creditsIncluded.trim().toLowerCase() === "unlimited") ||
    packageName === "Diamond"
  ) {
    return { limit: null, isUnlimited: true };
  }

  if (
    creditsIncluded !== null &&
    creditsIncluded !== undefined &&
    creditsIncluded !== ""
  ) {
    const num = Number(creditsIncluded);
    if (!Number.isNaN(num) && num >= 0) {
      return { limit: num, isUnlimited: false };
    }
  }

  if (packageName && PACKAGE_LIMIT_FALLBACKS[packageName] !== undefined) {
    const fallback = PACKAGE_LIMIT_FALLBACKS[packageName];
    if (fallback === "Unlimited") {
      return { limit: null, isUnlimited: true };
    }
    return { limit: fallback, isUnlimited: false };
  }

  // Default fallback if unspecified
  return { limit: 10, isUnlimited: false };
}

/**
 * Resolves the active package and limits for a franchise document.
 * @param {object} franchise Franchise document populated with assignedPackages
 * @returns {{
 *   hasActivePackage: boolean,
 *   activePackage: object|null,
 *   packageName: string,
 *   used: number,
 *   limit: number|null,
 *   isUnlimited: boolean,
 *   remaining: number|null
 * }}
 */
function resolveFranchiseAiLimit(franchise) {
  const used =
    typeof franchise.aiReportsUsed === "number"
      ? franchise.aiReportsUsed
      : typeof franchise.aiUsed === "number"
      ? franchise.aiUsed
      : 0;

  const assigned = Array.isArray(franchise.assignedPackages)
    ? franchise.assignedPackages.filter(Boolean)
    : [];

  // Filter for active packages if isActive flag is present, or assume true
  const activePackages = assigned.filter((pkg) => pkg.isActive !== false);

  if (activePackages.length === 0) {
    return {
      hasActivePackage: false,
      activePackage: null,
      packageName: null,
      used,
      limit: 0,
      isUnlimited: false,
      remaining: 0,
    };
  }

  // If multiple packages, pick the one with highest tier/limit
  // Check if any is Diamond/Unlimited first
  const diamondPkg = activePackages.find(
    (p) =>
      p.name === "Diamond" ||
      p.creditsIncluded === "Unlimited" ||
      (typeof p.creditsIncluded === "string" &&
        p.creditsIncluded.toLowerCase() === "unlimited"),
  );

  if (diamondPkg) {
    return {
      hasActivePackage: true,
      activePackage: diamondPkg,
      packageName: diamondPkg.name || "Diamond",
      used,
      limit: null,
      isUnlimited: true,
      remaining: null,
    };
  }

  // Find package with highest numeric limit
  let bestPkg = activePackages[0];
  let bestParsed = parsePackageLimit(bestPkg.creditsIncluded, bestPkg.name);

  for (let i = 1; i < activePackages.length; i++) {
    const pkg = activePackages[i];
    const parsed = parsePackageLimit(pkg.creditsIncluded, pkg.name);
    if (parsed.isUnlimited) {
      bestPkg = pkg;
      bestParsed = parsed;
      break;
    }
    if ((parsed.limit || 0) > (bestParsed.limit || 0)) {
      bestPkg = pkg;
      bestParsed = parsed;
    }
  }

  const limit = bestParsed.limit;
  const remaining = Math.max(0, limit - used);

  return {
    hasActivePackage: true,
    activePackage: bestPkg,
    packageName: bestPkg.name,
    used,
    limit,
    isUnlimited: false,
    remaining,
  };
}

module.exports = {
  parsePackageLimit,
  resolveFranchiseAiLimit,
  PACKAGE_LIMIT_FALLBACKS,
};
