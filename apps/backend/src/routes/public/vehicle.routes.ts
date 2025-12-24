import { Router } from "express";
import { getPublicVehicles, getPublicVehiclesDetails } from "../../controller/public/vehicles.controller";
import { kycCheck } from "../../middlewares/kycCheck.middlewares";
import { createBookingSummary} from "../../controller/booking/getBookInfo.controller";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares";

const router:Router=Router()

router.get("/vehicles",getPublicVehicles)
router.get("/vehicles/:id",getPublicVehiclesDetails)
router.route("/vehicles/booking").all(authCheckJwt,kycCheck).post(createBookingSummary)

export default router