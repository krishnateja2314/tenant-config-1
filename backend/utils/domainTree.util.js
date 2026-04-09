import Domain from "../models/Domain.js";
import mongoose from "mongoose";

export const getDomainTree = async (tenantId) => {
  const tree = await Domain.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        parentDomainId: null
      }
    },
    {
      $graphLookup: {
        from: "domains",
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "parentDomainId",
        as: "children"
      }
    }
  ]);

  return tree;
};