import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  EvaluateExtension,
  CommitExtension,
  CollectExtensionPayment,
  CancelExtension,
  ListBookingExtensions,
  GetExtensionEligibility,
} from "../../controller/employee/extension.controller.js";

const router: Router = Router();

router.get("/", EmployeeCheck, ListBookingExtensions);
router.get("/eligibility/:bookingPublicId", EmployeeCheck, GetExtensionEligibility);
router.post("/evaluate", EmployeeCheck, EvaluateExtension);
router.post("/commit", EmployeeCheck, CommitExtension);
router.post("/:extensionPublicId/collect", EmployeeCheck, CollectExtensionPayment);
router.post("/:extensionPublicId/cancel", EmployeeCheck, CancelExtension);

export default router;
