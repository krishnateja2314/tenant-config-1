import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    studentId: {
      type: String,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    domainId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceEvent",
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    requestPath: String,
    actualAttendance: {
      type: Number,
    },
    requiredThreshold: {
      type: Number,
    },
    decision: {
      type: String,
      enum: ["ALLOWED", "DENIED"],
    },
    reasonForDenial: String,
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: false },
);

// Create index for efficient audit querying
auditLogSchema.index({ tenantId: 1, timestamp: -1 });
auditLogSchema.index({ studentId: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ eventId: 1, timestamp: -1 });
auditLogSchema.index({ tenantId: 1, userId: 1, eventId: 1, timestamp: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
