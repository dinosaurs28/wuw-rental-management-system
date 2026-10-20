import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { listBookingPayments, staffScopeFromRequest, voidPayment, type PaymentStaffScope } from "../../services/payment/payment-void.service.js";
import { PaymentVoidError } from "../../services/payment/payment-void-rules.js";

function sendPaymentVoidError(res: Response, error: unknown, label: string, fallback: string) {
  if (error instanceof PaymentVoidError) return res.status(error.status).json(error.toJSON());
  console.error(`${label} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ success: false, code: "INTERNAL_ERROR", message: fallback });
}

/**
 * Void a payment (Oct 2026) — reverse a wrong entry. The branch manager
 * (ManagerCheck) and Fleet Executive (EmployeeCheck) act on their branch, the
 * admin (AdminCheck) on any branch; they share these handlers.
 *
 *   GET  …/bookings/:publicId/payments                 payment history + void state
 *   POST …/payments/:transactionPublicId/void          { reason }
 */
const makeHandlers = (role: PaymentStaffScope["role"]) => ({
  list: async (req: Request, res: Response) => {
    try {
      const data = await listBookingPayments(req, staffScopeFromRequest(req, role), req.params.publicId!);
      return res.status(StatusCode.OK).json({ success: true, data });
    } catch (error) {
      return sendPaymentVoidError(res, error, "ListBookingPayments", "Couldn't load the payments. Please try again.");
    }
  },
  void: async (req: Request, res: Response) => {
    try {
      const data = await voidPayment(req, staffScopeFromRequest(req, role), req.params.transactionPublicId!);
      const message =
        `${data.isRefund ? "Refund" : "Payment"} of ₹${data.amount} voided. ${data.effect}` +
        (data.warning ? ` ${data.warning}.` : "");
      return res.status(StatusCode.OK).json({ success: true, message, data });
    } catch (error) {
      return sendPaymentVoidError(res, error, "VoidPayment", "Couldn't void the payment. Please try again.");
    }
  },
});

const manager = makeHandlers("MANAGER");
const admin = makeHandlers("ADMIN");
const staff = makeHandlers("STAFF");

export const ListBookingPayments = manager.list;
export const VoidPayment = manager.void;
export const AdminListBookingPayments = admin.list;
export const AdminVoidPayment = admin.void;
export const EmployeeListBookingPayments = staff.list;
export const EmployeeVoidPayment = staff.void;
