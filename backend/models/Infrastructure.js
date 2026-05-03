import mongoose from "mongoose";

const infrastructureSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    domainId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    storageQuota: {
      totalGB: {
        type: Number,
        required: true,
        min: 1,
        default: 100,
      },
      usedGB: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    computeLimit: {
      cpuCores: {
        type: Number,
        required: true,
        min: 1,
        default: 4,
      },
      memoryGB: {
        type: Number,
        required: true,
        min: 1,
        default: 8,
      },
      maxConcurrentJobs: {
        type: Number,
        required: true,
        min: 1,
        default: 10,
      },
    },

    specialAccessFlags: {
      labSystemAccess: {
        type: Boolean,
        default: false,
      },
      biometricAccess: {
        type: Boolean,
        default: false,
      },
      faceRecognitionAccess: {
        type: Boolean,
        default: false,
      },
      deviceIdentityVerification: {
        type: Boolean,
        default: false,
      },
      advancedLabAccess: {
        type: Boolean,
        default: false,
      },
      customFlags: [
        {
          name: String,
          enabled: Boolean,
        },
      ],
    },

    allocationStatus: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },

    metadata: {
      allocatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      allocationReason: String,
      notes: String,
    },
  },
  { timestamps: true },
);

infrastructureSchema.index({ tenantId: 1, domainId: 1 }, { unique: true });

export default mongoose.model("Infrastructure", infrastructureSchema);
