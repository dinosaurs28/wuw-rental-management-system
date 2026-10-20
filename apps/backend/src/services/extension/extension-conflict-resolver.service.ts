import { prisma, BookingStatus } from "@repo/database/client";
import {
  extensionAvailabilityService,
  type ConflictingBooking,
  type AlternativeVehicle,
} from "./extension-availability.service.js";
import { ExtensionResolutionType } from "@repo/database/client";
import { SWAP_WINDOW_BOOKING_SELECT } from "../vehicle-swap/swap-replacements.js";
import { bufferBefore, latestReturnFor, partialExtensionEnd } from "./partial-extension.js";
import { EXTENSION_BUFFER_HOURS, EXTENSION_BUFFER_MS } from "@repo/schemas";

export interface ResolutionOption {
  type: ExtensionResolutionType;
  description: string;
  // SWAP_CURRENT_TO_OTHER
  alternativeVehicles?: AlternativeVehicle[];
  // SWAP_FUTURE_BOOKING
  futureBookingSwaps?: Array<{
    bookingId: number;
    bookingPublicId: string;
    currentVehicleId: number;
    alternatives: AlternativeVehicle[];
  }>;
  // PARTIAL_EXTENSION
  partialNewEndAt?: Date;
  conflictingBookings?: ConflictingBooking[];
}

export interface ConflictResolutionOptions {
  options: ResolutionOption[];
  recommendedOption: ExtensionResolutionType;
  conflictingBookings: ConflictingBooking[];
}

