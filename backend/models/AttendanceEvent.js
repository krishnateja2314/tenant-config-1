import mongoose from "mongoose";

const attendanceEventSchema = new mongoose.Schema(
  {
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
    title: {
      type: String,
      required: true,
    },
    description: String,
    eventType: {
      type: String,
      enum: ["ONE_TIME", "RECURRING"],
      required: true,
      default: "ONE_TIME",
    },
    scheduledDate: Date,
    startTime: String,
    endTime: String,
    recurrenceStartDate: Date,
    recurrenceEndDate: Date,
    recurrenceDays: [
      {
        type: String,
        enum: [
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
          "SATURDAY",
          "SUNDAY",
        ],
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export default mongoose.model("AttendanceEvent", attendanceEventSchema);
