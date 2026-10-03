import { Router } from "express";
import { Login } from "../../controller/admin/auth.controller.js";
import { AdminCheck } from "../../middlewares/adminCheck.middleware.js";
import {
  makeForgotPasswordController,
  resetPasswordController,
} from "../../services/passwordReset/passwordReset.controller.js";
import {
  makeForgotPasswordSmsController,
  makeResetPasswordSmsController,
} from "../../services/passwordReset/smsReset.controller.js";
import { Role as ResetRole } from "@repo/database/client";
import {
  GetEmailDiagnostics,
  SendTestEmail,
  SendTestSms,
} from "../../controller/admin/diagnostics.controller.js";
import { makeRecoveryPhoneHandlers } from "../../services/passwordReset/recoveryPhone.controller.js";
import {
  GetAllBranches,
  CreateBranch,
  EditBranch,
  DeleteBranch,
} from "../../controller/admin/branch.controller.js";
import {
  GetBranchManagers,
  CreateBranchManager,
  UpdateBranchManager,
  SetBranchManagerStatus,
} from "../../controller/admin/branchManager.controller.js";
import { GetBranchRevenue } from "../../controller/admin/report.controller.js";
import {
  GetRevenueTrends,
  GetRevenueByCategory,
  GetKPISummary,
  GetPaymentMethodBreakdown,
} from "../../controller/admin/analytics.controller.js";
import { GetDailySummary } from "../../controller/admin/dailySummaryController.js";
import { GetSalesReport } from "../../controller/admin/salesReportController.js";
import { GetVehicleHistory } from "../../controller/admin/vehicleHistoryController.js";
import { GetVehicleReportList } from "../../controller/admin/vehicleReportController.js";
import { GetVehicleAvailability } from "../../controller/admin/vehicleAvailabilityController.js";
import { GetInsurancePermitExpiry } from "../../controller/admin/insurancePermitController.js";
import { GetCollectionReport } from "../../controller/admin/collectionReportController.js";
import { GetFleetExecutiveReport } from "../../controller/admin/fleetExecutiveController.js";
import { GetGSTReport } from "../../controller/admin/gstReportController.js";
import { GetInvoiceReport } from "../../controller/admin/invoiceReportController.js";
import { GetReceiptReport } from "../../controller/admin/receiptReportController.js";
import { GetCustomerReport } from "../../controller/admin/customerReportController.js";
import { GetAllCategories } from "../../controller/admin/category.controller.js";
import { getGlobalKpiStats } from "../../controller/admin/globalKpi.controller.js";
import { GetAllVehicles, UpdateVehicleUseCases } from "../../controller/admin/vehicle.controller.js";
import featureFlagRouter from "./feature-flag.routes.js";
import auditRouter from "./audit.routes.js";
import staffActivityRouter from "./staffActivity.routes.js";
import discountRouter from "./discount.routes.js";
import paymentRouter from "./payment.routes.js";
import whatsappConfigRouter from "./whatsapp-config.routes.js";
import userTransferRouter from "./userTransfer.routes.js";
import {
  upsertBranchSchedule,
  updateBranchGrace,
  getAdminBranchSchedule,
} from "../../controller/admin/branchSchedule.controller.js";

const router: Router = Router();

router.post("/auth/login", Login);
router.post("/auth/forgot-password", makeForgotPasswordController("admin"));
router.post("/auth/reset-password", resetPasswordController);
// Admin reset by SMS code, public, ADMIN accounts only.
router.post("/auth/sms/forgot-password", makeForgotPasswordSmsController([ResetRole.ADMIN]));
router.post("/auth/sms/reset-password", makeResetPasswordSmsController([ResetRole.ADMIN]));
// Email / SMS delivery diagnostics.
router.get("/diagnostics/email", AdminCheck, GetEmailDiagnostics);
router.post("/diagnostics/email/test", AdminCheck, SendTestEmail);
router.post("/diagnostics/sms/test", AdminCheck, SendTestSms);
// The admin's own recovery mobile number (where an SMS reset code goes).
const adminRecoveryPhone = makeRecoveryPhoneHandlers(ResetRole.ADMIN);
router.get("/account/recovery-phone", AdminCheck, adminRecoveryPhone.get);
router.post("/account/recovery-phone/send-code", AdminCheck, adminRecoveryPhone.sendCode);
router.post("/account/recovery-phone/verify", AdminCheck, adminRecoveryPhone.verify);
router.get("/dashboard/branches", AdminCheck, GetAllBranches);
router.post("/dashboard/branches/create", AdminCheck, CreateBranch);
router.put("/dashboard/branches/edit/:branchId", AdminCheck, EditBranch);
router.delete("/dashboard/branches/delete/:branchId", AdminCheck, DeleteBranch);

