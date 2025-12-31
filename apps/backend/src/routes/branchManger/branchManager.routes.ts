import { Router } from "express";
import { Login } from "../../controller/branchManager/login.controller";

const router:Router=Router()

router.post("/auth/login",Login)

export default router