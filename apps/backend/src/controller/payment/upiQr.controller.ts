import { Request, Response } from "express";
import { z } from "zod";
import { StatusCode } from "../../types/statusCode.js";
import {
  closeUpiQrForCustomer,
  createBookingUpiQr,
  createExtensionUpiQr,
  getUpiQrStatus,
  isUpiQrEnabled,
  UpiQrError,
} from "../../services/payment/upi-qr.service.js";

/**
 * UPI QR payments for customers without a UPI app on their phone (TODO #2):
 * the QR is scanned from another phone. Customer-only (authCheckJwt).
 */

const createSchema = z
  .object({
    /** Booking (hold) publicId — the `holdId` returned when the booking was created. */
    bookingId: z.string().trim().min(1).optional(),
    /** BookingExtension publicId of a PENDING_PAYMENT customer extension. */
    extensionId: z.string().trim().min(1).optional(),
  })
  .refine((b) => Boolean(b.bookingId) !== Boolean(b.extensionId), {
    message: "Send exactly one of bookingId or extensionId",
  });

function actorOf(req: Request) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

function sendError(res: Response, tag: string, error: unknown) {
  if (error instanceof UpiQrError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(`[${tag}] ERROR:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong with the UPI QR payment. Please try again.",
  });
}

/**
 * GET /api/payment/upi-qr/availability
 * Whether clients should offer "Scan a UPI QR from another phone".
 */
export const GetUpiQrAvailability = (_req: Request, res: Response) => {
  return res.status(StatusCode.OK).json({ success: true, data: { enabled: isUpiQrEnabled() } });
};

/**
 * POST /api/payment/upi-qr  { bookingId } | { extensionId }
 * Creates (or reuses the still-open) single-use UPI QR for the payment.
 */
export const CreateUpiQr = async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_FAILED",
      message: parsed.error.issues[0]?.message ?? "Send exactly one of bookingId or extensionId",
    });
  }
  try {
    const view = parsed.data.bookingId
      ? await createBookingUpiQr(req.public_Id, parsed.data.bookingId, actorOf(req))
      : await createExtensionUpiQr(req.public_Id, parsed.data.extensionId!, actorOf(req));
    return res.status(view.reused ? StatusCode.OK : StatusCode.CREATED).json({ success: true, data: view });
  } catch (error) {
    return sendError(res, "CreateUpiQr", error);
  }
};

/**
 * GET /api/payment/upi-qr/:qrPaymentId
 * Status poll — checks Razorpay and confirms the booking/extension once paid.
 */
export const GetUpiQrStatus = async (req: Request, res: Response) => {
  try {
    const view = await getUpiQrStatus(req.public_Id, req.params.qrPaymentId!, actorOf(req));
    return res.status(StatusCode.OK).json({ success: true, data: view });
  } catch (error) {
    return sendError(res, "GetUpiQrStatus", error);
  }
};

/**
 * POST /api/payment/upi-qr/:qrPaymentId/close
 * The customer left the QR screen or chose another way to pay.
 */
export const CloseUpiQr = async (req: Request, res: Response) => {
  try {
    const view = await closeUpiQrForCustomer(req.public_Id, req.params.qrPaymentId!, actorOf(req));
    return res.status(StatusCode.OK).json({ success: true, data: view });
  } catch (error) {
    return sendError(res, "CloseUpiQr", error);
  }
};
