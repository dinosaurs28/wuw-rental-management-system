import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares";
import { GetRevenueStats } from "../../controller/branchManager/revenue.controller";
import { GetActiveBookings, GetPendingApprovals } from "../../controller/branchManager/bookings.controller";
import { GetDamageReports, CloseDamageReport, GetMinimalDamageReport, GetDamageReportList } from "../../controller/branchManager/damage.controller";
import { AddVehicle, EditVehicle, GetInsuranceExpiryReport, GetVehicleById } from "../../controller/branchManager/vehicle.controller";
import { GetStaffAuditLogs } from "../../controller/branchManager/audit.controller";
import { CreateEmployee, GetEmployee, SearchEmployee, UpdateEmployee } from "../../controller/branchManager/employee.controller";
import { upload } from "../../middlewares/upload.middleware";

const router:Router=Router()

router.post("/auth/login", Login)
router.get("/dashboard/revenue", ManagerCheck, GetRevenueStats)
router.get("/dashboard/bookings/active", ManagerCheck, GetActiveBookings)
router.get("/dashboard/bookings/pending", ManagerCheck, GetPendingApprovals)
router.get("/dashboard/damage-reports", ManagerCheck, GetDamageReports)
router.get("/damage-reports", ManagerCheck, GetDamageReportList)
router.get("/damage-reports/:damageReportId", ManagerCheck, GetMinimalDamageReport)
router.patch("/damage-reports/:damageReportId/close", ManagerCheck, CloseDamageReport)
router.post("/dashboard/vehicle/add", ManagerCheck, upload.array('images', 5), AddVehicle)
router.put("/dashboard/vehicle/edit/:vehicleId", ManagerCheck, upload.array('images', 5), EditVehicle)
router.get("/dashboard/vehicle/:vehicleId", ManagerCheck, GetVehicleById)
router.get("/dashboard/staff/activity-logs", ManagerCheck, GetStaffAuditLogs)
router.get("/dashboard/reports/insurance-expiry", ManagerCheck, GetInsuranceExpiryReport)
router.get("/dashboard/employees", ManagerCheck, SearchEmployee)
router.get("/dashboard/employees/:employeeId", ManagerCheck, GetEmployee)
router.post("/dashboard/employees", ManagerCheck, CreateEmployee)
router.put("/dashboard/employees/:employeeId", ManagerCheck, UpdateEmployee)

export default router