import { Router } from "express";
import { getPublicVehicles } from "../../controller/vehicles.controller";

const router:Router=Router()

router.get("/vehicles",getPublicVehicles)
router.get("/vehicles/:id",)

export default router