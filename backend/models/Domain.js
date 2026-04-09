import mongoose from "mongoose";

const domainSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },

  domainName: {
    type: String,
    required: true
  },

  parentDomainId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  domainAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  },

  metadata: {
    domainType: {
      type: String,
      enum: ["DEPARTMENT", "YEAR", "SECTION"]
    },
    description: String
  }

}, { timestamps: true });

export default mongoose.model("Domain", domainSchema);