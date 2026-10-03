import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger, ExtensionStatus } from "@repo/database/client";
import { extensionService, ExtensionPendingError } from "../../services/extension/index.js";
import {
  evaluateExtensionSchema,
  commitExtensionSchema,
  cancelExtensionSchema,
  listExtensionsSchema,
} from "@repo/schemas";
import {
  assertOpenShift,
  CounterGuardError,
} from "../../services/payment/counter-guard.service.js";
import { resolveCounterUpi, type CounterUpi } from "../../services/payment/payment-proof.service.js";
import { parseCollateral } from "../../services/payment/customer-credit.service.js";
import { extensionSplitView } from "../../services/extension/extension-pricing.service.js";
import { describeExtensionFreeKm } from "../../services/charges/extension-km.js";
import { EXTENSION_IN_SESSION } from "../../services/extension/extension.service.js";
import {
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
} from "../../services/tax/gst.service.js";
import { BookingWindowError } from "../../utils/booking/bookingWindow.js";
import { BranchScheduleError } from "../../utils/booking/branchScheduleValidator.js";
import { DlInUseError } from "../../services/booking/dl-in-use.service.js";
import { UpiQrError } from "../../services/payment/upi-qr.service.js";
import {
  buildExtensionLimits,
  maxPeriodReachedMessage,
  EXTENDABLE_BOOKING_STATUSES,
} from "../../services/extension/extension-limits.service.js";

// ONLINE / UPI = UPI at the counter (merchant QR), backed by a photo of the
// customer's payment screen (proof_file_id) or, from older builds, the 12-digit
// UTR in onlineTransactionRef. SPLIT = cashAmount + onlineAmount (UPI part backed
// the same way). CREDIT = the amount stays owed against the collateral noted.
// Cash, UPI and split all wait for the branch manager's confirmation (#12).
const collectExtensionSchema = z.object({
  method: z.enum(["CASH", "ONLINE", "UPI", "SPLIT", "CREDIT"]),
  onlineTransactionRef: z.string().optional(),
  proof_file_id: z.string().trim().min(1).max(64).optional(),
  cashAmount: z.coerce.number().min(0).optional(),
  onlineAmount: z.coerce.number().min(0).optional(),
  collateral: z.string().optional(),
});

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorPublicId: req.public_Id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

/**
 * POST /api/employee/extensions/evaluate
 * Employee evaluates an extension for a booking they are handling.
 */
