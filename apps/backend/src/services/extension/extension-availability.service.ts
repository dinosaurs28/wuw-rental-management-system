import { prisma, BookingStatus, Prisma, VehicleTypeClass } from "@repo/database/client";
import { listOverlappingHolds } from "../../utils/availability/availabilityBatch.js";
import {
  classifyReplacements,
  swapWindowFor,
  type SwapWindowBooking,
} from "../vehicle-swap/swap-replacements.js";

export interface ConflictingBooking {
  bookingId: number;
  bookingPublicId: string;
  startAt: Date;
  endAt: Date;
  vehicleId: number;
  /**
   * HOLD = a checkout in progress (an unexpired HOLD booking or a customer's
   * Redis hold) — it can't be moved to another car, only waited out.
   */
  kind?: "BOOKING" | "HOLD";
}

export interface AvailabilityResult {
  available: boolean;
  conflictingBookings: ConflictingBooking[];
}

export interface AlternativeVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
}

class ExtensionAvailabilityService {
  /**
   * Check if a specific vehicle is available for the given window,
   * excluding the booking that is being extended. Checkouts in progress count:
   * the car is listed for dates right after a rental, so a customer may be
   * paying for that window (unexpired HOLD booking / Redis hold) while the
   * renter extends over it.
   */
  async checkVehicleAvailability(
    vehicleId: number,
    fromAt: Date,
    toAt: Date,
    excludeBookingId: number,
    // Read through this transaction (it holds the vehicle row lock) — the commit's re-check
    db: Prisma.TransactionClient = prisma,
  ): Promise<AvailabilityResult> {
    const now = new Date();
    const conflicts = await db.bookingItem.findMany({
      where: {
        vehicleId,
        booking: {
          id: { not: excludeBookingId },
          OR: [
            { status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] } },
            { status: BookingStatus.HOLD, holdExpiresAt: { gt: now } },
          ],
          // Overlap condition: NOT (booking.endAt <= fromAt OR booking.startAt >= toAt)
          AND: [
            { endAt: { gt: fromAt } },
            { startAt: { lt: toAt } },
          ],
        },
      },
      select: {
        vehicleId: true,
        vehicle: { select: { publicId: true } },
        booking: {
          select: {
            id: true,
            publicId: true,
            status: true,
            startAt: true,
            endAt: true,
          },
        },
      },
    });

    const conflictingBookings: ConflictingBooking[] = conflicts.map((item) => ({
      bookingId: item.booking.id,
      bookingPublicId: item.booking.publicId,
      startAt: item.booking.startAt,
      endAt: item.booking.endAt,
      vehicleId: item.vehicleId,
      kind: item.booking.status === BookingStatus.HOLD ? "HOLD" : "BOOKING",
    }));

    // Customer checkouts (Redis holds) — never the extended booking's own
    const [vehicle, extended] = await Promise.all([
      conflicts[0]?.vehicle ?? db.vehicle.findUnique({ where: { id: vehicleId }, select: { publicId: true } }),
      db.booking.findUnique({ where: { id: excludeBookingId }, select: { publicId: true } }),
    ]);
    if (vehicle) {
      const holds = await listOverlappingHolds(
        new Map([[vehicleId, vehicle.publicId]]),
        fromAt,
        toAt,
        new Set(extended ? [extended.publicId] : []),
      );
      const known = new Set(conflictingBookings.map((c) => c.bookingPublicId));
      const fresh = holds.filter((h) => !known.has(h.holdId));
      if (fresh.length > 0) {
        const rows = await db.booking.findMany({
          where: { publicId: { in: fresh.map((h) => h.holdId) } },
          select: { id: true, publicId: true },
        });
        const idOf = new Map(rows.map((r) => [r.publicId, r.id]));
        for (const h of fresh) {
          conflictingBookings.push({
            bookingId: idOf.get(h.holdId) ?? 0,
            bookingPublicId: h.holdId,
            startAt: h.startAt,
            endAt: h.endAt,
            vehicleId,
            kind: "HOLD",
          });
        }
      }
    }

    return {
      available: conflictingBookings.length === 0,
      conflictingBookings,
    };
  }

  /**
   * Cars `booking` could be moved onto: the vehicle swap rule
   * (classifyReplacements — same branch and vehicle type, same or higher
   * category, insurance through the end, free by the customer booking rule
   * from max(now, booking start) to its end, or `availabilityEndAt` when later
   * — the extended end). The swap itself re-checks the pick under its locks.
   */
  async findAlternativeVehicles(params: {
    booking: SwapWindowBooking;
    currentVehicle: { id: number; typeClass: VehicleTypeClass; categoryRank: number };
    availabilityEndAt?: Date;
    excludeVehicleIds?: number[];
  }): Promise<AlternativeVehicle[]> {
    const now = new Date();
    const window = await swapWindowFor(params.booking, now, params.availabilityEndAt);
    const fleet = await prisma.vehicle.findMany({
      where: {
        branchId: params.booking.branchId,
        deletedAt: null,
        id: { notIn: [params.currentVehicle.id, ...(params.excludeVehicleIds ?? [])] },
        category: { typeClass: params.currentVehicle.typeClass },
      },
      include: { category: true },
      orderBy: [{ category: { rank: "asc" } }, { make: "asc" }],
    });
    const { free } = await classifyReplacements(fleet, {
      booking: params.booking,
      currentRank: params.currentVehicle.categoryRank,
      window,
      now,
    });

    return free.map((v) => ({
      id: v.id,
      publicId: v.publicId,
      make: v.make,
      model: v.model,
      regNo: v.regNo,
      categoryId: v.categoryId,
      categoryName: v.category.name,
      categoryRank: v.category.rank,
    }));
  }

  /**
   * Compute the latest datetime before which the vehicle is free,
   * starting from `fromAt`. Returns null if not available at all.
   */
  async getMaxAvailableEndAt(
    vehicleId: number,
    fromAt: Date,
    excludeBookingId: number,
  ): Promise<Date | null> {
    const nextConflict = await prisma.bookingItem.findFirst({
      where: {
        vehicleId,
        booking: {
          id: { not: excludeBookingId },
          OR: [
            { status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] } },
            // A checkout in progress for a later window
            { status: BookingStatus.HOLD, holdExpiresAt: { gt: new Date() } },
          ],
          startAt: { gt: fromAt },
        },
      },
      orderBy: { booking: { startAt: "asc" } },
      select: { booking: { select: { startAt: true } } },
    });

    if (!nextConflict) {
      // No future bookings — vehicle is free indefinitely from fromAt
      return null; // caller interprets null as "unlimited"
    }

    return nextConflict.booking.startAt;
  }
}

export const extensionAvailabilityService = new ExtensionAvailabilityService();
