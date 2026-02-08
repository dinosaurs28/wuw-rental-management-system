import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller";
import { AdminCheck } from "../../middlewares/adminCheck.middleware";
import { GetAllBranches, CreateBranch, EditBranch, DeleteBranch } from "../../controller/admin/branch.controller";
import { GetBranchRevenue } from "../../controller/admin/report.controller";
import { GetRevenueTrends, GetRevenueByCategory, GetKPISummary, GetPaymentMethodBreakdown } from "../../controller/admin/analytics.controller";
import { GetDailySummary } from "../../controller/admin/dailySummaryController";
import { GetSalesReport } from "../../controller/admin/salesReportController";
import { GetVehicleHistory } from "../../controller/admin/vehicleHistoryController";
import { GetVehicleAvailability } from "../../controller/admin/vehicleAvailabilityController";
import { GetInsurancePermitExpiry } from "../../controller/admin/insurancePermitController";
import { GetCollectionReport } from "../../controller/admin/collectionReportController";
import { GetFleetExecutiveReport } from "../../controller/admin/fleetExecutiveController";
import { GetGSTReport } from "../../controller/admin/gstReportController";
import { GetAllCategories } from "../../controller/admin/category.controller";
import { getGlobalKpiStats } from "../../controller/admin/globalKpi.controller";
import { GetAllVehicles } from "../../controller/admin/vehicle.controller";

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

// New Reports System Routes (All 8 Reports)
router.get("/dashboard/reports/daily-summary", AdminCheck, GetDailySummary);
router.get("/dashboard/reports/sales", AdminCheck, GetSalesReport);
router.get("/dashboard/reports/vehicle-history/:vehicleId", AdminCheck, GetVehicleHistory);
router.get("/dashboard/reports/vehicle-availability", AdminCheck, GetVehicleAvailability);
router.get("/dashboard/reports/insurance-permit-expiry", AdminCheck, GetInsurancePermitExpiry);
router.get("/dashboard/reports/collection", AdminCheck, GetCollectionReport);
router.get("/dashboard/reports/fleet-executive", AdminCheck, GetFleetExecutiveReport);
router.get("/dashboard/reports/gst", AdminCheck, GetGSTReport);

router.get("/dashboard/categories", AdminCheck, GetAllCategories);
router.get("/dashboard/vehicles", AdminCheck, GetAllVehicles);

export default router;
