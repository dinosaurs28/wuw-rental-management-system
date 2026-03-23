import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  KycType,
  KycStatus,
  VehicleStatus,
  BookingPhotoType,
} from "@repo/database/client";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory } from "../../services/audit/audit.service.js";
import { createID } from "../../utils/nanoID.js";
import { pickUpVehicleSchema } from "@repo/schemas";
import { z } from "zod";
const chargePickupDataSchema = z.object({
  pickupFuelLevel: z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]).optional(),
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
  const parsedVehicleDetails = pickUpVehicleSchema.parse(req.body);
  try {
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
            kycs: {
              where: {
                type: KycType.DL,
                status: KycStatus.APPROVED,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found or access denied",
      });
    }

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

    if (!booking.customer.kycs || booking.customer.kycs.length === 0) {
      return res.status(StatusCode.FORBIDDEN).json({
        message:
          "Pickup Denied: Customer does not have an APPROVED Driving License (DL).",
      });
    }

    const vehicleIds = booking.items.map((item) => item.vehicleId);

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

    await prisma.$transaction(async (tx) => {
      if (parsedVehicleDetails.requireManagerConfirmation) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            requiresManagerConfirmation: true,
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

      // Unlabeled photos (legacy / fallback)
      if (
        parsedVehicleDetails.pickupImageIds &&
        parsedVehicleDetails.pickupImageIds.length > 0
      ) {
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: parsedVehicleDetails.pickupImageIds } },
        });

        if (files.length !== parsedVehicleDetails.pickupImageIds.length) {
          throw new Error("Invalid pickup image IDs provided");
        }

        await tx.bookingPhoto.createMany({
          data: files.map((f) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: f.id,
            type: BookingPhotoType.PRE_DELIVERY,
          })),
        });
      }

      // Labeled capture images (from capture config)
      if (
        parsedVehicleDetails.captureImages &&
        parsedVehicleDetails.captureImages.length > 0
      ) {
        const fileIds = parsedVehicleDetails.captureImages.map((c) => c.fileId);
        const files = await tx.fileObject.findMany({
          where: { publicId: { in: fileIds } },
        });

        if (files.length !== fileIds.length) {
          throw new Error("Invalid capture image IDs provided");
        }

        const fileMap = new Map(files.map((f) => [f.publicId, f]));

        await tx.bookingPhoto.createMany({
          data: parsedVehicleDetails.captureImages.map((c) => ({
            publicId: createID(),
            bookingId: booking.id,
            fileId: fileMap.get(c.fileId)!.id,
            type: BookingPhotoType.PRE_DELIVERY,
            captureLabel: c.label,
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

      // Create FuelRecord if fuel module is enabled
      if (
        frozenConfig.fuelModuleEnabled &&
        chargePickupData.success &&
        chargePickupData.data.pickupFuelLevel
      ) {
        await tx.fuelRecord.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
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
        }
      }

      await staffActivityService.logFromRequest(req, {
        actionType: parsedVehicleDetails.requireManagerConfirmation ? StaffActionType.INITIATED : StaffActionType.CONFIRMED,
        entityType: StaffEntityType.BOOKING,
        entityRef: booking.publicId,
        description: parsedVehicleDetails.requireManagerConfirmation
          ? `Pickup approval requested for booking ${booking.publicId}`
          : `Vehicle pickup confirmed for booking ${booking.publicId}`,
      }, tx);

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
          metadata: { odo: parsedVehicleDetails.odo, fuelLevel: parsedVehicleDetails.fuelLevel },
        }, tx);
      }
    });

    return res.status(StatusCode.OK).json({
      message: parsedVehicleDetails.requireManagerConfirmation ? "Pickup sent to manager for confirmation." : "Vehicle Pickup Successful. Status updated to OUT_FOR_RENTAL.",
    });
  } catch (error) {
    console.error("Pickup Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error during Pickup",
    });
  }
};
