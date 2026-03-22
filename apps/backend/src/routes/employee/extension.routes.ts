import { Router } from "express";
import { EmployeeCheck } from "../../middlewares/employeeCheck.middlewares.js";
import {
  EvaluateExtension,
  CommitExtension,
  CancelExtension,
} from "../../controller/employee/extension.controller.js";

const router: Router = Router();

router.post("/evaluate", EmployeeCheck, EvaluateExtension);
router.post("/commit", EmployeeCheck, CommitExtension);
router.post("/:extensionPublicId/cancel", EmployeeCheck, CancelExtension);

export default router;
