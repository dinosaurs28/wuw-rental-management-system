import { Router } from "express";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";
import { getUserBookings } from "../../controller/booking/getBookUserInfo.controller.js";
import { getUserBookingHistory, GetCancellationHistory } from "../../controller/user/getUserBookingHistory.controller.js";
import {
  getUserProfile,
  updateUserProfile,
} from "../../controller/user/userProfile.controller.js";
import {
  GetKycDocuments,
  UploadKycDocument,
  DeleteKycDocument,
} from "../../controller/user/kyc.controller.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { checkPaymentForCash } from "../../controller/payment/checkPaymentForCash.controller.js";
const router: Router = Router();

router.get("/booking", authCheckJwt, getUserBookings);
router.get("/booking/history", authCheckJwt, getUserBookingHistory);
router.get("/cancellation-history", authCheckJwt, GetCancellationHistory);
router
  .route("/profile")
  .all(authCheckJwt)
  .get(getUserProfile)
  .put(updateUserProfile);
router.get("/kyc", authCheckJwt, GetKycDocuments);
router.post("/kyc", authCheckJwt, upload.single("file"), UploadKycDocument);
router.delete("/kyc", authCheckJwt, DeleteKycDocument);
router.post("/payment/cash", authCheckJwt, checkPaymentForCash);

export default router;
