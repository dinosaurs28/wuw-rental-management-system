import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller.js";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import { GetRevenueStats } from "../../controller/branchManager/revenue.controller.js";
import { GetDashboardStats } from "../../controller/branchManager/dashboard.controller.js";
import {
  GetActiveBookings,
  GetPendingApprovals,
  CollectSafetyDeposit,
  CancelNoShow,
  CalculateFinalBilling,
  RefundDeposit,
  ConfirmPickupWithDeposit,
  ConfirmReturnByManager,
  GetManagerConfirmations,
  GetConfirmationDetails,
  GetBookingVehicleDetails,
} from "../../controller/branchManager/bookings.controller.js";
import {
  GetAvailableVehicles,
  SwapVehicle,
  GetSwapHistory,
  GetBookingSwapHistory,
} from "../../controller/branchManager/vehicle-swap.controller.js";

import {
  GetDamageReports,
  CloseDamageReport,
  GetMinimalDamageReport,
  GetDamageReportList,
  CheckDamagePaymentStatus,
  UpdateDamageChargeType,
} from "../../controller/branchManager/damage.controller.js";
import {
  AddVehicle,
  EditVehicle,
  GetInsuranceExpiryReport,
  GetVehicleById,
  GetVehicles,
  DeleteVehicle,
  GetVehicleCategories,
} from "../../controller/branchManager/vehicle.controller.js";
import {
  GetStaffAuditLogs,
  GetBranchAuditLogs,
  GetBranchAuditLogById,
  GetCustomerAuditLogs,
} from "../../controller/branchManager/audit.controller.js";
import {
  CreateEmployee,
  GetEmployee,
  SearchEmployee,
  UpdateEmployee,
  DeleteEmployee,
} from "../../controller/branchManager/employee.controller.js";
import {
  CreateDepositRule,
  GetDepositRules,
  UpdateDepositRule,
  DeleteDepositRule,
} from "../../controller/branchManager/deposit.controller.js";
import {
  GetDiscounts,
  CreateDiscount,
  UpdateDiscount,
  DeleteDiscount,
} from "../../controller/branchManager/pricing.controller.js";
import {
  GetGSTRule,
  CreateOrUpdateGSTRule,
} from "../../controller/branchManager/gst.controller.js";
import {
  GetCaptureConfigs,
  CreateCaptureConfig,
  UpdateCaptureConfig,
  DeleteCaptureConfig,
} from "../../controller/branchManager/captureConfig.controller.js";
import { upload } from "../../middlewares/upload.middleware.js";

const router: Router = Router();

