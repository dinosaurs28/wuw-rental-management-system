import { Router, type RequestHandler } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import {
  ListCustomers,
  GetCustomer,
  GetCustomerRents,
  GetCustomerBooking,
  BlacklistCustomer,
  RemoveCustomerBlacklist,
} from "../../controller/branchManager/customers.controller.js";

/**
 * Customers tab (item 13): every registered customer, their rents across
 * branches, pending credit and the blacklist. Same handlers, data and rules
 * for both portals; only the guard differs. Mounted at:
 *   /api/branchManager/customers  (branch manager — ManagerCheck)
 *   /api/employee/customers       (Fleet / STAFF — EmployeeCheck)
 */
export function makeCustomersRouter(guard: RequestHandler): Router {
  const router: Router = Router();

  router.get("/", guard, ListCustomers);
  router.get("/:customerId", guard, GetCustomer);
  router.get("/:customerId/rents", guard, GetCustomerRents);
  router.get("/:customerId/bookings/:bookingId", guard, GetCustomerBooking);
  router.post("/:customerId/blacklist", guard, BlacklistCustomer);
  router.post("/:customerId/unblacklist", guard, RemoveCustomerBlacklist);

  return router;
}

const customersRouter: Router = makeCustomersRouter(ManagerCheck);

export default customersRouter;
