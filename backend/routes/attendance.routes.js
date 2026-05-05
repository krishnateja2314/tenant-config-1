import express from "express";
import mongoose from "mongoose";
import AttendanceEvent from "../models/AttendanceEvent.js";
import AttendanceSession from "../models/AttendanceSession.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import User from "../models/User.js";
import { createLogger } from "../utils/logger.util.js";
import {
  parseTimeString,
  buildSessionDateTime,
  buildSession,
  getAttendancePercentage,
  syncAbsentRecordsForUser,
} from "../utils/attendance.util.js";

const router = express.Router();
const logger = createLogger("AttendanceRoutes");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const isSameTenant = (left, right) => String(left) === String(right);

const WEEKDAY_MAP = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export const getISOWeekday = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  return day === 0 ? 7 : day;
};

export const getMonthName = (month) =>
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][month];

export const isDateInRange = (date, startDate, endDate) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
};

router.post("/:tenantId/create-event", async (req, res) => {
  const { tenantId } = req.params;
  const {
    domainId,
    title,
    description,
    eventType,
    scheduledDate,
    startTime,
    endTime,
    recurrenceStartDate,
    recurrenceEndDate,
    recurrenceDays,
  } = req.body;
  const userTenant = req.user?.tenantId;
  const createdBy = req.user?.adminId;

  logger.info("Create attendance event request", {
    tenantId,
    domainId,
    eventType,
  });

  try {
    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Tenant mismatch",
      });
    }

    if (!title || !eventType || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "title, eventType, startTime, endTime are required",
      });
    }

    if (eventType === "ONE_TIME" && !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: "One-time events require scheduledDate",
      });
    }

    if (
      eventType === "RECURRING" &&
      (!recurrenceStartDate ||
        !recurrenceEndDate ||
        !recurrenceDays ||
        recurrenceDays.length === 0)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Recurring events require recurrenceStartDate, recurrenceEndDate, and recurrenceDays",
      });
    }

    const event = await AttendanceEvent.create({
      tenantId,
      domainId: domainId || null,
      title,
      description,
      eventType,
      scheduledDate:
        eventType === "ONE_TIME" ? new Date(scheduledDate) : undefined,
      startTime,
      endTime,
      recurrenceStartDate:
        eventType === "RECURRING" ? new Date(recurrenceStartDate) : undefined,
      recurrenceEndDate:
        eventType === "RECURRING" ? new Date(recurrenceEndDate) : undefined,
      recurrenceDays: eventType === "RECURRING" ? recurrenceDays : undefined,
      createdBy,
    });

    if (eventType === "ONE_TIME") {
      const session = buildSession({
        eventId: event._id,
        tenantId,
        domainId: domainId || null,
        date: scheduledDate,
        startTime,
        endTime,
      });

      await AttendanceSession.create(session);
    } else if (eventType === "RECURRING") {
      const start = new Date(recurrenceStartDate);
      const end = new Date(recurrenceEndDate);

      const dayIndexes = recurrenceDays.map((day) => WEEKDAY_MAP[day]);
      const sessions = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (dayIndexes.includes(getISOWeekday(d))) {
          const session = buildSession({
            eventId: event._id,
            tenantId,
            domainId: domainId || null,
            date: new Date(d),
            startTime,
            endTime,
          });
          sessions.push(session);
        }
      }

      if (sessions.length > 0) {
        await AttendanceSession.insertMany(sessions);
      }
    }

    logger.info("Event created successfully", {
      eventId: event._id,
      tenantId,
      eventType,
    });

    res.status(201).json({
      success: true,
      message: "Attendance event created",
      data: event,
    });
  } catch (error) {
    logger.error("Create event failed", {
      tenantId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to create event",
    });
  }
});

router.get("/:tenantId/events", async (req, res) => {
  const { tenantId } = req.params;
  const userTenant = req.user?.tenantId;

  try {
    if (!isValidObjectId(tenantId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid tenantId" });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant mismatch" });
    }

    const events = await AttendanceEvent.find({ tenantId }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      data: events,
    });
  } catch (error) {
    logger.error("Fetch events failed", { tenantId, error: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to fetch events",
    });
  }
});

router.get("/:tenantId/events/:eventId", async (req, res) => {
  const { tenantId, eventId } = req.params;
  const userTenant = req.user?.tenantId;

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId or eventId",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Tenant mismatch",
      });
    }

    const event = await AttendanceEvent.findOne({
      _id: eventId,
      tenantId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const sessions = await AttendanceSession.find({
      eventId,
      tenantId,
    }).sort({ sessionDate: 1 });

    const attendanceCount = await AttendanceRecord.aggregate([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          presentCount: {
            $sum: { $cond: [{ $eq: ["$status", "PRESENT"] }, 1, 0] },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        event,
        sessions,
        attendance: attendanceCount[0] || {
          totalRecords: 0,
          presentCount: 0,
        },
      },
    });
  } catch (error) {
    logger.error("Fetch event failed", {
      tenantId,
      eventId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch event",
    });
  }
});

router.delete("/:tenantId/events/:eventId", async (req, res) => {
  const { tenantId, eventId } = req.params;
  const userTenant = req.user?.tenantId;

  logger.info("Delete attendance event request", { tenantId, eventId });

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId or eventId",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Tenant mismatch",
      });
    }

    const event = await AttendanceEvent.findOneAndDelete({
      _id: eventId,
      tenantId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    await AttendanceSession.deleteMany({ eventId });
    await AttendanceRecord.deleteMany({ eventId });

    logger.info("Event deleted successfully", {
      eventId,
      tenantId,
    });

    res.json({
      success: true,
      message: "Event deleted successfully",
      data: { deletedEventId: eventId },
    });
  } catch (error) {
    logger.error("Delete event failed", {
      tenantId,
      eventId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to delete event",
    });
  }
});

