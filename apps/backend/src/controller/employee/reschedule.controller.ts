import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  getRescheduleOptions,
  rescheduleBooking,
  RescheduleError,
} from "../../services/booking/reschedule.service.js";
import { BookingWindowError } from "../../utils/booking/bookingWindow.js";
import { DlInUseError } from "../../services/booking/dl-in-use.service.js";
import { TimezoneService } from "../../services/timezone/timezone.service.js";

const display = (iso: string) => TimezoneService.formatForDisplay(TimezoneService.fromJSDate(new Date(iso)), "full");

/** "Booking rescheduled — pickup 05 Oct 2026, 10:30 AM, return 06 Oct 2026, 10:30 AM." */
export function rescheduledMessage(result: { booking: { startAt: string; endAt: string } }): string {
  return `Booking rescheduled — pickup ${display(result.booking.startAt)}, return ${display(result.booking.endAt)}.`;
}

/** Shared error answer for the reschedule endpoints (Fleet + Branch Manager). */
export function sendRescheduleError(res: Response, error: unknown, label: string) {
  if (error instanceof RescheduleError) {
    return res.status(error.status).json(error.toJSON());
  }
  // 15-day window (BOOKING_MAX_PERIOD_EXCEEDED, + latestStartAt for WINDOW)
  if (error instanceof BookingWindowError) {
    return res.status(StatusCode.BAD_REQUEST).json(error.toJSON());
  }
  // Staff and managers see which booking holds the licence
  if (error instanceof DlInUseError) {
    return res.status(error.status).json(error.toJSON("staff"));
  }
  console.error(`${label} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Couldn't reschedule the booking. Please try again.",
  });
}

/**
 * GET /api/employee/bookings/:publicId/reschedule
 * What the Fleet reschedule sheet needs: whether the booking can move, its
 * length, the latest pickup, office hours and what is in the way.
 */
export const GetRescheduleOptions = async (req: Request, res: Response) => {
  try {
    const data = await getRescheduleOptions(req, req.params.publicId!);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendRescheduleError(res, error, "GetRescheduleOptions");
  }
};

/**
 * POST /api/employee/bookings/:publicId/reschedule  { newStartAt, reason? }
 * Fleet moves a confirmed booking of their branch (not picked up yet) to a new
 * pickup time; the return moves by the same amount, the price doesn't change.
 */
export const RescheduleBooking = async (req: Request, res: Response) => {
  try {
    const result = await rescheduleBooking(req, req.params.publicId!, "STAFF");
    return res.status(StatusCode.OK).json({
      success: true,
      message: rescheduledMessage(result),
      data: result,
    });
  } catch (error) {
    return sendRescheduleError(res, error, "RescheduleBooking");
  }
};
