import AttendanceSession from "../models/AttendanceSession.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import mongoose from "mongoose";

const WEEKDAY_MAP = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 0,
};

export const parseTimeString = (value) => {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
};

export const buildSessionDateTime = (date, timeString) => {
  const time = parseTimeString(timeString);
  if (!time) return null;
  const result = new Date(date);
  result.setHours(time.hours, time.minutes, 0, 0);
  return result;
};

export const buildSession = ({
  eventId,
  tenantId,
  domainId,
  date,
  startTime,
  endTime,
}) => {
  const sessionDate = new Date(date);
  sessionDate.setHours(0, 0, 0, 0);

  const startAt = buildSessionDateTime(sessionDate, startTime);
  const endAt = buildSessionDateTime(sessionDate, endTime);

  if (!startAt || !endAt || startAt >= endAt) {
    throw new Error("Invalid session start or end time");
  }

  return {
    eventId,
    tenantId,
    domainId,
    sessionDate,
    startAt,
    endAt,
  };
};

export const createAttendanceRecordsForMissedSessions = async (
  eventId,
  userId,
  sessions,
  tenantId,
  domainId,
) => {
  if (!sessions.length) return [];

  const recordPromises = sessions.map((session) =>
    AttendanceRecord.findOneAndUpdate(
      {
        eventId: new mongoose.Types.ObjectId(eventId),
        sessionId: session._id,
        userId: new mongoose.Types.ObjectId(userId),
      },
      {
        eventId,
        sessionId: session._id,
        tenantId,
        domainId,
        userId,
        status: "ABSENT",
        markedAt: new Date(),
        source: "VERIFICATION",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  );

  return Promise.all(recordPromises);
};

export const syncAbsentRecordsForUser = async (
  eventId,
  userId,
  tenantId,
  domainId,
) => {
  const now = new Date();
  const existingRecords = await AttendanceRecord.find({
    eventId,
    userId,
  }).select("sessionId");

  const existingSessionIds = new Set(
    existingRecords.map((record) => record.sessionId.toString()),
  );

  const missedSessions = await AttendanceSession.find({
    eventId,
    endAt: { $lte: now },
    _id: {
      $nin: Array.from(existingSessionIds).map((id) =>
        new mongoose.Types.ObjectId(id),
      ),
    },
  });

  return createAttendanceRecordsForMissedSessions(
    eventId,
    userId,
    missedSessions,
    tenantId,
    domainId,
  );
};

export const getAttendancePercentage = async (eventId, userId) => {
  const now = new Date();

  await syncAbsentRecordsForUser(eventId, userId, null, null);

  const records = await AttendanceRecord.find({
    eventId,
    userId,
  });

  const total = records.length;
  const attended = records.filter(
    (record) => record.status === "PRESENT",
  ).length;

  return {
    attended,
    total,
    attendancePercentage: total === 0 ? 0 : (attended / total) * 100,
  };
};
