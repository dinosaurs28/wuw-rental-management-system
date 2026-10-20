import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  VehicleStatus,
  BookingPhotoType,
} from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { createID } from "../../utils/nanoID.js";
import { captureOrderStart, orderByCapture } from "../../utils/photo-order.js";
import { notifyEvents } from "../../services/notification/notification.events.js";
import { pickUpVehicleSchema } from "@repo/schemas";
import { fastagBalanceField } from "../../services/charges/fastag-usage.js";
import { assertOpenShift, CounterGuardError } from "../../services/payment/counter-guard.service.js";
import {
  resolvePickupDlStatus,
  dlStatusUpdateData,
  dlValidationError,
  DlStatusError,
} from "../../services/booking/dl-status.service.js";
import { discardOperationDraft } from "../../services/booking/operation-draft.service.js";
import { cancelledPickupRefusal, lockBookingForPickup, PickupStateError } from "../../services/booking/booking-row-lock.js";
import { checkVehiclesReadyForPickup } from "../../utils/availability/outForRental.js";
import { z } from "zod";
import { fuelBarsField } from "../../services/charges/fuel-bars.js";
const chargePickupDataSchema = z.object({
  pickupFuelLevel: fuelBarsField.optional(),
  safetyDepositRequest: z.object({
    requestedAmount: z.coerce.number().positive(),
    reason: z.string().min(1),
  }).optional(),
});
import type { FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG } from "../../types/charge-engine.types.js";

