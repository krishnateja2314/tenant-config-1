import mongoose from "mongoose";

const attendanceRecordSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceEvent",
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceSession",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    domainId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT"],
      required: true,
    },
    markedAt: {
      type: Date,
      default: Date.now,
    },
    source: {
      type: String,
      enum: ["MANUAL", "VERIFICATION", "ADMIN_OVERRIDE"],
      default: "MANUAL",
    },
  },
  { timestamps: true },
);

attendanceRecordSchema.index(
  { eventId: 1, userId: 1, sessionId: 1 },
  { unique: true },
);

export default mongoose.model("AttendanceRecord", attendanceRecordSchema);
