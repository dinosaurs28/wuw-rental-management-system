import { Router } from "express";
import { Login } from "../../controller/employee/login.controller";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares";
import { BookingController } from "../../controller/employee/booking.controller";

const router:Router=Router()

router.post("/auth/login",Login)
router.get("/booking",EmployeeCheck,BookingController)

export default router