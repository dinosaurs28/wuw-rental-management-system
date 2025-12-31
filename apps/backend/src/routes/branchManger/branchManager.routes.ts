import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares";
import { GetRevenueStats } from "../../controller/branchManager/revenue.controller";

const router:Router=Router()

router.post("/auth/login", Login)
router.get("/dashboard/revenue", ManagerCheck, GetRevenueStats)

export default router