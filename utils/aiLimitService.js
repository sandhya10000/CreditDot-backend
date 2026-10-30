/**
 * Helper module for managing package-based AI report limits.
 *
 * PACKAGE LIMITS:
 * - Silver: 10 reports
 * - Gold: 50 reports
 * - Platinum: 300 reports
 * - Diamond: 1000 reports
 */



const AI_REPORT_LIMITS = {
  silver: 10,
  gold: 50,
  platinum: 300,
  diamond: 1000,
};

/**
 * Resolves the fixed report limit for a given package name.
 * Matches package names case-insensitively and trims whitespace.
 * If the package name is not in the map, logs a warning and treats it as 0 limit.
 * @param {string} packageName
 * @returns {number}
 */
function resolvePackageLimit(packageName) {
  if (!packageName || typeof packageName !== "string") {
    console.warn(`[AI-CREDITS] Invalid or missing package name "${packageName}", treating limit as 0`);
    return 0;
  }

  const normalized = packageName.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(AI_REPORT_LIMITS, normalized)) {
    const limit = AI_REPORT_LIMITS[normalized];
    console.log(`[AI-CREDITS] Package "${packageName}" normalized to "${normalized}", resolved limit from map: ${limit}`);
    return limit;
  }

  console.warn(`[AI-CREDITS] Package name "${packageName}" not found in AI_REPORT_LIMITS map. Treating limit as 0.`);
  return 0;
}

/**
 * Resolves the active package, fixed limit, and activation date for a franchise document.
 * @param {object} franchise Franchise document populated with assignedPackages
 * @returns {{
 *   hasActivePackage: boolean,
 *   activePackage: object|null,
 *   packageName: string|null,
 *   limit: number,
 *   activationDate: Date|null
 * }}
 */
function resolveFranchisePackageInfo(franchise) {
  console.log("[AI-CREDITS] resolveFranchisePackageInfo called for franchise:", {
    franchiseId: franchise?._id,
    email: franchise?.email,
    assignedPackagesCount: Array.isArray(franchise?.assignedPackages)
      ? franchise.assignedPackages.length
      : 0,
  });

  const assigned = Array.isArray(franchise?.assignedPackages)
    ? franchise.assignedPackages.filter(Boolean)
    : [];

  const activePackages = assigned.filter((pkg) => pkg.isActive !== false);

  if (activePackages.length === 0) {
    console.log("[AI-CREDITS] No active packages found on franchise => hasActivePackage: false, limit: 0");
    return {
      hasActivePackage: false,
      activePackage: null,
      packageName: null,
      limit: 0,
      activationDate: null,
    };
  }

  // If multiple packages, pick the one with highest limit from AI_REPORT_LIMITS
  let bestPkg = activePackages[0];
  let bestLimit = resolvePackageLimit(bestPkg.name);

  for (let i = 1; i < activePackages.length; i++) {
    const pkg = activePackages[i];
    const lim = resolvePackageLimit(pkg.name);
    if (lim > bestLimit) {
      bestPkg = pkg;
      bestLimit = lim;
    }
  }

  // Look for activation/upgrade date in packageHistory matching this package, or latest entry
  let activationDate = null;
  if (Array.isArray(franchise?.packageHistory) && franchise.packageHistory.length > 0) {
    const bestPkgIdStr = bestPkg._id ? String(bestPkg._id) : null;
    const matchingHistories = franchise.packageHistory.filter((h) => {
      if (!h) return false;
      if (bestPkgIdStr && h.packageId && String(h.packageId) === bestPkgIdStr) return true;
      if (h.packageName && bestPkg.name && h.packageName.trim().toLowerCase() === bestPkg.name.trim().toLowerCase()) return true;
      return false;
    });

    const targetHistory = matchingHistories.length > 0
      ? matchingHistories[matchingHistories.length - 1]
      : franchise.packageHistory[franchise.packageHistory.length - 1];

    if (targetHistory && targetHistory.upgradeDate) {
      const d = new Date(targetHistory.upgradeDate);
      if (!isNaN(d.getTime())) {
        activationDate = d;
      }
    }
  }

  console.log("[AI-CREDITS] Selected active package:", {
    packageName: bestPkg.name,
    limit: bestLimit,
    activationDate: activationDate ? activationDate.toISOString() : null,
  });

  return {
    hasActivePackage: true,
    activePackage: bestPkg,
    packageName: bestPkg.name,
    limit: bestLimit,
    activationDate,
  };
}

/**
 * Builds the MongoDB query filter for counting used AI reports for a franchise.
 * - Always filters by franchise: franchiseId
 * - Counts analyses that were processed (uploaded, processed, responded)
 * - Excludes claudeAnalysisStatus: "failed" so failed runs NEVER burn a credit
 * - If activationDate is present, only counts analyses created after the activation date
 * @param {import('mongoose').Types.ObjectId|string} franchiseId
 * @param {Date|null} activationDate
 * @returns {object}
 */
function buildUsedCountFilter(franchiseId, activationDate = null) {
  const filter = {
    franchise: franchiseId,
    claudeAnalysisStatus: { $ne: "failed" },
  };

  if (activationDate instanceof Date && !isNaN(activationDate.getTime())) {
    filter.createdAt = { $gte: activationDate };
  }

  return filter;
}

/**
 * Legacy compatibility resolver.
 * Kept for any call-sites that invoke resolveFranchiseAiLimit synchronously without a DB count.
 * @param {object} franchise
 */
function resolveFranchiseAiLimit(franchise) {
  const pkgInfo = resolveFranchisePackageInfo(franchise);
  let used =
    typeof franchise.aiReportsUsed === "number"
      ? franchise.aiReportsUsed
      : typeof franchise.aiUsed === "number"
      ? franchise.aiUsed
      : 0;

  const remaining = pkgInfo.hasActivePackage ? Math.max(pkgInfo.limit - used, 0) : 0;

  return {
    hasActivePackage: pkgInfo.hasActivePackage,
    activePackage: pkgInfo.activePackage,
    packageName: pkgInfo.packageName,
    used,
    limit: pkgInfo.limit,
    isUnlimited: false,
    remaining,
  };
}

module.exports = {
  AI_REPORT_LIMITS,
  resolvePackageLimit,
  resolveFranchisePackageInfo,
  buildUsedCountFilter,
  resolveFranchiseAiLimit,
};