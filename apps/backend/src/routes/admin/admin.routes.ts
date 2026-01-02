import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller";
import { AdminCheck } from "../../middlewares/adminCheck.middleware";
import { GetAllBranches, CreateBranch, EditBranch, DeleteBranch } from "../../controller/admin/branch.controller";
import { GetBranchRevenue } from "../../controller/admin/report.controller";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/dashboard/branches", AdminCheck, GetAllBranches);
router.post("/dashboard/branches/create", AdminCheck, CreateBranch);
router.put("/dashboard/branches/edit/:branchId", AdminCheck, EditBranch);
router.delete("/dashboard/branches/delete/:branchId", AdminCheck, DeleteBranch);
router.get("/dashboard/reports/revenue", AdminCheck, GetBranchRevenue);

export default router;
