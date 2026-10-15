import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { getManualCancelOptions, manualCancelBooking } from "../../services/booking/manual-cancel.service.js";
import { ManualCancelError } from "../../services/booking/manual-cancel-rules.js";

function sendManualCancelError(res: Response, error: unknown, label: string) {
  if (error instanceof ManualCancelError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(`${label} Error:`, error);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Couldn't cancel the rent. Please try again.",
  });
}

/**
 * GET /api/branchManager/bookings/:publicId/cancel
 * What the Fleet tab's "Cancel rent" dialog needs: the rent, what was paid and
 * refunded, and whether it can be cancelled now (or why not).
 */
export const GetManualCancelOptions = async (req: Request, res: Response) => {
  try {
    const data = await getManualCancelOptions(req, req.params.publicId!);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendManualCancelError(res, error, "GetManualCancelOptions");
  }
};

/**
 * POST /api/branchManager/bookings/:publicId/cancel
 *   { reason, refund: { amount, method?, note? }, vehicleReturned?, vehicleStatus?, odometer? }
 * The Branch Manager cancels an upcoming or active rent of their branch by hand.
 */
export const ManualCancelBooking = async (req: Request, res: Response) => {
  try {
    const result = await manualCancelBooking(req, req.params.publicId!);
    return res.status(StatusCode.OK).json({
      success: true,
      message: !result.refund
        ? "Rent cancelled."
        : result.refund.status === "APPROVED"
          ? `Rent cancelled. ₹${result.refund.amount} refund to the original payment approved — refund it in Razorpay, then complete it in Payments → Refunds with the Razorpay refund id.`
          : `Rent cancelled. ₹${result.refund.amount} refunded (${result.refund.methodLabel}).`,
      data: result,
    });
  } catch (error) {
    return sendManualCancelError(res, error, "ManualCancelBooking");
  }
};
