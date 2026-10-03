import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  ListCustomers,
  GetCustomer,
  GetCustomerRents,
  GetCustomerBooking,
  BlacklistCustomer,
  RemoveCustomerBlacklist,
} from "../../controller/branchManager/customers.controller.js";

// Customers tab (item 13): every registered customer, their rents across
// branches, pending credit and the blacklist. Mounted at /api/branchManager/customers.
const customersRouter: Router = Router();

customersRouter.get("/", ManagerCheck, ListCustomers);
customersRouter.get("/:customerId", ManagerCheck, GetCustomer);
customersRouter.get("/:customerId/rents", ManagerCheck, GetCustomerRents);
customersRouter.get("/:customerId/bookings/:bookingId", ManagerCheck, GetCustomerBooking);
customersRouter.post("/:customerId/blacklist", ManagerCheck, BlacklistCustomer);
customersRouter.post("/:customerId/unblacklist", ManagerCheck, RemoveCustomerBlacklist);

export default customersRouter;
