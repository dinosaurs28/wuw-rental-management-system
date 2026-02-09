import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller.js";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import { GetRevenueStats } from "../../controller/branchManager/revenue.controller.js";
import { GetDashboardStats } from "../../controller/branchManager/dashboard.controller.js";
import { GetActiveBookings, GetPendingApprovals } from "../../controller/branchManager/bookings.controller.js";

import { GetDamageReports, CloseDamageReport, GetMinimalDamageReport, GetDamageReportList, CheckDamagePaymentStatus } from "../../controller/branchManager/damage.controller.js";
import { AddVehicle, EditVehicle, GetInsuranceExpiryReport, GetVehicleById, GetVehicles, DeleteVehicle, GetVehicleCategories } from "../../controller/branchManager/vehicle.controller.js";
import { GetStaffAuditLogs } from "../../controller/branchManager/audit.controller.js";
import { CreateEmployee, GetEmployee, SearchEmployee, UpdateEmployee } from "../../controller/branchManager/employee.controller.js";
import { CreateDepositRule, GetDepositRules, UpdateDepositRule, DeleteDepositRule } from "../../controller/branchManager/deposit.controller.js";
import { upload } from "../../middlewares/upload.middleware.js";

const router: Router = Router()

router.post("/auth/login", Login)
router.get("/dashboard/stats", ManagerCheck, GetDashboardStats)
router.get("/dashboard/revenue", ManagerCheck, GetRevenueStats)
router.get("/dashboard/bookings/active", ManagerCheck, GetActiveBookings)
router.get("/dashboard/bookings/pending", ManagerCheck, GetPendingApprovals)
router.get("/dashboard/damage-reports", ManagerCheck, GetDamageReports)
router.get("/damage-reports", ManagerCheck, GetDamageReportList)
router.get("/damage-reports/:damageReportId", ManagerCheck, GetMinimalDamageReport)
router.patch("/damage-reports/:damageReportId/close", ManagerCheck, CloseDamageReport)
router.get("/payment/status/:transactionId", ManagerCheck, CheckDamagePaymentStatus)
router.get("/dashboard/vehicles", ManagerCheck, GetVehicles)
router.post("/dashboard/vehicle/add", ManagerCheck, upload.array('images', 5), AddVehicle)
router.put("/dashboard/vehicle/edit/:vehicleId", ManagerCheck, upload.array('images', 5), EditVehicle)
router.get("/dashboard/vehicle/:vehicleId", ManagerCheck, GetVehicleById)
router.delete("/dashboard/vehicle/:vehicleId", ManagerCheck, DeleteVehicle)
router.get("/dashboard/categories", ManagerCheck, GetVehicleCategories)
router.get("/dashboard/staff/activity-logs", ManagerCheck, GetStaffAuditLogs)
router.get("/dashboard/reports/insurance-expiry", ManagerCheck, GetInsuranceExpiryReport)
router.get("/dashboard/employees", ManagerCheck, SearchEmployee)
router.get("/dashboard/employees/:employeeId", ManagerCheck, GetEmployee)
router.post("/dashboard/employees", ManagerCheck, CreateEmployee)
router.put("/dashboard/employees/:employeeId", ManagerCheck, UpdateEmployee)
router.get("/dashboard/deposit-rules", ManagerCheck, GetDepositRules)
router.post("/dashboard/deposit-rules", ManagerCheck, CreateDepositRule)
router.put("/dashboard/deposit-rules/:id", ManagerCheck, UpdateDepositRule)
router.delete("/dashboard/deposit-rules/:id", ManagerCheck, DeleteDepositRule)

export default router