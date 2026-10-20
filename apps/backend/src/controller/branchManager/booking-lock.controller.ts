import { Request, Response } from "express";
import { createBookingLockSchema } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import {
  bookingLockActor,
  bookingLockListFilter,
  bookingLockOptions,
  cancelBookingLock,
  createBookingLock,
  invalidBookingLockBody,
  listBookingLocks,
  previewBookingLock,
  sendBookingLockError,
} from "../../services/booking-lock/booking-lock.service.js";

/**
 * Booking locks — the manager's own branch (ManagerCheck: req.branch_Id). A
 * lock keeps cars from new bookings for a date-time window
 * (services/booking-lock/booking-lock.service.ts).
 */

const requestMeta = (req: Request) => ({ ipAddress: req.ip, userAgent: req.headers["user-agent"] });

/** GET /branchManager/booking-locks?filter=current|past|all */
export const ListBookingLocks = async (req: Request, res: Response) => {
  try {
    const data = await listBookingLocks(req.branch_Id, bookingLockListFilter(req.query.filter));
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "ListBookingLocks");
  }
};

/** GET /branchManager/booking-locks/options — the branch's vehicles and vehicle groups. */
export const GetBookingLockOptions = async (req: Request, res: Response) => {
  try {
    const data = await bookingLockOptions(req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "GetBookingLockOptions");
  }
};

/** POST /branchManager/booking-locks/preview — vehicles covered and the existing bookings inside the window. */
export const PreviewBookingLock = async (req: Request, res: Response) => {
  try {
    const parsed = createBookingLockSchema.safeParse(req.body);
    if (!parsed.success) return invalidBookingLockBody(res, parsed.error.issues);
    const data = await previewBookingLock(req.branch_Id, parsed.data);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "PreviewBookingLock");
  }
};

/** POST /branchManager/booking-locks */
export const CreateBookingLock = async (req: Request, res: Response) => {
  try {
    const parsed = createBookingLockSchema.safeParse(req.body);
    if (!parsed.success) return invalidBookingLockBody(res, parsed.error.issues);
    const actor = await bookingLockActor(req.public_Id);
    const data = await createBookingLock(req.branch_Id, parsed.data, actor, requestMeta(req));
    return res.status(StatusCode.CREATED).json({ success: true, message: "Bookings locked", data });
  } catch (error) {
    return sendBookingLockError(res, error, "CreateBookingLock");
  }
};

/** POST /branchManager/booking-locks/:publicId/cancel */
export const CancelBookingLock = async (req: Request, res: Response) => {
  try {
    const actor = await bookingLockActor(req.public_Id);
    const data = await cancelBookingLock(String(req.params.publicId), actor, req.branch_Id, requestMeta(req));
    return res.status(StatusCode.OK).json({ success: true, message: "Booking lock cancelled", data });
  } catch (error) {
    return sendBookingLockError(res, error, "CancelBookingLock");
  }
};
