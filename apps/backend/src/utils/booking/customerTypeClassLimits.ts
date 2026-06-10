import { prisma, VehicleTypeClass, BookingStatus } from "@repo/database/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BookingRestrictionMode = "NONE" | "SAME_CATEGORY" | "ANY_VEHICLE";

/** Minimum shape of a vehicle object required by this utility. */
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
  /** Set to "ANY_VEHICLE" when the conflict arises from branch-level any-vehicle restriction */
  reason?: "ANY_VEHICLE";
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

function requestedClasses(vehicles: VehicleWithTypeClass[]): Set<VehicleTypeClass> {
  const classes = new Set<VehicleTypeClass>();
  for (const v of vehicles) {
    if (CLASSIFIABLE.includes(v.category.typeClass)) {
      classes.add(v.category.typeClass);
    }
  }
  return classes;
}

function getRequestTypeClassDuplicates(vehicles: VehicleWithTypeClass[]): TypeClassConflict[] {
  const seen = new Map<VehicleTypeClass, VehicleWithTypeClass>();
  const conflicts: TypeClassConflict[] = [];

  for (const v of vehicles) {
    const tc = v.category.typeClass;
    if (!CLASSIFIABLE.includes(tc)) continue;

    if (seen.has(tc)) {
      const first = seen.get(tc)!;
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
        startAt: { lt: endDate },
        endAt: { gt: startDate },
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

/**
 * ANY_VEHICLE mode: checks if the customer has ANY active booking at the given branch
 * overlapping the requested date range. Returns a single sentinel conflict if found.
 */
async function fetchCustomerAnyVehicleConflict(
  client: typeof prisma,
  customerId: number,
  branchId: number,
  startDate: Date,
  endDate: Date,
): Promise<TypeClassConflict | null> {
  const now = new Date();

  const item = await client.bookingItem.findFirst({
    where: {
      booking: {
        customerId,
        branchId,
        status: { in: ACTIVE_STATUSES },
        startAt: { lt: endDate },
        endAt: { gt: startDate },
        OR: [
          { status: { not: BookingStatus.HOLD } },
          { holdExpiresAt: { gt: now } },
        ],
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

  if (!item) return null;

  return {
    typeClass: item.vehicle.category.typeClass,
    reason: "ANY_VEHICLE",
    existingBookingPublicId: item.booking.publicId,
    existingVehicleMake: item.vehicle.make,
    existingVehicleModel: item.vehicle.model,
    existingBookingStart: item.booking.startAt,
    existingBookingEnd: item.booking.endAt,
    existingBookingStatus: item.booking.status,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CheckLimitOpts {
  /** When true (ADMIN/MANAGER override), returns no conflicts. */
  bypassLimit?: boolean;
  /** Branch-level restriction mode — defaults to SAME_CATEGORY if not provided. */
  restrictionMode?: BookingRestrictionMode;
  /** Required when restrictionMode is ANY_VEHICLE. */
  branchId?: number;
}

export async function checkCustomerTypeClassLimits(
  customerId: number,
  requestedVehicles: VehicleWithTypeClass[],
  startDate: Date,
  endDate: Date,
  opts: CheckLimitOpts = {},
): Promise<TypeClassLimitResult> {
  if (opts.bypassLimit) return { conflicts: [] };

  const mode = opts.restrictionMode ?? "SAME_CATEGORY";

  if (mode === "NONE") return { conflicts: [] };

  if (mode === "ANY_VEHICLE") {
    if (!opts.branchId) return { conflicts: [] };
    const conflict = await fetchCustomerAnyVehicleConflict(
      prisma,
      customerId,
      opts.branchId,
      startDate,
      endDate,
    );
    return { conflicts: conflict ? [conflict] : [] };
  }

  // SAME_CATEGORY (default)
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
 * Call this inside a `prisma.$transaction` block immediately before the booking DB write.
 */
export async function checkCustomerTypeClassLimitsInTx(
  tx: typeof prisma,
  customerId: number,
  requestedVehicles: VehicleWithTypeClass[],
  startDate: Date,
  endDate: Date,
  opts: CheckLimitOpts = {},
): Promise<TypeClassLimitResult> {
  if (opts.bypassLimit) return { conflicts: [] };

  const mode = opts.restrictionMode ?? "SAME_CATEGORY";

  if (mode === "NONE") return { conflicts: [] };

  if (mode === "ANY_VEHICLE") {
    if (!opts.branchId) return { conflicts: [] };
    const conflict = await fetchCustomerAnyVehicleConflict(
      tx,
      customerId,
      opts.branchId,
      startDate,
      endDate,
    );
    return { conflicts: conflict ? [conflict] : [] };
  }

  // SAME_CATEGORY
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
