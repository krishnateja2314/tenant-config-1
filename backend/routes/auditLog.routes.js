import express from "express";
import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import { createLogger } from "../utils/logger.util.js";

const router = express.Router();
const logger = createLogger("AuditLog");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const isSameTenant = (left, right) => String(left) === String(right);
const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const getPagination = (limit, skip) => {
  const limitValue = Number.parseInt(String(limit), 10);
  const skipValue = Number.parseInt(String(skip), 10);
  return {
    limit: Number.isNaN(limitValue)
      ? 50
      : Math.max(1, Math.min(limitValue, 500)),
    skip: Number.isNaN(skipValue) ? 0 : Math.max(0, skipValue),
  };
};

const sanitizeStudentId = (studentId) =>
  typeof studentId === "string" && studentId.trim()
    ? studentId.trim()
    : undefined;

const sanitizeDecision = (decision) =>
  typeof decision === "string" && ["ALLOWED", "DENIED"].includes(decision)
    ? decision
    : undefined;

const fetchAuditLogs = async ({
  tenantId,
  domainId,
  studentId,
  decision,
  limit,
  skip,
}) => {
  // Construct query object explicitly with sanitized values
  const query = { tenantId: toObjectId(tenantId) };
  if (domainId) {
    query.domainId = toObjectId(domainId);
  }
  const cleanStudentId = sanitizeStudentId(studentId);
  if (cleanStudentId) {
    query.studentId = cleanStudentId;
  }
  const cleanDecision = sanitizeDecision(decision);
  if (cleanDecision) {
    query.decision = cleanDecision;
  }

  const { limit: sanitizedLimit, skip: sanitizedSkip } = getPagination(
    limit,
    skip,
  );

  const logs = await AuditLog.find(query)
    .sort({ timestamp: -1 })
    .populate("userId", "name email")
    .limit(sanitizedLimit)
    .skip(sanitizedSkip);

  const total = await AuditLog.countDocuments(query);
  return { logs, total, sanitizedLimit, sanitizedSkip };
};

// ── GET AUDIT LOGS FOR TENANT ──────────────────────────────────────────────────
router.get("/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  const { limit = 50, skip = 0, studentId, decision } = req.query;
  const userTenant = req.user?.tenantId;

  logger.info("Fetch audit logs request", {
    tenantId,
    limit,
    skip,
    studentId,
    decision,
  });

  try {
    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId format",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      logger.warn("Forbidden access: Tenant mismatch", {
        tenantId,
        userTenant,
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden - Tenant mismatch",
      });
    }

    const { logs, total, sanitizedLimit, sanitizedSkip } = await fetchAuditLogs(
      {
        tenantId,
        studentId,
        decision,
        limit,
        skip,
      },
    );

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: sanitizedLimit,
        skip: sanitizedSkip,
        hasMore: sanitizedSkip + sanitizedLimit < total,
      },
    });
  } catch (error) {
    logger.error("Fetch audit logs failed", {
      tenantId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs",
      error: error.message,
    });
  }
});

// ── GET AUDIT LOGS FOR STUDENT ────────────────────────────────────────────────
router.get("/:tenantId/student/:studentId", async (req, res) => {
  const { tenantId, studentId } = req.params;
  const { limit = 50, skip = 0 } = req.query;
  const userTenant = req.user?.tenantId;

  logger.info("Fetch student audit logs request", {
    tenantId,
    studentId,
    limit,
    skip,
  });

  try {
    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId format",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      logger.warn("Forbidden access: Tenant mismatch", {
        tenantId,
        userTenant,
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden - Tenant mismatch",
      });
    }

    const { logs, total, sanitizedLimit, sanitizedSkip } = await fetchAuditLogs(
      {
        tenantId,
        studentId,
        limit,
        skip,
      },
    );

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: sanitizedLimit,
        skip: sanitizedSkip,
      },
    });
  } catch (error) {
    logger.error("Fetch student audit logs failed", {
      tenantId,
      studentId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch student audit logs",
      error: error.message,
    });
  }
});

// ── GET AUDIT LOGS FOR DOMAIN ─────────────────────────────────────────────────
router.get("/:tenantId/domain/:domainId", async (req, res) => {
  const { tenantId, domainId } = req.params;
  const { limit = 50, skip = 0, decision } = req.query;
  const userTenant = req.user?.tenantId;

  logger.info("Fetch domain audit logs request", {
    tenantId,
    domainId,
    limit,
    skip,
    decision,
  });

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(domainId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId or domainId format",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      logger.warn("Forbidden access: Tenant mismatch", {
        tenantId,
        userTenant,
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden - Tenant mismatch",
      });
    }

    const { logs, total, sanitizedLimit, sanitizedSkip } = await fetchAuditLogs(
      {
        tenantId,
        domainId,
        decision,
        limit,
        skip,
      },
    );

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: sanitizedLimit,
        skip: sanitizedSkip,
      },
    });
  } catch (error) {
    logger.error("Fetch domain audit logs failed", {
      tenantId,
      domainId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch domain audit logs",
      error: error.message,
    });
  }
});

// ── GET AUDIT LOG STATISTICS ──────────────────────────────────────────────────
router.get("/:tenantId/stats/summary", async (req, res) => {
  const { tenantId } = req.params;
  const userTenant = req.user?.tenantId;

  logger.info("Fetch audit stats request", { tenantId });

  try {
    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId format",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      logger.warn("Forbidden access: Tenant mismatch", {
        tenantId,
        userTenant,
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden - Tenant mismatch",
      });
    }

    const tenantObjectId = toObjectId(tenantId);
    const stats = await AuditLog.aggregate([
      { $match: { tenantId: tenantObjectId } },
      {
        $group: {
          _id: "$decision",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalRequests = await AuditLog.countDocuments({
      tenantId: tenantObjectId,
    });

    const allowed = stats.find((s) => s._id === "ALLOWED")?.count || 0;
    const denied = stats.find((s) => s._id === "DENIED")?.count || 0;

    res.json({
      success: true,
      data: {
        totalRequests,
        allowed,
        denied,
        denialRate:
          totalRequests > 0 ? ((denied / totalRequests) * 100).toFixed(2) : 0,
      },
    });
  } catch (error) {
    logger.error("Fetch audit stats failed", {
      tenantId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch audit statistics",
      error: error.message,
    });
  }
});

export default router;
