import { Request, Response } from "express";
import { adminCreateBookingLockSchema } from "@repo/schemas";
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
 * Booking locks for any branch (AdminCheck) — the branch manager's endpoints
 * with the branch named: ?branchId= on reads, body.branchId on create /
 * preview; cancel by the lock's publicId.
 */

const requestMeta = (req: Request) => ({ ipAddress: req.ip, userAgent: req.headers["user-agent"] });

/** ?branchId= as a positive integer, or null (400 BRANCH_REQUIRED sent). */
function queryBranchId(req: Request, res: Response): number | null {
  const branchId = Number(req.query.branchId);
  if (Number.isInteger(branchId) && branchId > 0) return branchId;
  res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "BRANCH_REQUIRED", message: "Pick a branch" });
  return null;
}

/** GET /admin/booking-locks?branchId=&filter=current|past|all */
export const AdminListBookingLocks = async (req: Request, res: Response) => {
  try {
    const branchId = queryBranchId(req, res);
    if (branchId == null) return;
    const data = await listBookingLocks(branchId, bookingLockListFilter(req.query.filter));
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "AdminListBookingLocks");
  }
};

/** GET /admin/booking-locks/options?branchId= */
export const AdminGetBookingLockOptions = async (req: Request, res: Response) => {
  try {
    const branchId = queryBranchId(req, res);
    if (branchId == null) return;
    const data = await bookingLockOptions(branchId);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "AdminGetBookingLockOptions");
  }
};

/** POST /admin/booking-locks/preview — body.branchId required. */
export const AdminPreviewBookingLock = async (req: Request, res: Response) => {
  try {
    const parsed = adminCreateBookingLockSchema.safeParse(req.body);
    if (!parsed.success) return invalidBookingLockBody(res, parsed.error.issues);
    const data = await previewBookingLock(parsed.data.branchId, parsed.data);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendBookingLockError(res, error, "AdminPreviewBookingLock");
  }
};

/** POST /admin/booking-locks — body.branchId required. */
export const AdminCreateBookingLock = async (req: Request, res: Response) => {
  try {
    const parsed = adminCreateBookingLockSchema.safeParse(req.body);
    if (!parsed.success) return invalidBookingLockBody(res, parsed.error.issues);
    const actor = await bookingLockActor(req.public_Id);
    const data = await createBookingLock(parsed.data.branchId, parsed.data, actor, requestMeta(req));
    return res.status(StatusCode.CREATED).json({ success: true, message: "Bookings locked", data });
  } catch (error) {
    return sendBookingLockError(res, error, "AdminCreateBookingLock");
  }
};

/** POST /admin/booking-locks/:publicId/cancel — any branch. */
export const AdminCancelBookingLock = async (req: Request, res: Response) => {
  try {
    const actor = await bookingLockActor(req.public_Id);
    const data = await cancelBookingLock(String(req.params.publicId), actor, undefined, requestMeta(req));
    return res.status(StatusCode.OK).json({ success: true, message: "Booking lock cancelled", data });
  } catch (error) {
    return sendBookingLockError(res, error, "AdminCancelBookingLock");
  }
};
