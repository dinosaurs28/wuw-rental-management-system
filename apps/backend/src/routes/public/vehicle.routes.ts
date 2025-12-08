import { Router } from "express";
import { getPublicVehicles, getPublicVehiclesDetails } from "../../controller/public/vehicles.controller";

const router:Router=Router()

router.get("/vehicles",getPublicVehicles)
router.get("/vehicles/:id",getPublicVehiclesDetails)

export default router