router.get("/:tenantId/check-window/:eventId", async (req, res) => {
  const { tenantId, eventId } = req.params;

  try {
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
      tenantId,
      sessionDate: {
        $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      },
    });

    if (!session) {
      return res.json({
        success: true,
        data: {
          isWithinWindow: false,
          minutesRemaining: 0,
          message: "No session found for today",
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

    res.json({
      success: true,
      data: {
        isWithinWindow,
        minutesRemaining,
        sessionStart: timeStart.toISOString(),
        sessionEnd: timeEnd.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Check window failed", {
      tenantId,
      eventId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to check time window",
    });
  }
});

router.post("/:tenantId/upload-csv", async (req, res) => {
  const { tenantId, eventId, records } = req.body;
  const userTenant = req.user?.tenantId;

  logger.info("Upload CSV sessions request", { tenantId, eventId });

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(eventId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenantId or eventId",
      });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({
        success: false,
        message: "Tenant mismatch",
      });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "records must be a non-empty array",
      });
    }

    const event = await AttendanceEvent.findOne({
      _id: eventId,
      tenantId,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const sessions = records.map((record) => {
      const { date, start_time, end_time } = record;
      const session = buildSession({
        eventId,
        tenantId,
        domainId: event.domainId,
        date,
        startTime: start_time,
        endTime: end_time,
      });
      return session;
    });

    const created = await AttendanceSession.insertMany(sessions, {
      ordered: false,
    }).catch((error) => {
      if (error.code === 11000) {
        return error.writeErrors.map((e) => e.getOperation());
      }
      throw error;
    });

    logger.info("CSV sessions uploaded", {
      eventId,
      count: created?.length || sessions.length,
    });

    res.status(201).json({
      success: true,
      message: "Sessions created from CSV",
      data: { sessionsCreated: created?.length || sessions.length },
    });
  } catch (error) {
    logger.error("Upload CSV failed", {
      tenantId,
      eventId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Failed to upload CSV",
    });
  }
});

router.get("/:tenantId/events/:eventId/records", async (req, res) => {
  const { tenantId, eventId } = req.params;
  const userTenant = req.user?.tenantId;

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid tenantId or eventId" });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({ success: false, message: "Tenant mismatch" });
    }

    const records = await AttendanceRecord.find({ eventId, tenantId })
      .populate("userId", "name email")
      .sort({ markedAt: -1 });

    res.json({ success: true, data: records });
  } catch (error) {
    logger.error("Fetch event records failed", { eventId, error: error.message });
    res.status(500).json({ success: false, message: "Failed to fetch records" });
  }
});

router.post("/:tenantId/events/:eventId/override", async (req, res) => {
  const { tenantId, eventId } = req.params;
  const { userEmail, action } = req.body; // action: "MARK" | "UNMARK"
  const userTenant = req.user?.tenantId;

  try {
    if (!isValidObjectId(tenantId) || !isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid tenantId or eventId" });
    }

    if (userTenant && !isSameTenant(userTenant, tenantId)) {
      return res.status(403).json({ success: false, message: "Tenant mismatch" });
    }

    if (!userEmail || !["MARK", "UNMARK"].includes(action)) {
      return res.status(400).json({ success: false, message: "userEmail and valid action required" });
    }

    // Since we need to look up the user by email, we must import User model inside the route or globally
    const { default: User } = await import("../models/User.js");
    const { default: AuditLog } = await import("../models/AuditLog.js");
    
    const user = await User.findOne({ email: userEmail, tenantId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found with this email" });
    }

    const event = await AttendanceEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Get today's session or the only session
    const now = new Date();
    const session = await AttendanceSession.findOne({
      eventId,
      tenantId,
      sessionDate: {
        $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
        $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: "No active session found for this event today to override" });
    }

    if (action === "UNMARK") {
      await AttendanceRecord.findOneAndDelete({
        eventId,
        sessionId: session._id,
        userId: user._id
      });
      
      await AuditLog.create({
        tenantId,
        domainId: event.domainId,
        userId: user._id,
        eventId,
        action: "ATTENDANCE_OVERRIDE",
        details: { action: "UNMARK", byAdmin: req.user?.adminId },
        timestamp: new Date()
      });
      
      return res.json({ success: true, message: "Attendance revoked successfully" });
    } else {
      const record = await AttendanceRecord.findOneAndUpdate(
        { eventId, sessionId: session._id, userId: user._id },
        {
          eventId,
          sessionId: session._id,
          tenantId,
          domainId: event.domainId,
          userId: user._id,
          status: "PRESENT",
          markedAt: new Date(),
          source: "ADMIN_OVERRIDE"
        },
        { upsert: true, new: true }
      );
      
      await AuditLog.create({
        tenantId,
        domainId: event.domainId,
        userId: user._id,
        eventId,
        action: "ATTENDANCE_OVERRIDE",
        details: { action: "MARK", byAdmin: req.user?.adminId },
        timestamp: new Date()
      });

      return res.json({ success: true, message: "Attendance marked successfully" });
    }

  } catch (error) {
    logger.error("Override attendance failed", { eventId, error: error.message });
    res.status(500).json({ success: false, message: "Failed to override attendance" });
  }
});

export default router;
