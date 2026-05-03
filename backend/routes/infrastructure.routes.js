import express from "express";
import mongoose from "mongoose";
import Infrastructure from "../models/Infrastructure.js";
import Domain from "../models/Domain.js";
import { verifyDomainAccess } from "../middleware/domainAccess.middleware.js";
import { createLogger } from "../utils/logger.util.js";

const router = express.Router();
const logger = createLogger("Infrastructure");

const isSameTenant = (a, b) => String(a) === String(b);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const apiError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

// PUT /api/infrastructure/:domainId - Update or create infrastructure allocation
router.put("/:domainId", verifyDomainAccess({ targetDomainParam: "domainId" }), async (req, res) => {
  const { domainId } = req.params;
  const {
    storageQuota,
    computeLimit,
    specialAccessFlags,
    allocationStatus,
    metadata,
  } = req.body;

  logger.info("Update infrastructure request received", {
    userId: req.user?.adminId,
    role: req.user?.role,
    domainId,
  });

  try {
    // Validate domainId format
    if (!isValidObjectId(domainId)) {
      throw apiError(400, "Invalid domainId format");
    }

    // Fetch domain to verify existence and tenantId
    const domain = await Domain.findById(domainId).select("tenantId");
    if (!domain) {
      throw apiError(404, "Domain not found");
    }

    // Verify tenant ownership
    if (!isSameTenant(domain.tenantId, req.user.tenantId)) {
      throw apiError(403, "Forbidden - domain belongs to another tenant");
    }

    // Build update payload
    const updatePayload = {};

    if (storageQuota) {
      if (typeof storageQuota.totalGB === "number" && storageQuota.totalGB > 0) {
        updatePayload["storageQuota.totalGB"] = storageQuota.totalGB;
      }
    }

    if (computeLimit) {
      if (typeof computeLimit.cpuCores === "number" && computeLimit.cpuCores > 0) {
        updatePayload["computeLimit.cpuCores"] = computeLimit.cpuCores;
      }
      if (typeof computeLimit.memoryGB === "number" && computeLimit.memoryGB > 0) {
        updatePayload["computeLimit.memoryGB"] = computeLimit.memoryGB;
      }
      if (typeof computeLimit.maxConcurrentJobs === "number" && computeLimit.maxConcurrentJobs > 0) {
        updatePayload["computeLimit.maxConcurrentJobs"] = computeLimit.maxConcurrentJobs;
      }
    }

    if (specialAccessFlags) {
      if (typeof specialAccessFlags.labSystemAccess === "boolean") {
        updatePayload["specialAccessFlags.labSystemAccess"] = specialAccessFlags.labSystemAccess;
      }
      if (typeof specialAccessFlags.biometricAccess === "boolean") {
        updatePayload["specialAccessFlags.biometricAccess"] = specialAccessFlags.biometricAccess;
      }
      if (typeof specialAccessFlags.faceRecognitionAccess === "boolean") {
        updatePayload["specialAccessFlags.faceRecognitionAccess"] = specialAccessFlags.faceRecognitionAccess;
      }
      if (typeof specialAccessFlags.deviceIdentityVerification === "boolean") {
        updatePayload["specialAccessFlags.deviceIdentityVerification"] = specialAccessFlags.deviceIdentityVerification;
      }
      if (typeof specialAccessFlags.advancedLabAccess === "boolean") {
        updatePayload["specialAccessFlags.advancedLabAccess"] = specialAccessFlags.advancedLabAccess;
      }
      if (Array.isArray(specialAccessFlags.customFlags)) {
        updatePayload["specialAccessFlags.customFlags"] = specialAccessFlags.customFlags;
      }
    }

    if (typeof allocationStatus === "string" && ["ACTIVE", "INACTIVE", "SUSPENDED"].includes(allocationStatus)) {
      updatePayload.allocationStatus = allocationStatus;
    }

    if (metadata) {
      if (typeof metadata.allocationReason === "string") {
        updatePayload["metadata.allocationReason"] = metadata.allocationReason;
      }
      if (typeof metadata.notes === "string") {
        updatePayload["metadata.notes"] = metadata.notes;
      }
    }

    // Add audit metadata
    updatePayload["metadata.allocatedBy"] = req.user.adminId;

    if (!Object.keys(updatePayload).length) {
      throw apiError(400, "No valid fields were provided for update");
    }

    // Find existing or create new infrastructure config
    let infrastructure = await Infrastructure.findOne({
      tenantId: domain.tenantId,
      domainId: new mongoose.Types.ObjectId(domainId),
    });

    if (!infrastructure) {
      // Create new document with defaults
      infrastructure = await Infrastructure.create({
        tenantId: domain.tenantId,
        domainId: new mongoose.Types.ObjectId(domainId),
        ...Object.keys(updatePayload).reduce((acc, key) => {
          if (!key.includes(".")) {
            acc[key] = updatePayload[key];
          }
          return acc;
        }, {}),
      });

      // Apply nested updates
      Object.entries(updatePayload).forEach(([key, value]) => {
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          if (!infrastructure[parent]) infrastructure[parent] = {};
          infrastructure[parent][child] = value;
        }
      });

      await infrastructure.save();
    } else {
      // Update existing document
      Object.entries(updatePayload).forEach(([key, value]) => {
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          if (!infrastructure[parent]) infrastructure[parent] = {};
          infrastructure[parent][child] = value;
        } else {
          infrastructure[key] = value;
        }
      });

      await infrastructure.save();
    }

    logger.info("Infrastructure updated successfully", {
      domainId,
      tenantId: domain.tenantId,
    });

    res.status(200).json({
      success: true,
      data: infrastructure,
    });
  } catch (error) {
    logger.error("Update infrastructure failed", {
      domainId,
      error: error.message,
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/infrastructure/:tenantId - Get all infrastructure allocations for a tenant
router.get("/:tenantId", verifyDomainAccess({ targetTenantParam: "tenantId" }), async (req, res) => {
  const { tenantId } = req.params;

  logger.info("Fetch infrastructure request received", {
    userId: req.user?.adminId,
    role: req.user?.role,
    tenantId,
  });

  try {
    // Validate tenantId format
    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId format",
      });
    }

    // Verify tenant ownership
    if (!isSameTenant(tenantId, req.user.tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden - tenant mismatch",
      });
    }

    // Fetch all infrastructure allocations for the tenant
    const infrastructures = await Infrastructure.find({
      tenantId: new mongoose.Types.ObjectId(tenantId),
    })
      .populate("domainId", "domainName")
      .sort({ createdAt: -1 });

    logger.info("Infrastructure fetched successfully", {
      tenantId,
      count: infrastructures.length,
    });

    res.status(200).json({
      success: true,
      data: infrastructures,
    });
  } catch (error) {
    logger.error("Fetch infrastructure failed", {
      tenantId,
      error: error.message,
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;