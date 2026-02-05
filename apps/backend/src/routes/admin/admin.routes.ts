import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller";
import { AdminCheck } from "../../middlewares/adminCheck.middleware";
import { GetAllBranches, CreateBranch, EditBranch, DeleteBranch } from "../../controller/admin/branch.controller";
import { GetBranchRevenue } from "../../controller/admin/report.controller";
import { GetRevenueTrends, GetRevenueByCategory, GetKPISummary, GetPaymentMethodBreakdown } from "../../controller/admin/analytics.controller";
import { GetAllCategories } from "../../controller/admin/category.controller";
import { getGlobalKpiStats } from "../../controller/admin/globalKpi.controller";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/dashboard/branches", AdminCheck, GetAllBranches);
router.post("/dashboard/branches/create", AdminCheck, CreateBranch);
router.put("/dashboard/branches/edit/:branchId", AdminCheck, EditBranch);
router.delete("/dashboard/branches/delete/:branchId", AdminCheck, DeleteBranch);
router.get("/dashboard/reports/revenue", AdminCheck, GetBranchRevenue);
router.get("/dashboard/reports/revenue-trends", AdminCheck, GetRevenueTrends);
router.get("/dashboard/reports/revenue-by-category", AdminCheck, GetRevenueByCategory);
router.get("/dashboard/reports/kpi-summary", AdminCheck, GetKPISummary);
router.get("/dashboard/reports/payment-methods", AdminCheck, GetPaymentMethodBreakdown);
router.get("/dashboard/reports/global-kpi", AdminCheck, getGlobalKpiStats);
router.get("/dashboard/categories", AdminCheck, GetAllCategories);

export default router;
