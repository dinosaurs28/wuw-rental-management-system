import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  EvaluateExtension,
  CommitExtension,
  CancelExtension,
  ListBranchExtensions,
  GetExtensionDetail,
  GetDisplacedBookings,
  ResolveDisplacedBooking,
} from "../../controller/branchManager/extension.controller.js";

const router: Router = Router();

router.use(ManagerCheck);

router.get("/", ListBranchExtensions);
router.get("/displaced-bookings", GetDisplacedBookings);
router.post("/displaced-bookings/:bookingPublicId/resolve", ResolveDisplacedBooking);
router.get("/:extensionPublicId", GetExtensionDetail);
router.post("/evaluate", EvaluateExtension);
router.post("/commit", CommitExtension);
router.post("/:extensionPublicId/cancel", CancelExtension);

export default router;
