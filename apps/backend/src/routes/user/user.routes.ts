import { Router } from "express";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares";
import { getUserBookings } from "../../controller/booking/getBookUserInfo.controller";
import { getUserBookingHistory } from "../../controller/user/getUserBookingHistory.controller";
import { getUserProfile, updateUserProfile } from "../../controller/user/userProfile.controller";
import { GetKycDocuments, UploadKycDocument, DeleteKycDocument } from "../../controller/user/kyc.controller";
import { upload } from "../../middlewares/upload.middleware";
import { checkPaymentForCash } from "../../controller/payment/checkPaymentForCash.controller";
const router:Router=Router()

router.get("/booking", authCheckJwt, getUserBookings)
router.get("/booking/history", authCheckJwt, getUserBookingHistory)
router.route("/profile").all(authCheckJwt).get(getUserProfile).put(updateUserProfile)
router.get("/kyc", authCheckJwt, GetKycDocuments)
router.post("/kyc", authCheckJwt, upload.single('file'), UploadKycDocument)
router.delete("/kyc/:id", authCheckJwt, DeleteKycDocument)
router.post("/payment/cash", authCheckJwt, checkPaymentForCash)

export default router