import { Router } from "express";
import { getPublicVehicles, getPublicVehiclesDetails } from "../../controller/public/vehicles.controller";
import { kycCheck } from "../../middlewares/kycCheck.middlewares";
import { createBookingSummary} from "../../controller/booking/getBookInfo.controller";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares";
import { checkProfileCompletion } from "../../middlewares/profileCheck.middleware";
import { getPublicBranches } from "../../controller/public/getPublicBranches.controller";
const router:Router=Router()
router.get("/branches",getPublicBranches)
router.get("/vehicles",getPublicVehicles)
router.get("/vehicles/:id",getPublicVehiclesDetails)
router.route("/vehicles/booking").all(authCheckJwt, checkProfileCompletion, kycCheck).post(createBookingSummary)

export default router