router.post("/auth/login", Login);
router.get("/dashboard/stats", ManagerCheck, GetDashboardStats);
router.get("/dashboard/revenue", ManagerCheck, GetRevenueStats);
router.get("/dashboard/bookings/active", ManagerCheck, GetActiveBookings);
router.get("/dashboard/bookings/pending", ManagerCheck, GetPendingApprovals);
router.get(
  "/dashboard/bookings/manager-confirmations",
  ManagerCheck,
  GetManagerConfirmations,
);
router.get(
  "/dashboard/bookings/:bookingId/confirmation-details",
  ManagerCheck,
  GetConfirmationDetails,
);
router.post(
  "/dashboard/bookings/:bookingId/safety-deposit",
  ManagerCheck,
  CollectSafetyDeposit,
);
router.post(
  "/dashboard/bookings/:bookingId/manager-confirm-pickup",
  ManagerCheck,
  ConfirmPickupWithDeposit,
);
router.post(
  "/dashboard/bookings/:bookingId/manager-confirm-return",
  ManagerCheck,
  ConfirmReturnByManager,
);
router.post(
  "/dashboard/bookings/:bookingId/cancel-no-show",
  ManagerCheck,
  CancelNoShow,
);
router.post(
  "/dashboard/bookings/:bookingId/final-billing",
  ManagerCheck,
  CalculateFinalBilling,
);
router.post(
  "/dashboard/bookings/:bookingId/refund-deposit",
  ManagerCheck,
  RefundDeposit,
);
router.get(
  "/dashboard/bookings/:bookingId/vehicle-details",
  ManagerCheck,
  GetBookingVehicleDetails,
);
router.get(
  "/dashboard/bookings/:bookingId/available-vehicles",
  ManagerCheck,
  GetAvailableVehicles,
);
router.post(
  "/dashboard/bookings/:bookingId/swap-vehicle",
  ManagerCheck,
  SwapVehicle,
);
router.get(
  "/dashboard/bookings/:bookingId/swap-history",
  ManagerCheck,
  GetBookingSwapHistory,
);
router.get("/dashboard/swap-history", ManagerCheck, GetSwapHistory);
router.get("/dashboard/damage-reports", ManagerCheck, GetDamageReports);
router.get("/damage-reports", ManagerCheck, GetDamageReportList);
router.get(
  "/damage-reports/:damageReportId",
  ManagerCheck,
  GetMinimalDamageReport,
);
router.patch(
  "/damage-reports/:damageReportId/charge-type",
  ManagerCheck,
  UpdateDamageChargeType,
);
router.patch(
  "/damage-reports/:damageReportId/close",
  ManagerCheck,
  CloseDamageReport,
);
router.get(
  "/payment/status/:transactionId",
  ManagerCheck,
  CheckDamagePaymentStatus,
);
router.get("/dashboard/vehicles", ManagerCheck, GetVehicles);
router.post(
  "/dashboard/vehicle/add",
  ManagerCheck,
  upload.array("images", 5),
  AddVehicle,
);
router.put(
  "/dashboard/vehicle/edit/:vehicleId",
  ManagerCheck,
  upload.array("images", 5),
  EditVehicle,
);
router.get("/dashboard/vehicle/:vehicleId", ManagerCheck, GetVehicleById);
router.delete("/dashboard/vehicle/:vehicleId", ManagerCheck, DeleteVehicle);
router.get("/dashboard/categories", ManagerCheck, GetVehicleCategories);
// Audit log routes (new)
router.get("/audit/logs", ManagerCheck, GetBranchAuditLogs);
router.get("/audit/logs/customer/:customerId", ManagerCheck, GetCustomerAuditLogs);
router.get("/audit/logs/:publicId", ManagerCheck, GetBranchAuditLogById);
// Backward-compat
router.get("/dashboard/staff/activity-logs", ManagerCheck, GetStaffAuditLogs);
router.get(
  "/dashboard/reports/insurance-expiry",
  ManagerCheck,
  GetInsuranceExpiryReport,
);
router.get("/dashboard/employees", ManagerCheck, SearchEmployee);
router.get("/dashboard/employees/:employeeId", ManagerCheck, GetEmployee);
router.post("/dashboard/employees", ManagerCheck, CreateEmployee);
router.put("/dashboard/employees/:employeeId", ManagerCheck, UpdateEmployee);
router.delete("/dashboard/employees/:employeeId", ManagerCheck, DeleteEmployee);
router.get("/dashboard/deposit-rules", ManagerCheck, GetDepositRules);
router.post("/dashboard/deposit-rules", ManagerCheck, CreateDepositRule);
router.put("/dashboard/deposit-rules/:id", ManagerCheck, UpdateDepositRule);
router.delete("/dashboard/deposit-rules/:id", ManagerCheck, DeleteDepositRule);

router.get("/dashboard/pricing", ManagerCheck, GetDiscounts);
router.post("/dashboard/pricing", ManagerCheck, CreateDiscount);
router.put("/dashboard/pricing/:id", ManagerCheck, UpdateDiscount);
router.delete("/dashboard/pricing/:id", ManagerCheck, DeleteDiscount);

router.get("/gst", ManagerCheck, GetGSTRule);
router.post("/gst", ManagerCheck, CreateOrUpdateGSTRule);

router.get("/capture-configs", ManagerCheck, GetCaptureConfigs);
router.post("/capture-configs", ManagerCheck, CreateCaptureConfig);
router.put("/capture-configs/:publicId", ManagerCheck, UpdateCaptureConfig);
router.delete("/capture-configs/:publicId", ManagerCheck, DeleteCaptureConfig);

export default router;
