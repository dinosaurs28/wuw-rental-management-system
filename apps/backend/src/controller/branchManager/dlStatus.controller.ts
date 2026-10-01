import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  updateBookingDlStatus,
  DlStatusError,
} from "../../services/booking/dl-status.service.js";

/**
 * PATCH /api/branchManager/bookings/:publicId/dl-status
 * Branch Manager verifies / corrects the original-licence status of any
 * booking at their branch, whatever its status (including after the drop).
 */
export const UpdateBookingDlStatusByManager = async (req: Request, res: Response) => {
  try {
    const result = await updateBookingDlStatus(req, req.params.publicId!, "MANAGER");
    return res.status(StatusCode.OK).json({
      success: true,
      message: result.changed ? "DL status updated" : "DL status unchanged",
      data: { ...result.booking, changed: result.changed },
    });
  } catch (error) {
    if (error instanceof DlStatusError) {
      return res.status(error.status).json(error.toJSON());
    }
    console.error("UpdateBookingDlStatusByManager Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Couldn't update the DL status. Please try again.",
    });
  }
};
