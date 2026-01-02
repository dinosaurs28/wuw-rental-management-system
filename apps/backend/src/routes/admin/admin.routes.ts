import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller";
import { AdminCheck } from "../../middlewares/adminCheck.middleware";
import { GetAllBranches, CreateBranch, EditBranch } from "../../controller/admin/branch.controller";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/dashboard/branches", AdminCheck, GetAllBranches);
router.post("/dashboard/branches/create", AdminCheck, CreateBranch);
router.put("/dashboard/branches/edit/:branchId", AdminCheck, EditBranch);

export default router;