export const PickupController = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;
  const parsedBody = pickUpVehicleSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const dlError = dlValidationError(parsedBody.error);
    if (dlError) return res.status(dlError.status).json(dlError.toJSON());
    const firstIssue = parsedBody.error.issues[0];
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_FAILED",
      message: firstIssue
        ? `Check the pickup details: ${firstIssue.path.join(".") || "request"} — ${firstIssue.message}`
        : "Check the pickup details and try again.",
      errors: parsedBody.error.format(),
    });
  }
  const parsedVehicleDetails = parsedBody.data;
  // FASTag balance at the handover (cars with a FASTag) — optional: older builds don't send it
  const parsedFastag = fastagBalanceField.safeParse(req.body?.pickupFastagBalance);
  if (!parsedFastag.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_FAILED",
      message: parsedFastag.error.issues[0]?.message ?? "Check the FASTag balance.",
    });
  }
  const pickupFastagBalance = parsedFastag.data;
  try {
    // The DL number is no longer asked at pickup (client, Oct 17 2026): a
    // `drivingLicenceNumber` older app builds still send is ignored.

    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingId,
        branchId: branchId,
      },
      include: {
        items: {
          select: { vehicleId: true },
        },
        customer: {
          select: {
            id: true,
            drivingLicenceNumber: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found or access denied",
      });
    }

    // Cancelled (e.g. by the branch manager): 409 BOOKING_CANCELLED
    const cancelled = cancelledPickupRefusal(booking);
    if (cancelled) return res.status(cancelled.status).json(cancelled.toJSON());

    if (booking.status !== BookingStatus.CONFIRMED) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot pick up vehicle. Current status: ${booking.status}`,
      });
    }

    // Advance payment gate: if customer chose to pay remaining at pickup, verify it's done
    if (
      booking.isAdvancePayment &&
      parsedVehicleDetails.payRemainingAtPickup === true &&
      !booking.remainingPaidAt
    ) {
      return res.status(StatusCode.PAYMENT_REQUIRED).json({
        message: `Remaining balance of ₹${booking.remainingBalance} must be collected before pickup.`,
        remainingBalance: booking.remainingBalance,
      });
    }

    // Original licence custody (#3), OPTIONAL (X1): COLLECTED / NOT_COLLECTED
    // (DEPOSIT is rejected: DL_STATUS_INVALID). Old builds send the boolean tick instead (true ⇒
    // COLLECTED, false ⇒ NOT_COLLECTED); sending neither (or dlStatus null)
    // leaves it unset — staff can record it later.
    const dlChoice = resolvePickupDlStatus(parsedVehicleDetails);

    const vehicleIds = booking.items.map((item) => item.vehicleId);

    // The car is listed for dates after its current rental, so a late return can
    // leave it still out: 409 VEHICLE_STILL_OUT until it is back (or swapped).
    // Only an AVAILABLE car is handed over: 409 VEHICLE_NOT_READY for damage
    // review, maintenance, inactive or a hand-set Out for Rental.
    const notReady = await checkVehiclesReadyForPickup(vehicleIds, booking.id);
    if (notReady) {
      return res.status(StatusCode.CONFLICT).json(notReady);
    }

    const actingUserPublicId = req.public_Id;
    const actingUser = await prisma.user.findUnique({
      where: { publicId: actingUserPublicId },
      select: { id: true, name: true, role: true, branchId: true },
    });

    if (!actingUser) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        message: "Unauthorized: User not found",
      });
    }

    // Parse charge engine pickup data from request body
    const chargePickupData = chargePickupDataSchema.safeParse(req.body);
    const frozenConfig = (booking.frozenChargeConfig as FrozenChargeConfig | null)
      ?? DEFAULT_FROZEN_CHARGE_CONFIG;

    // Validate fuel level if fuel module is enabled
    if (frozenConfig.fuelModuleEnabled) {
      if (!chargePickupData.success || !chargePickupData.data.pickupFuelLevel) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "pickupFuelLevel is required when fuel module is enabled",
        });
      }
    }

    // An auto-approved safety deposit is money taken at the counter now
    const depositRequest = chargePickupData.success
      ? chargePickupData.data.safetyDepositRequest
      : undefined;
    if (
      frozenConfig.safetyDepositEnabled &&
      depositRequest &&
      depositRequest.requestedAmount > 0 &&
      !frozenConfig.safetyDepositRequiresApproval
    ) {
      await assertOpenShift(actingUser);
    }

    // A re-sent pickup (e.g. after a manager-confirmation request) may change the
    // choice; licenseCollectedAt keeps the first time the licence was taken.
    const licenseCollected = dlChoice
      ? dlStatusUpdateData(dlChoice, actingUser.id, booking)
      : {};

    await prisma.$transaction(async (tx) => {
      // Booking row lock first (shared with the BM's manual cancel), then still
      // CONFIRMED? — a booking cancelled meanwhile is refused (409 BOOKING_CANCELLED)
      await lockBookingForPickup(tx, booking.id);

      if (parsedVehicleDetails.requireManagerConfirmation) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            requiresManagerConfirmation: true,
            ...licenseCollected,
          },
        });

        await tx.vehicle.updateMany({
          where: { id: { in: vehicleIds } },
          data: {
            odo: parsedVehicleDetails.odo,
            fuelLevel: parsedVehicleDetails.fuelLevel,
          },
        });
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.PICKED_UP,
            // A handover done here supersedes an earlier send-to-manager: PICKED_UP
            // with the flag left on would read as a recorded drop (isDropRecorded)
            requiresManagerConfirmation: false,
            ...licenseCollected,
          },
        });

        await tx.vehicle.updateMany({
          where: { id: { in: vehicleIds } },
          data: {
            status: VehicleStatus.OUT_FOR_RENTAL,
            odo: parsedVehicleDetails.odo,
            fuelLevel: parsedVehicleDetails.fuelLevel,
          },
        });
      }

      // The pickup is submitted (handed over, or sent to a manager): drop the
      // paused form saved for it (client item 2). After the booking update, so
      // a draft save racing this waits on the booking row lock.
      await discardOperationDraft(booking.id, "PICKUP", tx);

      // Unlabeled photos (legacy / fallback) and labeled capture images (from
      // capture config): one set, saved in the order the photos were taken
      // (photoOrder; older builds: as sent — the plain photos, then the labelled ones)
      const pickupPhotos: Array<{ fileId: string; label?: string }> = [];
      const fileMap = new Map<string, number>();
      if (
        parsedVehicleDetails.pickupImageIds &&
        parsedVehicleDetails.pickupImageIds.length > 0
      ) {
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: parsedVehicleDetails.pickupImageIds } },
          select: { id: true, publicId: true },
        });

        if (files.length !== parsedVehicleDetails.pickupImageIds.length) {
          throw new Error("Invalid pickup image IDs provided");
        }

        for (const f of files) fileMap.set(f.publicId, f.id);
        pickupPhotos.push(...parsedVehicleDetails.pickupImageIds.map((fileId) => ({ fileId })));
      }

      if (
        parsedVehicleDetails.captureImages &&
        parsedVehicleDetails.captureImages.length > 0
      ) {
        const fileIds = parsedVehicleDetails.captureImages.map((c) => c.fileId);
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: fileIds } },
          select: { id: true, publicId: true },
        });

        if (files.length !== fileIds.length) {
          throw new Error("Invalid capture image IDs provided");
        }

        for (const f of files) fileMap.set(f.publicId, f.id);
        pickupPhotos.push(...parsedVehicleDetails.captureImages);
      }

      if (pickupPhotos.length > 0) {
        const start = await captureOrderStart(tx, { bookingId: booking.id, type: BookingPhotoType.PRE_DELIVERY });
        await tx.bookingPhoto.createMany({
          data: orderByCapture(pickupPhotos, parsedVehicleDetails.photoOrder).map((p, i) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: fileMap.get(p.fileId)!,
            type: BookingPhotoType.PRE_DELIVERY,
            ...(p.label !== undefined && { captureLabel: p.label }),
            captureOrder: start + i,
          })),
        });
      }

      // ── Charge Engine: Capture pickup baseline data ───────────────────────

      // Record start odometer on booking
      if (parsedVehicleDetails.odo !== undefined) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { startOdometer: parsedVehicleDetails.odo },
        });
      }

      // FASTag balance at the handover — any car (a car not marked as having a
      // FASTag still counts as one for this booking once its balance is read)
      if (pickupFastagBalance !== undefined) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { pickupFastagBalance: pickupFastagBalance.toFixed(2) },
        });
      }

      // Create FuelRecord if fuel module is enabled
      if (
        frozenConfig.fuelModuleEnabled &&
        chargePickupData.success &&
        chargePickupData.data.pickupFuelLevel
      ) {
        // Upsert: an abandoned web pickup session may already have saved the
        // pickup fuel reading for this booking.
        await tx.fuelRecord.upsert({
          where: { bookingId: booking.id },
          create: {
            publicId: createID(),
            bookingId: booking.id,
            pickupFuelLevel: chargePickupData.data.pickupFuelLevel,
            capturedByPickupId: actingUser.id,
            pickupAt: new Date(),
          },
          update: {
            pickupFuelLevel: chargePickupData.data.pickupFuelLevel,
            capturedByPickupId: actingUser.id,
            pickupAt: new Date(),
          },
        });
      }

      // Create SafetyDepositRequest if safety deposit module is enabled and requested
      if (
        frozenConfig.safetyDepositEnabled &&
        chargePickupData.success &&
        chargePickupData.data.safetyDepositRequest
      ) {
        const { requestedAmount, reason } = chargePickupData.data.safetyDepositRequest;
        const requiresApproval = frozenConfig.safetyDepositRequiresApproval;

        await tx.safetyDepositRequest.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            requestedAmount: String(requestedAmount),
            reason,
            status: requiresApproval ? "PENDING_APPROVAL" : "APPROVED",
            requestedById: actingUser.id,
            approvedAmount: requiresApproval ? undefined : String(requestedAmount),
            approvedAt: requiresApproval ? undefined : new Date(),
          },
        });

        // If auto-approved, immediately update booking safety deposit
        if (!requiresApproval) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              safetyDeposit: { increment: requestedAmount },
              safetyDepositPaidAt: new Date(),
            },
          });

          // The deposit is cash taken at the counter now: record it (purpose
          // SAFETY_DEPOSIT — refundable, not revenue) on the staff member's open
          // shift so the drawer expects it, awaiting the manager's cash
          // confirmation like other counter cash. One per booking (the request is).
          const depositShift = await tx.cashShift.findFirst({
            where: { employeeId: actingUser.id, status: "OPEN" },
            select: { id: true },
          });
          await tx.paymentTransaction.create({
            data: {
              publicId: createID(),
              idempotencyKey: `safety-deposit:pickup:${booking.publicId}`,
              bookingId: booking.id,
              branchId: booking.branchId,
              purpose: "SAFETY_DEPOSIT",
              method: "CASH",
              status: "COLLECTED",
              totalAmount: requestedAmount.toFixed(2),
              cashAmount: requestedAmount.toFixed(2),
              onlineAmount: "0.00",
              collectedById: actingUser.id,
              collectedAt: new Date(),
              cashShiftId: depositShift?.id ?? null,
              notes: `Safety deposit: ${reason}`,
            },
          });
        }
      }
    });

    // Logging outside the transaction — neither audit nor activity logs need
    // to be atomic with the booking state change, and both add enough latency
    // to push the transaction past Prisma's 5 s interactive timeout.
    await staffActivityService.logFromRequest(req, {
      actionType: parsedVehicleDetails.requireManagerConfirmation ? StaffActionType.INITIATED : StaffActionType.CONFIRMED,
      entityType: StaffEntityType.BOOKING,
      entityRef: booking.publicId,
      description: parsedVehicleDetails.requireManagerConfirmation
        ? `Pickup approval requested for booking ${booking.publicId}`
        : `Vehicle pickup confirmed for booking ${booking.publicId}`,
      ...(dlChoice && {
        metadata: { dlStatus: dlChoice.dlStatus, dlDepositNote: dlChoice.dlDepositNote },
      }),
    });

    if (!parsedVehicleDetails.requireManagerConfirmation) {
      await auditService.log({
        actorId: actingUser.id,
        actorName: actingUser.name,
        actorRole: actingUser.role,
        actorBranchId: actingUser.branchId ?? undefined,
        action: "BOOKING_CHECKED_IN",
        category: AuditCategory.BOOKING,
        description: `Vehicle handed over to customer for booking ${booking.publicId}`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: {
          odo: parsedVehicleDetails.odo,
          fuelLevel: parsedVehicleDetails.fuelLevel,
          pickupFastagBalance: pickupFastagBalance ?? null,
          dlStatus: dlChoice?.dlStatus ?? null,
          dlDepositNote: dlChoice?.dlDepositNote ?? null,
        },
      });
    }

    void (parsedVehicleDetails.requireManagerConfirmation
      ? notifyEvents.pickupApprovalRequested({ bookingId: booking.id, actorUserId: actingUser.id })
      : notifyEvents.pickupCompleted({ bookingId: booking.id, actorUserId: actingUser.id }));
    void notifyEvents.safetyDepositRequested({ bookingId: booking.id, actorUserId: actingUser.id });

    return res.status(StatusCode.OK).json({
      message: parsedVehicleDetails.requireManagerConfirmation ? "Pickup sent to manager for confirmation." : "Vehicle Pickup Successful. Status updated to OUT_FOR_RENTAL.",
      data: {
        dlStatus: dlChoice?.dlStatus ?? booking.dlStatus ?? null,
        dlDepositNote: dlChoice ? dlChoice.dlDepositNote : booking.dlDepositNote ?? null,
        // The customer's DL number on file (kept for older builds; not asked at pickup)
        drivingLicenceNumber: booking.customer.drivingLicenceNumber ?? null,
      },
    });
  } catch (error) {
    if (error instanceof CounterGuardError) {
      return res.status(error.status).json(error.toJSON());
    }
    if (error instanceof DlStatusError) {
      return res.status(error.status).json(error.toJSON());
    }
    if (error instanceof PickupStateError) {
      return res.status(error.status).json(error.toJSON());
    }
    console.error("Pickup Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during Pickup",
    });
  }
};
