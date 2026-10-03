import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { getRescheduleOptions, rescheduleBooking } from "../../services/booking/reschedule.service.js";
import { rescheduledMessage, sendRescheduleError } from "../employee/reschedule.controller.js";

/**
 * GET /api/branchManager/bookings/:publicId/reschedule
 * Same as the Fleet endpoint, for a booking at the manager's branch.
 */
export const GetRescheduleOptionsByManager = async (req: Request, res: Response) => {
  try {
    const data = await getRescheduleOptions(req, req.params.publicId!);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendRescheduleError(res, error, "GetRescheduleOptionsByManager");
  }
};

/**
 * POST /api/branchManager/bookings/:publicId/reschedule  { newStartAt, reason? }
 * The Branch Manager moves a confirmed booking (not picked up yet) of their
 * branch; the return moves by the same amount, the price doesn't change.
 */
export const RescheduleBookingByManager = async (req: Request, res: Response) => {
  try {
    const result = await rescheduleBooking(req, req.params.publicId!, "MANAGER");
    return res.status(StatusCode.OK).json({
      success: true,
      message: rescheduledMessage(result),
      data: result,
    });
  } catch (error) {
    return sendRescheduleError(res, error, "RescheduleBookingByManager");
  }
};
