import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  IssueCreditNote,
  GetBookingCreditNotes,
} from "../../controller/branchManager/creditNote.controller.js";

const creditNoteRouter: Router = Router();

creditNoteRouter.post("/", ManagerCheck, IssueCreditNote);
creditNoteRouter.get("/:bookingPublicId", ManagerCheck, GetBookingCreditNotes);

export default creditNoteRouter;
