import { prisma, SwapReason, VehicleSwap } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { VehicleSwapService, type PreparedSwap } from "../vehicle-swap/vehicle-swap.service.js";
import { auditService } from "../audit/audit.service.js";
import { AuditCategory, AuditSeverity, BookingStatus } from "@repo/database/client";
import { classifyReplacements, swapWindowFor } from "../vehicle-swap/swap-replacements.js";
import { swapUnavailableMessage } from "../vehicle-swap/swap-availability.js";

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
   * The SWAP_CURRENT_TO_OTHER swap, checked and priced before the extension's
   * transaction (VehicleSwapService.prepareSwap, source EXTENSION: readings
   * optional, the difference never billed — the company moved the customer to
   * free the original car). The replacement must be free until the extended
   * end (`availabilityEndAt`), not just the current end.
   */
  async prepareCurrentBookingSwap(
    bookingPublicId: string,
    newVehicleId: number,
    actor: ActorContext,
    availabilityEndAt: Date,
  ): Promise<PreparedSwap> {
    return vehicleSwapService.prepareSwap({
      bookingPublicId,
      newVehicleId,
      swappedById: actor.actorId,
      reason: SwapReason.CUSTOMER_REQUEST,
      reasonNotes: "Extension vehicle swap — booking extended beyond current vehicle availability",
      markOriginalForMaintenance: false,
      branchId: actor.actorBranchId,
      availabilityEndAt,
      source: "EXTENSION",
    });
  }

  /**
   * Runs the prepared swap inside the extension commit's transaction: booking
   * row lock, FOR UPDATE on both vehicle rows and the swap availability rule
   * over [now, extended end (+ grace)] re-checked under them, then the move.
   * The caller extends the booking in the same transaction and calls
   * afterCurrentBookingSwap once it has committed.
   */
  async applyCurrentBookingSwap(tx: PrismaTx, prepared: PreparedSwap): Promise<VehicleSwap> {
    return vehicleSwapService.applySwap(tx, prepared);
  }

  /** After the extension commit's transaction: caches and the swap notification. */
  async afterCurrentBookingSwap(prepared: PreparedSwap, swap: Pick<VehicleSwap, "id">): Promise<void> {
    await vehicleSwapService.afterSwapCommit(prepared, swap);
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
    // Lock order: booking row, then vehicle rows by id — as the swap path
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${affectedBookingId} FOR UPDATE`;
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

    // Moving the booking is a vehicle swap: same branch and type, a booking not
    // yet picked up, and the car free for the booking's window by the swap rule
    // — checked with both vehicle rows locked (id order, as every booking and
    // swap path locks them), so a concurrent swap or booking can't take it too.
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new Error(`Booking ${booking.publicId} is ${booking.status} — its vehicle can't be reassigned`);
    }
    if (
      newVehicle.branchId !== booking.branchId ||
      newVehicle.deletedAt ||
      newVehicle.category.typeClass !== originalVehicle.category.typeClass
    ) {
      throw new Error(`${newVehicle.regNo} can't be assigned to booking ${booking.publicId}`);
    }
    for (const id of [newVehicle.id, originalVehicle.id].sort((a, b) => a - b)) {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${id} FOR UPDATE`;
    }
    const lockedNew = await tx.vehicle.findUniqueOrThrow({ where: { id: newVehicle.id }, include: { category: true } });
    const now = new Date();
    const { excluded } = await classifyReplacements([lockedNew], {
      booking,
      currentRank: originalVehicle.category.rank,
      window: await swapWindowFor(booking, now, null, tx),
      now,
      db: tx,
    });
    if (excluded[0]) {
      throw new Error(swapUnavailableMessage(lockedNew.regNo, excluded[0].exclusion));
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
