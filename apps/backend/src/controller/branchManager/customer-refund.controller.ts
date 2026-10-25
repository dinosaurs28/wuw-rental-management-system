import { Request, Response } from "express";
import fs from "fs/promises";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { PaymentProofError, savePaymentProof } from "../../services/payment/payment-proof.service.js";
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

/**
 * POST /api/admin/bookings/:publicId/refund-proof (multipart "file") — Oct 25 2026.
 * The admin's photo of a refund's payment-success screen (a UPI / bank transfer
 * "Refund to customer" now needs one). Stored like a branch payment proof, under
 * the booking's branch, so the refund request accepts it as its proofFileId.
 */
export const AdminUploadRefundProof = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "FILE_REQUIRED",
        message: "Attach the photo of the refund's payment-success screen in the 'file' field.",
      });
    }
    const booking = await prisma.booking.findFirst({
      where: { publicId: req.params.publicId!, deletedAt: null },
      select: { branchId: true },
    });
    if (!booking) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    }
    const proof = await savePaymentProof({
      tmpPath: req.file.path,
      branchId: booking.branchId,
      uploaderPublicId: req.public_Id,
    });
    return res.status(StatusCode.CREATED).json({ success: true, message: "Refund photo saved", data: proof });
  } catch (err) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    if (err instanceof PaymentProofError) return res.status(err.status).json(err.toJSON());
    console.error("[customer-refund] AdminUploadRefundProof:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "PAYMENT_PROOF_FAILED",
      message: "Could not save the refund photo. Please try again.",
    });
  }
};
