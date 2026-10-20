import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  getCustomerRefundOptions,
  recordCustomerRefund,
  scopeFromRequest,
} from "../../services/booking/customer-refund.service.js";
import { CustomerRefundError } from "../../services/booking/customer-refund-rules.js";
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";

function sendCustomerRefundError(res: Response, error: unknown, label: string) {
  if (error instanceof CustomerRefundError || error instanceof CounterGuardError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(`${label} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Couldn't record the refund. Please try again.",
  });
}

/**
 * "Refund to customer" (Oct 2026) — any booking, any status, any amount, paid out
 * now by cash / UPI / bank transfer. The branch manager (own branch, ManagerCheck),
 * the Fleet Executive (own branch, EmployeeCheck) and the admin (any branch,
 * AdminCheck) share these handlers.
 *
 *   GET  …/bookings/:publicId/refund-to-customer   what the dialog needs
 *   POST …/bookings/:publicId/refund-to-customer
 *        { amount, method, reason, reference?, proofFileId?, confirmOverReceived?, requestId? }
 */
const makeHandlers = (role: "MANAGER" | "ADMIN" | "STAFF") => ({
  get: async (req: Request, res: Response) => {
    try {
      const data = await getCustomerRefundOptions(req, scopeFromRequest(req, role), req.params.publicId!);
      return res.status(StatusCode.OK).json({ success: true, data });
    } catch (error) {
      return sendCustomerRefundError(res, error, "GetCustomerRefundOptions");
    }
  },
  post: async (req: Request, res: Response) => {
    try {
      const data = await recordCustomerRefund(req, scopeFromRequest(req, role), req.params.publicId!);
      const message =
        `₹${data.amount} refunded to the customer (${data.methodLabel}).` +
        (data.cashOutsideShift ? " No cash shift was open, so it is recorded outside a shift." : "");
      return res.status(StatusCode.CREATED).json({ success: true, message, data });
    } catch (error) {
      return sendCustomerRefundError(res, error, "RecordCustomerRefund");
    }
  },
});

const manager = makeHandlers("MANAGER");
const admin = makeHandlers("ADMIN");

export const GetCustomerRefundOptions = manager.get;
export const RecordCustomerRefund = manager.post;
export const AdminGetCustomerRefundOptions = admin.get;
export const AdminRecordCustomerRefund = admin.post;
// Oct 2026: the Fleet Executive (EmployeeCheck), own branch
const staff = makeHandlers("STAFF");
export const EmployeeGetCustomerRefundOptions = staff.get;
export const EmployeeRecordCustomerRefund = staff.post;
