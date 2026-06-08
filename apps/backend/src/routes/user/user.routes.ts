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
// import { checkPaymentForCash } from "../../controller/payment/checkPaymentForCash.controller.js"; // Cash payment — temporarily disabled
import { cancelHold } from "../../controller/booking/cancelHold.controller.js";
import {
  EvaluateExtension as CustomerEvaluateExtension,
  CommitExtension as CustomerCommitExtension,
  CancelExtension as CustomerCancelExtension,
  GetExtensionEligibility,
  InitiateExtensionPayment,
} from "../../controller/customer/extension.controller.js";
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
// router.post("/payment/cash", authCheckJwt, checkPaymentForCash); // Cash payment — temporarily disabled
router.delete("/booking/hold/:holdId", authCheckJwt, cancelHold);

// Customer extension routes
router.get("/bookings/:bookingPublicId/extension-eligibility", authCheckJwt, GetExtensionEligibility);
router.post("/bookings/:bookingPublicId/extensions/evaluate", authCheckJwt, CustomerEvaluateExtension);
router.post("/extensions/commit", authCheckJwt, CustomerCommitExtension);
router.post("/extensions/:extensionPublicId/cancel", authCheckJwt, CustomerCancelExtension);
router.post("/extensions/:extensionPublicId/initiate-payment", authCheckJwt, InitiateExtensionPayment);

export default router;
