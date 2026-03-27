import { Router, Request, Response } from "express";
import { getInsuranceAlertCounts } from "../../jobs/insurance-alert.worker.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";

const router: Router = Router();

/**
 * GET /api/insurance-alerts/counts
 * Returns the number of vehicles with expired or expiring insurance.
 * Accessible to admins and branch managers.
 */
router.get("/counts", authCheckJwt, async (_req: Request, res: Response) => {
  try {
    const counts = await getInsuranceAlertCounts();
    return res.status(200).json({ success: true, data: counts });
  } catch (error) {
    console.error("[Insurance Alert Route] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch insurance alert counts" });
  }
});

export default router;