class ExtensionConflictResolverService {
  async resolve(
    bookingId: number,
    currentVehicleId: number,
    currentCategoryRank: number,
    branchId: number,
    currentEndAt: Date,
    newEndAt: Date,
  ): Promise<ConflictResolutionOptions> {
    const options: ResolutionOption[] = [];

    // 1. Check if the same vehicle is available for extended period — free
    // until EXTENSION_BUFFER_HOURS after the new end (its next pickup at least
    // 2 hours later), the rule the commit re-checks
    const availability = await extensionAvailabilityService.checkVehicleAvailability(
      currentVehicleId,
      currentEndAt,
      newEndAt,
      bookingId,
    );

    if (availability.available) {
      options.push({
        type: ExtensionResolutionType.SAME_VEHICLE,
        description: `Current vehicle is available for the extended duration (with ${EXTENSION_BUFFER_HOURS} hours before its next booking).`,
      });
      return {
        options,
        recommendedOption: ExtensionResolutionType.SAME_VEHICLE,
        conflictingBookings: [],
      };
    }

    // Vehicle not available — compute resolution alternatives
    const conflictingBookings = availability.conflictingBookings;

    // 2. Can we swap the current booking to another vehicle? The swap happens
    // now, so the replacement must be free from now (or the start) through the
    // extended end, with its next pickup at least EXTENSION_BUFFER_HOURS later
    // — the swap rule with the extension buffer, as the commit re-checks it
    const [booking, currentVehicle] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: SWAP_WINDOW_BOOKING_SELECT }),
      prisma.vehicle.findUniqueOrThrow({
        where: { id: currentVehicleId },
        select: { id: true, category: { select: { typeClass: true } } },
      }),
    ]);
    const alternativesForCurrent = await extensionAvailabilityService.findAlternativeVehicles({
      booking,
      currentVehicle: {
        id: currentVehicle.id,
        typeClass: currentVehicle.category.typeClass,
        categoryRank: currentCategoryRank,
      },
      availabilityEndAt: newEndAt,
      turnaroundMs: EXTENSION_BUFFER_MS,
    });

    if (alternativesForCurrent.length > 0) {
      options.push({
        type: ExtensionResolutionType.SWAP_CURRENT_TO_OTHER,
        description: "Swap current vehicle to an available equivalent or higher-category vehicle.",
        alternativeVehicles: alternativesForCurrent,
        conflictingBookings,
      });
    }

    // 3. Can we swap the conflicting future booking(s) to other vehicles?
    const futureSwapOptions = await this.computeFutureBookingSwaps(
      conflictingBookings,
      branchId,
    );

    if (futureSwapOptions !== null) {
      options.push({
        type: ExtensionResolutionType.SWAP_FUTURE_BOOKING,
        description: "Reassign conflicting future booking(s) to other available vehicles.",
        futureBookingSwaps: futureSwapOptions,
        conflictingBookings,
      });
    }

    // 4. Partial extension — up to EXTENSION_BUFFER_HOURS before the first
    // conflict of the same list the commit re-checks (bookings, rentals,
    // checkouts incl. Redis holds), rounded down to the picker grid, so an
    // offered partial never fails as "availability changed"
    const partialEnd = partialExtensionEnd(currentEndAt, newEndAt, conflictingBookings);
    if (partialEnd) {
      // What sets the partial end: a booking lock (the return may be right up to
      // its start) or a booking / checkout (EXTENSION_BUFFER_HOURS before it)
      const limitedByLockOnly = conflictingBookings
        .filter(
          (c) =>
            c.startAt.getTime() < newEndAt.getTime() + bufferBefore(c) &&
            latestReturnFor(c).getTime() === partialEnd.getTime(),
        )
        .every((c) => c.kind === "LOCK");
      options.push({
        type: ExtensionResolutionType.PARTIAL_EXTENSION,
        description: limitedByLockOnly
          ? `Extend partially until ${partialEnd.toISOString()} (the latest return before the booking lock on the vehicle starts — no buffer before a lock).`
          : `Extend partially until ${partialEnd.toISOString()} (${EXTENSION_BUFFER_HOURS} hours before the vehicle's next booking).`,
        partialNewEndAt: partialEnd,
        conflictingBookings,
      });
    }

    // 5. No resolution
    if (options.length === 0) {
      options.push({
        type: ExtensionResolutionType.NO_RESOLUTION,
        description: "No extension is possible for the requested dates.",
        conflictingBookings,
      });
    }

    const recommended =
      options[0]?.type ?? ExtensionResolutionType.NO_RESOLUTION;

    return { options, recommendedOption: recommended, conflictingBookings };
  }

  private async computeFutureBookingSwaps(
    conflictingBookings: ConflictingBooking[],
    branchId: number,
  ): Promise<Array<{
    bookingId: number;
    bookingPublicId: string;
    currentVehicleId: number;
    alternatives: AlternativeVehicle[];
  }> | null> {
    const result = [];

    for (const conflict of conflictingBookings) {
      // A checkout in progress isn't a booking to reassign — only waited out;
      // nor is a booking lock (it stays where the branch manager put it)
      if (conflict.kind === "HOLD" || conflict.kind === "LOCK") return null;

      // The conflicting booking's car (type and category it must keep)
      const [vehicle, conflictBooking] = await Promise.all([
        prisma.vehicle.findUnique({
          where: { id: conflict.vehicleId },
          include: { category: true },
        }),
        prisma.booking.findUnique({ where: { id: conflict.bookingId }, select: SWAP_WINDOW_BOOKING_SELECT }),
      ]);
      if (!vehicle || !conflictBooking || conflictBooking.branchId !== branchId) return null;

      // Moving that booking is a swap too: the same rule over its own window
      const alternatives = await extensionAvailabilityService.findAlternativeVehicles({
        booking: conflictBooking,
        currentVehicle: {
          id: vehicle.id,
          typeClass: vehicle.category.typeClass,
          categoryRank: vehicle.category.rank,
        },
      });

      if (alternatives.length === 0) return null; // Can't resolve all conflicts

      result.push({
        bookingId: conflict.bookingId,
        bookingPublicId: conflict.bookingPublicId,
        currentVehicleId: conflict.vehicleId,
        alternatives,
      });
    }

    return result;
  }
}

export const extensionConflictResolverService = new ExtensionConflictResolverService();
