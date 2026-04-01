import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  SearchCustomersWithCredit,
  GetCustomerCreditSummary,
  GetCustomerCreditEntries,
  GetEligibleBookingsForCredit,
  GetBookingChargesForCredit,
  AddOrAppendCredit,
  GetCreditEntry,
  ClearCreditSections,
} from "../../controller/branchManager/ledger.controller.js";

const ledgerRouter:Router = Router();

ledgerRouter.get("/customers", ManagerCheck, SearchCustomersWithCredit);
ledgerRouter.get("/customer/:customerId", ManagerCheck, GetCustomerCreditSummary);
ledgerRouter.get("/customer/:customerId/entries", ManagerCheck, GetCustomerCreditEntries);
ledgerRouter.get("/customer/:customerId/bookings", ManagerCheck, GetEligibleBookingsForCredit);
ledgerRouter.get("/booking/:bookingId/charges", ManagerCheck, GetBookingChargesForCredit);
ledgerRouter.post("/booking/:bookingId/credit", ManagerCheck, AddOrAppendCredit);
ledgerRouter.get("/entry/:creditId", ManagerCheck, GetCreditEntry);
ledgerRouter.post("/entry/:creditId/clear", ManagerCheck, ClearCreditSections);

export default ledgerRouter;
