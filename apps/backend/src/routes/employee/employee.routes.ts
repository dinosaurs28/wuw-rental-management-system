import { Router } from "express";
import { Login } from "../../controller/employee/login.controller";

const router:Router=Router()

router.post("/auth/login",Login)

export default router