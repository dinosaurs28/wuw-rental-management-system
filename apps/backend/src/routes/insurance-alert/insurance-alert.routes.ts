import { Router, Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";

const EXPIRY_WARN_DAYS = 30;

const router: Router = Router();

/**
 * GET /api/insurance-alerts/counts
 * Returns per-branch counts of expired / expiring vehicles for the authenticated manager.
 */
router.get("/counts", ManagerCheck, async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const now = new Date();

    // Extend cutoff to end-of-day N days from now so vehicles expiring
    // on the boundary date are never missed due to time-of-day differences.
    const warnCutoff = new Date(now);
    warnCutoff.setDate(warnCutoff.getDate() + EXPIRY_WARN_DAYS);
    warnCutoff.setHours(23, 59, 59, 999);

    const [expiredCount, expiringCount] = await Promise.all([
      prisma.vehicle.count({
        where: { branchId, deletedAt: null, insuranceExpiry: { lt: now } },
      }),
      prisma.vehicle.count({
        where: { branchId, deletedAt: null, insuranceExpiry: { gte: now, lte: warnCutoff } },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        expiredCount,
        expiringCount,
        total: expiredCount + expiringCount,
        computedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Insurance Alert Route] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch insurance alert counts" });
  }
});

export default router;
