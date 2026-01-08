import { Router } from "express";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares";
import { getUserBookings } from "../../controller/booking/getBookUserInfo.controller";
import { getUserProfile, updateUserProfile } from "../../controller/user/userProfile.controller";
const router:Router=Router()

router.get("/booking", authCheckJwt, getUserBookings)
router.route("/profile").all(authCheckJwt).get(getUserProfile).put(updateUserProfile)


export default router