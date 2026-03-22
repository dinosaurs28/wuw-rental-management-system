import { prisma, SwapReason, VehicleSwap } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { VehicleSwapService } from "../vehicle-swap/vehicle-swap.service.js";
import { auditService } from "../audit/audit.service.js";
import { AuditCategory, AuditSeverity } from "@repo/database/client";

const vehicleSwapService = new VehicleSwapService();

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface ActorContext {
  actorId: number;
  actorPublicId: string;
  actorName: string;
  actorRole: string;
  actorBranchId: number;
}

class ExtensionVehicleAllocatorService {
  /**
   * Swap the current booking's vehicle to a new one using the existing
   * VehicleSwapService. Returns the VehicleSwap record.
   */
  async swapCurrentBookingVehicle(
    bookingPublicId: string,
    newVehicleId: number,
    actor: ActorContext,
  ): Promise<VehicleSwap> {
    const vehicleSwap = await vehicleSwapService.performVehicleSwap(
      bookingPublicId,
      newVehicleId,
      actor.actorId,
      SwapReason.CUSTOMER_REQUEST,
      "Extension vehicle swap — booking extended beyond current vehicle availability",
      false,
    );

    return vehicleSwap;
  }

  /**
   * Reassign a future (conflicting) booking's vehicle.
   * This operates within the provided Prisma transaction.
   * Creates a VehicleSwap record for auditability and flags the affected booking.
   */
  async swapFutureBookingVehicle(
    affectedBookingId: number,
    newVehiclePublicId: string,
    displacingExtensionId: number,
    actor: ActorContext,
    tx: PrismaTx,
  ): Promise<void> {
    // Load the affected booking with its current vehicle
    const booking = await tx.booking.findUnique({
      where: { id: affectedBookingId },
      include: { items: { select: { id: true, vehicleId: true } } },
    });
    if (!booking) throw new Error(`Affected booking ${affectedBookingId} not found`);

    const bookingItem = booking.items[0];
    if (!bookingItem) throw new Error(`No booking item for booking ${affectedBookingId}`);

    // Resolve new vehicle by publicId
    const newVehicle = await tx.vehicle.findUnique({
      where: { publicId: newVehiclePublicId },
      include: { category: true },
    });
    if (!newVehicle) throw new Error(`Vehicle ${newVehiclePublicId} not found`);

    const originalVehicle = await tx.vehicle.findUnique({
      where: { id: bookingItem.vehicleId },
      include: { category: true },
    });
    if (!originalVehicle) throw new Error("Original vehicle not found");

    // Validate no downgrade
    if (newVehicle.category.rank < originalVehicle.category.rank) {
      throw new Error(
        `Cannot assign ${newVehicle.publicId} to booking — it is a lower category than the original vehicle`,
      );
    }

    // Update the BookingItem to the new vehicle
    await tx.bookingItem.update({
      where: { id: bookingItem.id },
      data: { vehicleId: newVehicle.id },
    });

    // Mark the affected booking as displaced
    await tx.booking.update({
      where: { id: affectedBookingId },
      data: {
        extensionDisplacedAt: new Date(),
        displacedByExtensionId: displacingExtensionId,
      },
    });

    // Create a VehicleSwap record for auditability
    await tx.vehicleSwap.create({
      data: {
        publicId: createID(),
        bookingId: affectedBookingId,
        originalVehicleId: bookingItem.vehicleId,
        newVehicleId: newVehicle.id,
        swappedById: actor.actorId,
        reason: SwapReason.OTHER,
        reasonNotes: `Displaced by extension (extensionId: ${displacingExtensionId})`,
      },
    });

    // Audit log for the displaced booking
    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole as any,
      actorBranchId: actor.actorBranchId,
      action: "Future booking vehicle reassigned due to extension conflict",
      category: AuditCategory.VEHICLE,
      severity: AuditSeverity.WARNING,
      entity: "Booking",
      entityId: booking.publicId,
      description: `Vehicle changed from ${originalVehicle.regNo} to ${newVehicle.regNo} due to extension conflict`,
      metadata: {
        originalVehicleId: originalVehicle.publicId,
        newVehicleId: newVehicle.publicId,
        displacingExtensionId,
      },
    });
  }
}

export const extensionVehicleAllocatorService = new ExtensionVehicleAllocatorService();
export type { PrismaTx };
