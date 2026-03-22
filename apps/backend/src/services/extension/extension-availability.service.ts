import { prisma, BookingStatus, Vehicle, VehicleStatus } from "@repo/database/client";

export interface ConflictingBooking {
  bookingId: number;
  bookingPublicId: string;
  startAt: Date;
  endAt: Date;
  vehicleId: number;
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
   * excluding the booking that is being extended.
   */
  async checkVehicleAvailability(
    vehicleId: number,
    fromAt: Date,
    toAt: Date,
    excludeBookingId: number,
  ): Promise<AvailabilityResult> {
    const conflicts = await prisma.bookingItem.findMany({
      where: {
        vehicleId,
        booking: {
          id: { not: excludeBookingId },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
          // Overlap condition: NOT (booking.endAt <= fromAt OR booking.startAt >= toAt)
          AND: [
            { endAt: { gt: fromAt } },
            { startAt: { lt: toAt } },
          ],
        },
      },
      select: {
        vehicleId: true,
        booking: {
          select: {
            id: true,
            publicId: true,
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
    }));

    return {
      available: conflictingBookings.length === 0,
      conflictingBookings,
    };
  }

  /**
   * Find alternative vehicles of same or higher category that are not booked
   * during the specified window.
   */
  async findAlternativeVehicles(
    branchId: number,
    minCategoryRank: number,
    fromAt: Date,
    toAt: Date,
    excludeVehicleIds: number[],
  ): Promise<AlternativeVehicle[]> {
    // Get vehicles of same/higher category not currently booked in the window
    const vehicles = await prisma.vehicle.findMany({
      where: {
        branchId,
        status: VehicleStatus.AVAILABLE,
        deletedAt: null,
        id: { notIn: excludeVehicleIds },
        category: { rank: { gte: minCategoryRank } },
        // Exclude vehicles that have conflicting bookings in the window
        bookingItems: {
          none: {
            booking: {
              status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
              AND: [{ endAt: { gt: fromAt } }, { startAt: { lt: toAt } }],
            },
          },
        },
      },
      include: { category: true },
      orderBy: [{ category: { rank: "asc" } }, { make: "asc" }],
    });

    return vehicles.map((v) => ({
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
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP] },
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
