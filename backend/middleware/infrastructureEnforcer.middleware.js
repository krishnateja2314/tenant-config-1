import Infrastructure from "../models/Infrastructure.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger("InfrastructureEnforcer");

/**
 * Infrastructure Enforcement Middleware
 *
 * Validates that a request does not exceed the infrastructure limits
 * configured for the target domain. Downstream services (resource booking,
 * storage modules, etc.) attach this middleware to protected routes so that
 * every operation is checked against the tenant-admin-defined quotas.
 *
 * Expected request context (set by upstream auth middleware):
 *   req.user.tenantId   – the tenant making the request
 *   req.user.domainId   – the domain the request targets
 *
 * On success, attaches req.infraPolicy with the resolved config so
 * downstream handlers can reference the limits without a second DB call.
 */
export const infrastructureEnforcer = async (req, res, next) => {
  try {
    const { tenantId, domainId } = req.user || {};

    if (!tenantId || !domainId) {
      logger.warn("Missing tenant or domain context", {
        hasTenantId: !!tenantId,
        hasDomainId: !!domainId,
      });
      return res.status(400).json({
        error: "INVALID_CONTEXT",
        message: "Missing tenantId or domainId in user context",
      });
    }

    // Step 1: Look up the infrastructure allocation for this domain
    const infra = await Infrastructure.findOne({ tenantId, domainId });

    if (!infra) {
      logger.warn("No infrastructure config for domain", {
        tenantId: String(tenantId),
        domainId: String(domainId),
      });
      return res.status(403).json({
        error: "NO_INFRA_CONFIG",
        message:
          "No infrastructure allocation found for this domain. Contact your tenant administrator.",
      });
    }

    // Step 2: Check allocation status
    if (infra.allocationStatus !== "ACTIVE") {
      logger.warn("Infrastructure allocation not active", {
        domainId: String(domainId),
        status: infra.allocationStatus,
      });
      return res.status(403).json({
        error: "INFRA_INACTIVE",
        message: `Infrastructure allocation is ${infra.allocationStatus}. Access denied.`,
        allocationStatus: infra.allocationStatus,
      });
    }

    // Step 3: Enforce storage quota
    if (infra.storageQuota.usedGB >= infra.storageQuota.totalGB) {
      logger.warn("Storage quota exceeded", {
        domainId: String(domainId),
        used: infra.storageQuota.usedGB,
        total: infra.storageQuota.totalGB,
      });
      return res.status(403).json({
        error: "STORAGE_QUOTA_EXCEEDED",
        message: `Storage quota exhausted: ${infra.storageQuota.usedGB}/${infra.storageQuota.totalGB} GB used.`,
        currentUsage: infra.storageQuota.usedGB,
        quota: infra.storageQuota.totalGB,
      });
    }

    // Step 4: Enforce special access flags when the request requires lab access
    const requiredAccess = req.headers["x-required-access"];
    if (requiredAccess) {
      const flagMap = {
        lab: "labSystemAccess",
        biometric: "biometricAccess",
        faceRecognition: "faceRecognitionAccess",
        deviceIdentity: "deviceIdentityVerification",
        advancedLab: "advancedLabAccess",
      };

      const flag = flagMap[requiredAccess];
      if (flag && !infra.specialAccessFlags[flag]) {
        logger.warn("Access flag not granted", {
          domainId: String(domainId),
          requiredAccess,
          flag,
        });
        return res.status(403).json({
          error: "ACCESS_DENIED",
          message: `Domain does not have '${requiredAccess}' access enabled.`,
          requiredAccess,
        });
      }
    }

    // Attach resolved infra config to the request for downstream use
    req.infraPolicy = {
      infraId: infra._id.toString(),
      storageQuota: infra.storageQuota,
      computeLimit: infra.computeLimit,
      specialAccessFlags: infra.specialAccessFlags,
      allocationStatus: infra.allocationStatus,
    };

    logger.info("Infrastructure check passed", {
      domainId: String(domainId),
      storageUsed: `${infra.storageQuota.usedGB}/${infra.storageQuota.totalGB} GB`,
    });

    next();
  } catch (error) {
    logger.error("Infrastructure enforcer error", {
      error: error.message,
      path: req.path,
    });

    res.status(500).json({
      error: "ENFORCEMENT_ERROR",
      message: "Infrastructure policy enforcement failed",
    });
  }
};

/**
 * Middleware factory that conditionally enforces infrastructure policies
 * only on paths that need it (e.g., resource-booking, storage-upload).
 */
export const shouldEnforceInfrastructure = (restrictedPaths = []) => {
  return (req, res, next) => {
    const pathRequiresEnforcement = restrictedPaths.some((path) =>
      req.path.startsWith(path),
    );

    if (!pathRequiresEnforcement) {
      return next();
    }

    infrastructureEnforcer(req, res, next);
  };
};
