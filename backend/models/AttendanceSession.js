import mongoose from "mongoose";

const attendanceSessionSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceEvent",
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
    sessionDate: {
      type: Date,
      required: true,
      index: true,
    },
    startAt: {
      type: Date,
      required: true,
      index: true,
    },
    endAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

attendanceSessionSchema.index({ eventId: 1, sessionDate: 1 }, { unique: true });

export default mongoose.model("AttendanceSession", attendanceSessionSchema);
