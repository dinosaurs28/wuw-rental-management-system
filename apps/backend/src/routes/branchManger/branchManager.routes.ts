import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares";
import { GetRevenueStats } from "../../controller/branchManager/revenue.controller";
import { GetActiveBookings, GetPendingApprovals } from "../../controller/branchManager/bookings.controller";
import { GetDamageReports } from "../../controller/branchManager/damage.controller";

const router:Router=Router()

router.post("/auth/login", Login)
router.get("/dashboard/revenue", ManagerCheck, GetRevenueStats)
router.get("/dashboard/bookings/active", ManagerCheck, GetActiveBookings)
router.get("/dashboard/bookings/pending", ManagerCheck, GetPendingApprovals)
router.get("/dashboard/damage-reports", ManagerCheck, GetDamageReports)

export default router