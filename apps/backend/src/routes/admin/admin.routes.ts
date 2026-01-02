import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller";
import { AdminCheck } from "../../middlewares/adminCheck.middleware";
import { GetAllBranches, CreateBranch } from "../../controller/admin/branch.controller";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/dashboard/branches", AdminCheck, GetAllBranches);
router.post("/dashboard/branches/create", AdminCheck, CreateBranch);

export default router;
