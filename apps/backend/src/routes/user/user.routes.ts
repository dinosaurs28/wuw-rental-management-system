import { Router } from "express";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares";
import { getUserBookings } from "../../controller/booking/getBookUserInfo.controller";

const router:Router=Router()

router.get("/booking",authCheckJwt,getUserBookings)

export default router