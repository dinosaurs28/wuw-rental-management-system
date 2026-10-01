import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  GetEmployeeDashboardStats,
  GetEmployeeOverdueReturns,
} from "../../controller/employee/dashboard.controller.js";

const router: Router = Router();

router.get("/stats", EmployeeCheck, GetEmployeeDashboardStats);
router.get("/overdue-returns", EmployeeCheck, GetEmployeeOverdueReturns);

export default router;
