import { prisma, VehicleTypeClass, BookingStatus } from "@repo/database/client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimum shape of a vehicle object required by this utility.
 *  Both booking controllers satisfy this via `include: { category: true }`. */
export interface VehicleWithTypeClass {
  id: number;
  make: string;
  model: string;
  category: {
    typeClass: VehicleTypeClass;
  };
}

export interface TypeClassConflict {
  typeClass: VehicleTypeClass;
  /** publicId of the existing booking that blocks the new one */
  existingBookingPublicId: string;
  existingVehicleMake: string;
  existingVehicleModel: string;
  existingBookingStart: Date;
  existingBookingEnd: Date;
  existingBookingStatus: BookingStatus;
}

export interface TypeClassLimitResult {
  conflicts: TypeClassConflict[];
}

// Statuses that represent an active customer intent (wider than vehicle-availability BLOCKING_STATUSES)
const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

const CLASSIFIABLE: VehicleTypeClass[] = [
  VehicleTypeClass.TWO_WHEELER,
  VehicleTypeClass.FOUR_WHEELER,
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns the set of typeClasses among the requested vehicles that are classifiable. */
function requestedClasses(vehicles: VehicleWithTypeClass[]): Set<VehicleTypeClass> {
  const classes = new Set<VehicleTypeClass>();
  for (const v of vehicles) {
    if (CLASSIFIABLE.includes(v.category.typeClass)) {
      classes.add(v.category.typeClass);
    }
  }
  return classes;
}

/**
 * Checks whether the requested vehicle list itself contains more than one vehicle
 * of the same classifiable typeClass (e.g. two scooters in a single booking request).
 */
function getRequestTypeClassDuplicates(
  vehicles: VehicleWithTypeClass[],
): TypeClassConflict[] {
  const seen = new Map<VehicleTypeClass, VehicleWithTypeClass>();
  const conflicts: TypeClassConflict[] = [];

  for (const v of vehicles) {
    const tc = v.category.typeClass;
    if (!CLASSIFIABLE.includes(tc)) continue;

    if (seen.has(tc)) {
      const first = seen.get(tc)!;
      // Use a sentinel conflict to signal an intra-request duplicate.
      // existingBooking fields reference the first vehicle in the request.
      conflicts.push({
        typeClass: tc,
        existingBookingPublicId: "INTRA_REQUEST",
        existingVehicleMake: first.make,
        existingVehicleModel: first.model,
        existingBookingStart: new Date(0),
        existingBookingEnd: new Date(0),
        existingBookingStatus: BookingStatus.CONFIRMED,
      });
    } else {
      seen.set(tc, v);
    }
  }

  return conflicts;
}

/**
 * Queries the database for the customer's active bookings that overlap [startDate, endDate)
 * and fall into the requested typeClasses. Returns one conflict entry per blocking booking.
 *
 * Overlap (TASK-025): `startAt < endDate AND endAt > startDate` — strict half-open interval.
 * Adjacent bookings (e.g. return Jun 10 00:00, new pickup Jun 10 00:00) do NOT conflict.
 *
 * Excludes:
 *  - CANCELLED / RETURNED / HOLD_EXPIRED bookings (not in ACTIVE_STATUSES)
 *  - HOLD bookings whose holdExpiresAt is in the past (TASK-026): stale HOLDs that the
 *    cleanup cron hasn't purged yet must never block a legitimate new booking.
 */
async function fetchCustomerTypeClassConflicts(
  client: typeof prisma,
  customerId: number,
  neededClasses: Set<VehicleTypeClass>,
  startDate: Date,
  endDate: Date,
): Promise<TypeClassConflict[]> {
  if (neededClasses.size === 0) return [];

  const now = new Date();

  const conflictingItems = await client.bookingItem.findMany({
    where: {
      booking: {
        customerId,
        status: { in: ACTIVE_STATUSES },
        // TASK-025: half-open interval overlap — existing must start before new end AND end after new start
        startAt: { lt: endDate },
        endAt: { gt: startDate },
        // TASK-026: skip HOLDs the cron job hasn't cleaned up yet
        OR: [
          { status: { not: BookingStatus.HOLD } },
          { holdExpiresAt: { gt: now } },
        ],
      },
      vehicle: {
        category: {
          typeClass: { in: Array.from(neededClasses) },
        },
      },
    },
    select: {
      vehicle: {
        select: {
          make: true,
          model: true,
          category: { select: { typeClass: true } },
        },
      },
      booking: {
        select: {
          publicId: true,
          startAt: true,
          endAt: true,
          status: true,
        },
      },
    },
  });

  return conflictingItems.map((item) => ({
    typeClass: item.vehicle.category.typeClass,
    existingBookingPublicId: item.booking.publicId,
    existingVehicleMake: item.vehicle.make,
    existingVehicleModel: item.vehicle.model,
    existingBookingStart: item.booking.startAt,
    existingBookingEnd: item.booking.endAt,
    existingBookingStatus: item.booking.status,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks both intra-request duplicates and existing customer booking conflicts
 * for the given date range.
 *
 * @param customerId        Internal customer profile ID (Customer.id)
 * @param requestedVehicles Resolved vehicle objects (must include category.typeClass)
 * @param startDate         Booking start (UTC, from TimezoneService.toPrisma)
 * @param endDate           Booking end   (UTC, from TimezoneService.toPrisma)
 * @param opts.bypassLimit  When true (ADMIN/MANAGER override), returns no conflicts
 *
 * TASK-027 — Extension exclusion: booking extensions modify `endAt` on an existing booking
 * and do NOT create a new booking row, so they never increase a customer's type-class slot
 * count. Extension controllers must NOT call this function.
 *
 * TASK-028 — Vehicle swap exclusion: a vehicle swap replaces the vehicle inside an existing
 * booking item; the booking's date range and slot count are unchanged. Swap controllers must
 * NOT call this function.
 */
export async function checkCustomerTypeClassLimits(
  customerId: number,
  requestedVehicles: VehicleWithTypeClass[],
  startDate: Date,
  endDate: Date,
  opts: { bypassLimit?: boolean } = {},
): Promise<TypeClassLimitResult> {
  if (opts.bypassLimit) return { conflicts: [] };

  const intraRequest = getRequestTypeClassDuplicates(requestedVehicles);
  if (intraRequest.length > 0) return { conflicts: intraRequest };

  const needed = requestedClasses(requestedVehicles);
  const dbConflicts = await fetchCustomerTypeClassConflicts(
    prisma,
    customerId,
    needed,
    startDate,
    endDate,
  );

  return { conflicts: dbConflicts };
}

/**
 * Transaction-safe variant — accepts a Prisma transaction client.
 * Call this inside a `prisma.$transaction` block immediately before the booking DB write
 * to prevent TOCTOU races between the pre-check and the commit.
 *
 * NOTE: Booking extensions and vehicle swaps operate on existing bookings and must NOT
 * call this function — no new type-class slot is consumed in those flows.
 */
export async function checkCustomerTypeClassLimitsInTx(
  tx: typeof prisma,
  customerId: number,
  requestedVehicles: VehicleWithTypeClass[],
  startDate: Date,
  endDate: Date,
): Promise<TypeClassLimitResult> {
  const intraRequest = getRequestTypeClassDuplicates(requestedVehicles);
  if (intraRequest.length > 0) return { conflicts: intraRequest };

  const needed = requestedClasses(requestedVehicles);
  const dbConflicts = await fetchCustomerTypeClassConflicts(
    tx,
    customerId,
    needed,
    startDate,
    endDate,
  );

  return { conflicts: dbConflicts };
}
