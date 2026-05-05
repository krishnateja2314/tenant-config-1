import express from "express";
import mongoose from "mongoose";
import AttendanceEvent from "../models/AttendanceEvent.js";
import AttendanceSession from "../models/AttendanceSession.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import {
  getAttendancePercentage,
  syncAbsentRecordsForUser,
} from "../utils/attendance.util.js";
import jwt from "jsonwebtoken";
import { createLogger } from "../utils/logger.util.js";

const router = express.Router();
const logger = createLogger("MarkAttendanceRoutes");

const verifyUserToken = (req, res, next) => {
  let token = req.cookies?.user_token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized: Missing user token" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid user token" });
  }
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

router.post("/:eventId/mark", verifyUserToken, async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.userId;

  logger.info("Mark attendance request", { eventId, userId });

  try {

    if (!isValidObjectId(eventId) || !isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid eventId or userId",
      });
    }

    const event = await AttendanceEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (event.domainId && String(user.domainId) !== String(event.domainId)) {
      return res.status(403).json({
        success: false,
        message: "You are not part of the domain required for this event.",
      });
    }

    const now = new Date();

    const session = await AttendanceSession.findOne({
      eventId,
      tenantId: event.tenantId,
      endAt: { $gte: now },
    }).sort({ startAt: 1 });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "No session found for today",
      });
    }

    const timeStart = new Date(session.startAt);
    const timeEnd = new Date(session.endAt);

    if (now < timeStart || now > timeEnd) {
      return res.status(400).json({
        success: false,
        message: "Cannot mark attendance outside of session time window",
        currentTime: now.toISOString(),
        sessionWindow: {
          start: timeStart.toISOString(),
          end: timeEnd.toISOString(),
        },
      });
    }

    const existingRecord = await AttendanceRecord.findOne({
      eventId,
      sessionId: session._id,
      userId,
      status: "PRESENT",
    });

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: "Attendance already marked for this session",
      });
    }

    await syncAbsentRecordsForUser(
      eventId,
      userId,
      event.tenantId,
      event.domainId,
    );

    const record = await AttendanceRecord.findOneAndUpdate(
      {
        eventId,
        sessionId: session._id,
        userId,
      },
      {
        eventId,
        sessionId: session._id,
        tenantId: event.tenantId,
        domainId: event.domainId,
        userId,
        status: "PRESENT",
        markedAt: new Date(),
        source: "MANUAL",
      },
      { upsert: true, new: true },
    );

    const stats = await getAttendancePercentage(eventId, userId);

    await AuditLog.create({
      tenantId: event.tenantId,
      domainId: event.domainId,
      userId: userId,
      eventId: eventId,
      action: "ATTENDANCE_MARKED",
      details: {
        sessionId: session._id,
        markedAt: record.markedAt,
        status: record.status,
      },
      timestamp: new Date(),
    });

    logger.info("Attendance marked successfully", {
      eventId,
      userId,
      status: "PRESENT",
    });

    res.json({
      success: true,
      message: "Attendance marked",
      data: {
        eventId,
        userId,
        sessionId: session._id,
        status: "PRESENT",
        markedAt: record.markedAt,
        attendanceStats: stats,
      },
    });
  } catch (error) {
    logger.error("Mark attendance failed", {
      eventId,
      userId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to mark attendance",
    });
  }
});

router.get("/:eventId/check-window", async (req, res) => {
  const { eventId } = req.params;

  try {
    // Always use user token if present to find the verified user ID
    let verifiedUserId = null;
    let token = req.cookies?.user_token;
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        verifiedUserId = decoded.userId;
      } catch (e) {
        // invalid token, ignore
      }
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid eventId",
      });
    }

    const event = await AttendanceEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const now = new Date();
    const session = await AttendanceSession.findOne({
      eventId,
      tenantId: event.tenantId,
      endAt: { $gte: now },
    }).sort({ startAt: 1 });

    if (!session) {
      return res.json({
        success: true,
        data: {
          tenantId: event.tenantId,
          isWithinWindow: false,
          minutesRemaining: 0,
          message: "No session found",
        },
      });
    }

    const timeStart = new Date(session.startAt);
    const timeEnd = new Date(session.endAt);
    const isWithinWindow = now >= timeStart && now <= timeEnd;
    const minutesRemaining = Math.max(
      0,
      Math.floor((timeEnd.getTime() - now.getTime()) / 60000),
    );

    let hasMarked = false;
    if (verifiedUserId && isValidObjectId(verifiedUserId)) {
      const existingRecord = await AttendanceRecord.findOne({
        eventId,
        sessionId: session._id,
        userId: verifiedUserId,
        status: "PRESENT",
      });
      hasMarked = !!existingRecord;
    }

    res.json({
      success: true,
      data: {
        tenantId: event.tenantId,
        isWithinWindow,
        minutesRemaining,
        sessionStart: timeStart.toISOString(),
        sessionEnd: timeEnd.toISOString(),
        hasMarked,
      },
    });
  } catch (error) {
    logger.error("Check window failed", {
      eventId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to check time window",
    });
  }
});

router.get("/:eventId/:userId/verify", async (req, res) => {
  const { eventId, userId } = req.params;
  const { tenantId } = req.query;

  logger.info("Verify attendance request", { eventId, userId, tenantId });

  try {
    if (!isValidObjectId(eventId) || !isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid eventId or userId",
      });
    }

    const event = await AttendanceEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (tenantId && String(event.tenantId) !== String(tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Tenant mismatch",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await syncAbsentRecordsForUser(
      eventId,
      userId,
      event.tenantId,
      event.domainId,
    );

    const stats = await getAttendancePercentage(eventId, userId);

    res.json({
      success: true,
      message: "Attendance verified",
      data: {
        eventId,
        userId,
        userEmail: user.email,
        attendanceStats: stats,
        verifiedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Verify attendance failed", {
      eventId,
      userId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to verify attendance",
    });
  }
});

export default router;
