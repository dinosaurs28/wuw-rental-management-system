import { Router } from "express";
import {
  getPublicVehicles,
  getPublicVehiclesDetails,
} from "../../controller/public/vehicles.controller.js";
import { kycCheck } from "../../middlewares/kycCheck.middlewares.js";
import { createBookingSummary } from "../../controller/booking/getBookInfo.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";
import { checkProfileCompletion } from "../../middlewares/profileCheck.middleware.js";
import { getPublicBranches } from "../../controller/public/getPublicBranches.controller.js";
const router: Router = Router();
router.get("/branches", getPublicBranches);
router.get("/vehicles", getPublicVehicles);
router.get("/vehicles/:id", getPublicVehiclesDetails);
router
  .route("/vehicles/booking")
  .all(authCheckJwt, checkProfileCompletion, kycCheck)
  .post(createBookingSummary);

export default router;
