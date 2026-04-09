import express from "express";
import Domain from "../models/Domain.js";
import { getDomainTree } from "../utils/domainTree.util.js";
import { isCycle } from "../utils/cycleCheck.util.js";

const router = express.Router();

// CREATE
router.post("/", async (req, res) => {
  const domain = await Domain.create(req.body);
  res.json({ success: true, data: domain });
});

// GET TREE
router.get("/tree/:tenantId", async (req, res) => {
  const tree = await getDomainTree(req.params.tenantId);
  res.json({ success: true, data: tree });
});

// UPDATE (re-parent)
router.put("/:id", async (req, res) => {
  const { parentDomainId } = req.body;

  if (await isCycle(req.params.id, parentDomainId)) {
    return res.status(400).json({
      success: false,
      message: "Cycle detected"
    });
  }

  const updated = await Domain.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );

  res.json({ success: true, data: updated });
});

export default router;