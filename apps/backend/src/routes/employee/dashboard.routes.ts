import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import { GetEmployeeDashboardStats } from "../../controller/employee/dashboard.controller.js";

const router: Router = Router();

router.get("/stats", EmployeeCheck, GetEmployeeDashboardStats);

export default router;
