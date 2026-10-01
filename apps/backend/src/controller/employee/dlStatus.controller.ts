import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  updateBookingDlStatus,
  DlStatusError,
} from "../../services/booking/dl-status.service.js";

/**
 * PATCH /api/employee/bookings/:publicId/dl-status
 * Fleet updates the original-licence status (e.g. the customer brought the
 * licence after pickup). Own branch, booking CONFIRMED or PICKED_UP only.
 */
export const UpdateBookingDlStatus = async (req: Request, res: Response) => {
  try {
    const result = await updateBookingDlStatus(req, req.params.publicId!, "STAFF");
    return res.status(StatusCode.OK).json({
      success: true,
      message: result.changed ? "DL status updated" : "DL status unchanged",
      data: { ...result.booking, changed: result.changed },
    });
  } catch (error) {
    if (error instanceof DlStatusError) {
      return res.status(error.status).json(error.toJSON());
    }
    console.error("UpdateBookingDlStatus Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't update the DL status. Please try again.",
    });
  }
};
