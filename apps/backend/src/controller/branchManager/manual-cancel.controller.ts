import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { getManualCancelOptions, manualCancelBooking } from "../../services/booking/manual-cancel.service.js";
import { ManualCancelError } from "../../services/booking/manual-cancel-rules.js";
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";

function sendManualCancelError(res: Response, error: unknown, label: string) {
  // CounterGuardError: a bad refund photo (INVALID_PAYMENT_PROOF / DUPLICATE_PAYMENT_PROOF)
  if (error instanceof ManualCancelError || error instanceof CounterGuardError) {
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
 *   { reason, refund: { amount, method?, note? }, vehicleLocation?, vehicleStatus?, odometer? }
 *   (active rents: vehicleLocation AT_BRANCH | OUT_OF_BRANCH; legacy vehicleReturned: true = AT_BRANCH)
 * The Branch Manager cancels an upcoming or active rent of their branch by hand.
 */
export const ManualCancelBooking = async (req: Request, res: Response) => {
  try {
    const result = await manualCancelBooking(req, req.params.publicId!);
    const refundMessage = !result.refund
      ? "Rent cancelled."
      : result.refund.status === "APPROVED"
        ? `Rent cancelled. ₹${result.refund.amount} refund to the original payment approved — refund it in Razorpay, then complete it in Payments → Refunds with the Razorpay refund id.`
        : `Rent cancelled. ₹${result.refund.amount} refunded (${result.refund.methodLabel}).`;
    return res.status(StatusCode.OK).json({
      success: true,
      // Cars whose status the cancel left alone (another rental / damage review) are named
      message: result.vehicleNote ? `${refundMessage} ${result.vehicleNote}` : refundMessage,
      data: result,
    });
  } catch (error) {
    return sendManualCancelError(res, error, "ManualCancelBooking");
  }
};