export const EvaluateExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = evaluateExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { bookingPublicId, newEndAt, notes } = validation.data;

    // Determine trigger from booking status
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingPublicId, branchId: req.branch_Id },
      select: { status: true },
    });

    if (!booking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    const trigger =
      booking.status === BookingStatus.PICKED_UP
        ? ExtensionTrigger.EMPLOYEE_DURING_RENTAL
        : ExtensionTrigger.EMPLOYEE_AT_PICKUP;

    const actor = await buildActorContext(req);
    const evaluation = await extensionService.evaluate(bookingPublicId, newEndAt, trigger, actor, notes);

    res.status(StatusCode.OK).json({
      message: "Extension evaluated successfully",
      data: evaluation,
    });
  } catch (error: any) {
    // A committed or paid extension blocks new quotes — the app offers to cancel it
    if (error instanceof ExtensionPendingError) {
      res.status(StatusCode.CONFLICT).json(error.toJSON());
      return;
    }
    // 15-day limit (BOOKING_MAX_PERIOD_EXCEEDED) / office hours (BRANCH_SCHEDULE_VIOLATION)
    if (error instanceof BookingWindowError || error instanceof BranchScheduleError) {
      res.status(StatusCode.BAD_REQUEST).json(error.toJSON());
      return;
    }
    // The added time overlaps another booking on the same driving licence (X3)
    if (error instanceof DlInUseError) {
      res.status(error.status).json(error.toJSON("staff"));
      return;
    }
    if (isGstRuleMissing(error)) {
      res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
      return;
    }
    console.error("EvaluateExtension Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (
      error.message?.includes("Cannot extend") ||
      error.message?.includes("pending extension") ||
      error.message?.includes("after the current end date")
    ) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/employee/extensions/commit
 * Employee commits an extension by selecting resolution and providing payment.
 */
export const CommitExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = commitExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { collectNow, ...commitInput } = validation.data;

    const pending = await prisma.bookingExtension.findUnique({
      where: { publicId: commitInput.extensionPublicId },
      select: { branchId: true, additionalAmount: true, booking: { select: { status: true } } },
    });
    if (!pending || pending.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    // Branches on payment sessions add the charge to the pickup session
    // instead of collecting it via the collect endpoint — unless the client
    // collects now, or the car is already out (there is no pickup session left).
    const branchConfig = await prisma.branchChargeConfig.findUnique({
      where: { branchId: req.branch_Id },
      select: { usePaymentSessions: true },
    });
    const usePaymentSession =
      (branchConfig?.usePaymentSessions ?? false) &&
      collectNow !== true &&
      pending.booking.status !== BookingStatus.PICKED_UP;

    const actor = await buildActorContext(req);

    // No shift check here: the payment method is chosen after the commit, and
    // Credit takes no money (#11). Collect checks the open shift for cash, UPI
    // and split before any money is recorded.

    const { extension, remainAmount } = await extensionService.commit(commitInput, actor);

    res.status(StatusCode.OK).json({
      message: usePaymentSession
        ? "Extension committed — charge will be added to pickup payment session"
        : "Extension committed — vehicle held, collect payment to confirm",
      data: {
        publicId: extension.publicId,
        extensionStatus: extension.extensionStatus,
        resolutionType: extension.resolutionType,
        additionalAmount: new Decimal(extension.additionalAmount.toString()).toFixed(2),
        // GST split of additionalAmount (= taxableAmount + taxAmount), as committed
        ...extensionSplitView(extension),
        remainAmount,
        usePaymentSession,
        // Free km the committed extension adds to the drop allowance (#7)
        extensionFreeKm: await describeExtensionFreeKm(extension.bookingId, extension.oldEndAt, extension.requestedEndAt),
      },
    });
  } catch (error: any) {
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    if (error instanceof DlInUseError) {
      res.status(error.status).json(error.toJSON("staff"));
      return;
    }
    if (isGstRuleMissing(error)) {
      res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
      return;
    }
    console.error("CommitExtension Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Partial end")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    if (
      error.message?.includes("availability changed") ||
      error.message?.includes("being processed") ||
      error.message?.includes("cannot be committed")
    ) {
      res.status(StatusCode.CONFLICT).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/employee/extensions/:extensionPublicId/collect
 * Collect payment for an extension that is PENDING_PAYMENT.
 */
export const CollectExtensionPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = collectExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
      return;
    }
    // UPI is ONLINE through the counter UPI gateway
    const method = validation.data.method === "UPI" ? "ONLINE" : validation.data.method;

    const pending = await prisma.bookingExtension.findUnique({
      where: { publicId: req.params.extensionPublicId! },
      select: { branchId: true, additionalAmount: true, resolutionType: true },
    });
    if (!pending || pending.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }
    // Commit re-checks availability and holds the slot — never take money for a bare quote
    if (pending.resolutionType === null) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Commit the extension before collecting payment." });
      return;
    }

    const actor = await buildActorContext(req);

    // Counter money (cash or UPI) needs an open shift; a ₹0 extension takes none.
    // Credit takes no money — it needs the collateral note instead (#11).
    const due = new Decimal(pending.additionalAmount.toString());
    let upi: CounterUpi | null = null;
    let split: { cash: Decimal; online: Decimal } | undefined;
    let collateral: string | undefined;
    if (due.gt(0)) {
      if (method === "CREDIT") {
        collateral = parseCollateral(validation.data.collateral);
      } else {
        await assertOpenShift({ id: actor.actorId, role: actor.actorRole });
        if (method === "SPLIT") {
          const cash = new Decimal(validation.data.cashAmount ?? 0).toDecimalPlaces(2);
          const online = new Decimal(validation.data.onlineAmount ?? 0).toDecimalPlaces(2);
          if (!cash.add(online).eq(due) || cash.lte(0) || online.lte(0)) {
            throw new CounterGuardError(
              StatusCode.BAD_REQUEST,
              "SPLIT_AMOUNT_MISMATCH",
              `Enter a cash part and a UPI part that add up to ₹${due.toFixed(2)}.`,
            );
          }
          split = { cash, online };
        }
        if (method === "ONLINE" || method === "SPLIT") {
          upi = await resolveCounterUpi({
            utr: validation.data.onlineTransactionRef,
            proofFileId: validation.data.proof_file_id,
            branchId: req.branch_Id,
          });
        }
      }
    }

    const result = await extensionService.collect(
      req.params.extensionPublicId!,
      method,
      actor,
      upi?.utr ?? undefined,
      {
        onlineGateway: method === "ONLINE" || method === "SPLIT" ? "UPI" : undefined,
        upi,
        split,
        collateral,
      },
    );
    res.status(StatusCode.OK).json({
      message: result.credit
        ? `Extension confirmed — ₹${result.credit.amount} is on credit until the branch manager clears it`
        : result.payment === "confirmed"
          ? "Extension confirmed"
          : "Extension payment collected — awaiting manager confirmation",
      data: result,
    });
  } catch (error: any) {
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    // Already on an open pickup payment session — collecting here would charge twice
    if (error?.code === EXTENSION_IN_SESSION) {
      res.status(StatusCode.CONFLICT).json({ success: false, code: EXTENSION_IN_SESSION, message: error.message });
      return;
    }
    console.error("CollectExtensionPayment Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("already in")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    // Double-submitted collect: the per-extension idempotency key already exists
    if (error?.code === "P2002") {
      res.status(StatusCode.CONFLICT).json({ message: "Payment for this extension is already being recorded." });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/employee/extensions
 * Employee lists extensions for their branch (optionally filtered by bookingPublicId).
 */
export const ListBookingExtensions = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = listExtensionsSchema.safeParse(req.query);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { page, pageSize, status, bookingPublicId } = validation.data;
    const result = await extensionService.listForBranch(req.branch_Id, {
      page,
      pageSize,
      status: status as ExtensionStatus | undefined,
      bookingPublicId,
    });

    res.status(StatusCode.OK).json({
      message: "Extensions fetched successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("ListBookingExtensions Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/employee/extensions/:extensionPublicId/cancel
 * Employee cancels a pending extension.
 */
export const CancelExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const { extensionPublicId } = req.params;
    const validation = cancelExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const pending = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId! },
      select: { branchId: true },
    });
    if (!pending || pending.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    const actor = await buildActorContext(req);
    await extensionService.cancel(extensionPublicId!, actor, validation.data.reason);

    res.status(StatusCode.OK).json({ message: "Extension cancelled successfully" });
  } catch (error: any) {
    console.error("CancelExtension Error:", error);
    // The customer's UPI QR for it was paid (409 UPI_QR_ALREADY_PAID) or couldn't be closed (502)
    if (error instanceof UpiQrError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Cannot cancel")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/employee/extensions/eligibility/:bookingPublicId
 * How far a booking of this branch can be extended (15-day cap, monthly plan
 * up to 180 days) and the branch's office hours, so the extension pickers stop
 * at maxEndAt and only offer in-hours return times.
 */
export const GetExtensionEligibility = async (req: Request, res: Response): Promise<void> => {
  try {
    const { bookingPublicId } = req.params;
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingPublicId, branchId: req.branch_Id },
      select: { status: true, startAt: true, endAt: true, rentalPeriodType: true, branchId: true },
    });
    if (!booking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    const limits = await buildExtensionLimits(booking);
    const extendable = EXTENDABLE_BOOKING_STATUSES.includes(booking.status);
    const eligible = extendable && !limits.atCap;

    res.status(StatusCode.OK).json({
      message: "Extension eligibility fetched",
      data: {
        eligible,
        reason: !extendable
          ? `Extensions are only allowed for CONFIRMED or PICKED_UP bookings. Current status: ${booking.status}`
          : limits.atCap
            ? maxPeriodReachedMessage(limits)
            : null,
        ...limits,
      },
    });
  } catch (error: any) {
    console.error("GetExtensionEligibility (employee) Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