// Branch schedule configuration
router.get("/dashboard/branches/:branchPublicId/schedule", AdminCheck, getAdminBranchSchedule);
router.patch("/dashboard/branches/:branchPublicId/schedule", AdminCheck, upsertBranchSchedule);
router.patch("/dashboard/branches/:branchPublicId/grace", AdminCheck, updateBranchGrace);

// Branch Manager CRUD (multiple managers per branch)
router.get("/dashboard/branches/:branchId/managers", AdminCheck, GetBranchManagers);
router.post("/dashboard/branches/:branchId/managers", AdminCheck, CreateBranchManager);
router.put("/dashboard/branches/:branchId/managers/:managerId", AdminCheck, UpdateBranchManager);
router.patch("/dashboard/branches/:branchId/managers/:managerId/status", AdminCheck, SetBranchManagerStatus);
router.get("/dashboard/reports/revenue", AdminCheck, GetBranchRevenue);
router.get("/dashboard/reports/revenue-trends", AdminCheck, GetRevenueTrends);
router.get(
  "/dashboard/reports/revenue-by-category",
  AdminCheck,
  GetRevenueByCategory,
);
router.get("/dashboard/reports/kpi-summary", AdminCheck, GetKPISummary);
router.get(
  "/dashboard/reports/payment-methods",
  AdminCheck,
  GetPaymentMethodBreakdown,
);
router.get("/dashboard/reports/global-kpi", AdminCheck, getGlobalKpiStats);

// New Reports System Routes (All 8 Reports)
router.get("/dashboard/reports/daily-summary", AdminCheck, GetDailySummary);
router.get("/dashboard/reports/sales", AdminCheck, GetSalesReport);
router.get("/dashboard/reports/vehicles", AdminCheck, GetVehicleReportList);
router.get(
  "/dashboard/reports/vehicle-history/:vehicleId",
  AdminCheck,
  GetVehicleHistory,
);
router.get(
  "/dashboard/reports/vehicle-availability",
  AdminCheck,
  GetVehicleAvailability,
);
router.get(
  "/dashboard/reports/insurance-permit-expiry",
  AdminCheck,
  GetInsurancePermitExpiry,
);
router.get("/dashboard/reports/collection", AdminCheck, GetCollectionReport);
router.get(
  "/dashboard/reports/fleet-executive",
  AdminCheck,
  GetFleetExecutiveReport,
);
router.get("/dashboard/reports/gst", AdminCheck, GetGSTReport);
router.get("/dashboard/reports/invoices", AdminCheck, GetInvoiceReport);
router.get("/dashboard/reports/receipts", AdminCheck, GetReceiptReport);
router.get("/dashboard/reports/customers", AdminCheck, GetCustomerReport);

router.get("/dashboard/categories", AdminCheck, GetAllCategories);
router.get("/dashboard/vehicles", AdminCheck, GetAllVehicles);
router.patch("/dashboard/vehicles/:publicId/use-cases", AdminCheck, UpdateVehicleUseCases);

// Feature Flags
router.use("/feature-flags", featureFlagRouter);

// Audit Logs
router.use("/audit", auditRouter);

// Staff Activity Logs
router.use("/staff-activity", staffActivityRouter);

// Cross-branch user staffing overview & transfer
router.use("/dashboard/user-transfer", userTransferRouter);

// Discount Rules
router.use("/discount-rules", discountRouter);

// Payment Config (admin)
router.use("/payment", paymentRouter);

// WhatsApp Support Config
router.use("/whatsapp-config", whatsappConfigRouter);

export default router;
