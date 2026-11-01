/**
 * One car and one scooter per driving licence (X3; client TODO 5, Nov 1 2026).
 * Matched on the normalised Customer.drivingLicenceNumber across every customer
 * and branch (not on the customer id: two accounts with one licence share it).
 *
 * The limit is per vehicle type class (VehicleTypeClass on the category):
 *
 *   existing  | new       | result
 *   car       | scooter   | allowed      (FOUR_WHEELER = car, TWO_WHEELER = scooter)
 *   scooter   | car       | allowed
 *   car       | car       | DL_IN_USE
 *   scooter   | scooter   | DL_IN_USE
 *   OTHER     | OTHER     | DL_IN_USE    (OTHER is a class of its own: one at a time,
 *                                         and it never blocks a car or a scooter)
 *
 * A booking of class C is blocked by another booking on the same licence that
 * has a vehicle of class C and:
 *
 *  - is out (PICKED_UP, overdue or not): a create can't start until that
 *    vehicle is returned, whatever the dates; an extension / reschedule only
 *    while it overlaps (an overdue rental is still out now);
 *  - or is CONFIRMED / an unexpired HOLD whose window overlaps.
 *
 * One booking with two vehicles of one class (two cars, two scooters) is
 * refused too (kind SAME_BOOKING); a car + a scooter in one booking is fine.
 *
 * The classes checked are `typeClasses` (one per vehicle being booked); an
 * extension / reschedule that passes none uses its own booking's vehicles
 * (`excludeBookingId`). With neither, every class blocks (the old rule).
 * Vehicle swaps never change the class (VEHICLE_TYPE_MISMATCH in
 * vehicle-swap.service.ts and the extension allocator), so they can't create
 * a second car or scooter on a licence.
 *
 * Checked at customer create, staff walk-in create, reschedule and extension
 * evaluate/commit. Creates re-check inside their transaction under a per-DL
 * advisory lock, so two requests for the same licence can't both pass. A
 * customer with no DL number on file skips the check.
 *
 * Not checked at pickup any more: the DL number was taken out of the pickup
 * flow (client, Oct 17 2026), so a handover never blocks on it.
 *
 * Refusals are 409 DL_IN_USE (same code as before, so old builds keep working).
 * Customers get a message that never names another person's booking; staff and
 * branch managers get the booking named plus `conflictingBooking`.
 */
import { prisma, BookingStatus, VehicleTypeClass } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { normalizeDrivingLicence } from "@repo/schemas";
import { DateTime } from "luxon";
import { StatusCode } from "../../types/statusCode.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const DL_IN_USE = "DL_IN_USE" as const;

/**
 * create  — a new booking for `window` (customer hold or walk-in).
 * extend  — an extension adding `window` (current end → new end) to a booking.
 * reschedule — a confirmed booking moved to `window` (its new pickup → return);
 *           checked like extend: an out vehicle blocks only while it overlaps.
 */
export type DlCheckMode = "create" | "extend" | "reschedule";

/** Who reads the refusal: customers never see another booking's details. */
export type DlAudience = "customer" | "staff";

/**
 * VEHICLE_OUT: the other booking is PICKED_UP. OVERLAP: a HOLD/CONFIRMED booking
 * overlaps. SAME_BOOKING: the booking itself has two vehicles of one class.
 */
export type DlConflictKind = "VEHICLE_OUT" | "OVERLAP" | "SAME_BOOKING";

/** "car" / "scooter" / "vehicle of this type" (OTHER). */
export function typeClassNoun(typeClass: VehicleTypeClass | null | undefined): string {
  if (typeClass === VehicleTypeClass.FOUR_WHEELER) return "car";
  if (typeClass === VehicleTypeClass.TWO_WHEELER) return "scooter";
  return "vehicle of this type";
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");
const withArticle = (typeClass: VehicleTypeClass | null | undefined) => {
  const noun = typeClassNoun(typeClass);
  return `${article(noun)} ${noun}`;
};

/** Customer-facing refusals (never name another booking). */
export function dlInUseCustomerMessage(
  kind: DlConflictKind,
  mode: DlCheckMode,
  typeClass: VehicleTypeClass | null | undefined,
): string {
  const noun = typeClassNoun(typeClass);
  if (kind === "SAME_BOOKING") {
    return `One licence can have only one ${noun} on rent at a time. Remove the second ${noun} from this booking.`;
  }
  if (kind === "VEHICLE_OUT" && mode === "create") {
    return `This licence already has ${withArticle(typeClass)} on rent that hasn't been returned. You can book another ${noun} once it's returned.`;
  }
  return `This licence already has ${withArticle(typeClass)} on rent for these dates.`;
}

export interface DlConflictingBooking {
  publicId: string;
  status: BookingStatus;
  vehicle: { make: string; model: string; regNo: string } | null;
  startAt: string;
  endAt: string;
  customerName: string;
}

const formatIst = (d: Date) =>
  DateTime.fromJSDate(d).setZone("Asia/Kolkata").toFormat("d LLL yyyy, h:mm a");

export class DlInUseError extends Error {
  readonly code = DL_IN_USE;
  readonly status = StatusCode.CONFLICT;

  constructor(
    public readonly kind: DlConflictKind,
    public readonly mode: DlCheckMode,
    /** null for SAME_BOOKING (the clash is inside the booking being made). */
    public readonly conflictingBooking: DlConflictingBooking | null,
    /** The class the licence already has (car / scooter / other). */
    public readonly typeClass: VehicleTypeClass | null = null,
  ) {
    super(staffMessage(kind, mode, conflictingBooking, typeClass));
    this.name = "DlInUseError";
  }

  customerMessage(): string {
    return dlInUseCustomerMessage(this.kind, this.mode, this.typeClass);
  }

  /** `{ success:false, code:'DL_IN_USE', message, conflictingBooking? }` — staff/BM get the booking. */
  toJSON(audience: DlAudience = "staff") {
    if (audience === "customer") {
      return { success: false, code: this.code, message: this.customerMessage() };
    }
    return {
      success: false,
      code: this.code,
      message: this.message,
      ...(this.conflictingBooking && { conflictingBooking: this.conflictingBooking }),
    };
  }
}

function staffMessage(
  kind: DlConflictKind,
  mode: DlCheckMode,
  b: DlConflictingBooking | null,
  typeClass: VehicleTypeClass | null,
): string {
  const noun = typeClassNoun(typeClass);
  const has = `This licence already has ${withArticle(typeClass)} on rent`;
  if (kind === "SAME_BOOKING" || !b) {
    return `One licence can have only one ${noun} on rent at a time — this booking has two. Book the second ${noun} on another licence.`;
  }
  const vehicle = b.vehicle ? `${b.vehicle.make} ${b.vehicle.model} (${b.vehicle.regNo})` : noun;
  const named = `booking ${b.publicId} — ${b.customerName}, ${vehicle}`;
  const dates = `${formatIst(new Date(b.startAt))} – ${formatIst(new Date(b.endAt))}`;
  if (kind === "VEHICLE_OUT") {
    if (mode === "extend") return `${has} for these dates: ${named}, which hasn't been returned and overlaps the extended dates.`;
    if (mode === "reschedule") return `${has} for these dates: ${named}, which hasn't been returned and overlaps the new dates.`;
    return `${has} that hasn't been returned: ${named}. Another ${noun} can be booked once it's returned.`;
  }
  if (mode === "reschedule") return `${has} for these dates: ${named} for ${dates}, which overlaps the new dates.`;
  if (mode === "extend") return `${has} for these dates: ${named} for ${dates}, which overlaps the extended dates.`;
  return `${has} for these dates: ${named} for ${dates}.`;
}

/** The stored (normalised) DL of a customer, or null when none is on file. */
export async function getCustomerDrivingLicence(customerId: number, db: Db = prisma): Promise<string | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { drivingLicenceNumber: true },
  });
  return cleanDl(customer?.drivingLicenceNumber);
}

/** Normalised DL, or null for an empty value. */
export function cleanDl(value: string | null | undefined): string | null {
  const dl = normalizeDrivingLicence(value ?? "");
  return dl.length > 0 ? dl : null;
}

export interface DlCheckInput {
  /** The DL to check. Omit to load it from `customerId`. */
  dlNumber?: string | null;
  customerId?: number;
  mode: DlCheckMode;
  /** create: the new booking's window. extend: current end → requested end. */
  window?: { startAt: Date; endAt: Date };
  /** The booking being extended / rescheduled — never its own conflict. */
  excludeBookingId?: number;
  /**
   * Type class of each vehicle being booked (one entry per vehicle). Omitted:
   * the classes of `excludeBookingId`'s own vehicles; with neither, every class
   * blocks (old rule). An empty list counts as omitted.
   */
  typeClasses?: VehicleTypeClass[];
  now?: Date;
}

/** The first class that appears twice in `classes` (one booking, two cars), or null. */
export function duplicateTypeClass(classes: readonly VehicleTypeClass[]): VehicleTypeClass | null {
  const seen = new Set<VehicleTypeClass>();
  for (const c of classes) {
    if (seen.has(c)) return c;
    seen.add(c);
  }
  return null;
}

/**
 * The class an existing booking shares with the request, or null when it has
 * none (a scooter booking never blocks a car). `requested` null = every class.
 */
export function sharedTypeClass(
  requested: readonly VehicleTypeClass[] | null,
  existing: readonly VehicleTypeClass[],
): VehicleTypeClass | null {
  if (requested === null) return existing[0] ?? null;
  return existing.find((c) => requested.includes(c)) ?? null;
}

/**
 * Type class per vehicle (by id or publicId) plus per category (a group key's
 * category) — one entry each, in order; unknown ids are skipped.
 */
export async function resolveTypeClasses(
  refs: { vehicleIds?: number[]; vehiclePublicIds?: string[]; categoryIds?: number[] },
  db: Db = prisma,
): Promise<VehicleTypeClass[]> {
  const out: VehicleTypeClass[] = [];
  const ids = refs.vehicleIds ?? [];
  const publicIds = refs.vehiclePublicIds ?? [];
  if (ids.length > 0 || publicIds.length > 0) {
    const vehicles = await db.vehicle.findMany({
      where: { OR: [{ id: { in: ids } }, { publicId: { in: publicIds } }] },
      select: { id: true, publicId: true, category: { select: { typeClass: true } } },
    });
    for (const id of ids) {
      const v = vehicles.find((x) => x.id === id);
      if (v) out.push(v.category.typeClass);
    }
    for (const pid of publicIds) {
      const v = vehicles.find((x) => x.publicId === pid);
      if (v) out.push(v.category.typeClass);
    }
  }
  const categoryIds = refs.categoryIds ?? [];
  if (categoryIds.length > 0) {
    const cats = await db.vehicleCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, typeClass: true },
    });
    for (const id of categoryIds) {
      const c = cats.find((x) => x.id === id);
      if (c) out.push(c.typeClass);
    }
  }
  return out;
}

async function requestedTypeClasses(input: DlCheckInput, db: Db): Promise<VehicleTypeClass[] | null> {
  if (input.typeClasses !== undefined && input.typeClasses.length > 0) return input.typeClasses;
  if (input.excludeBookingId === undefined) return null;
  const items = await db.bookingItem.findMany({
    where: { bookingId: input.excludeBookingId },
    select: { vehicle: { select: { category: { select: { typeClass: true } } } } },
  });
  return items.length > 0 ? items.map((i) => i.vehicle.category.typeClass) : null;
}

/** The Prisma filter for bookings that block `dl` (exported for unit tests). */
export function conflictWhere(
  dl: string,
  input: DlCheckInput,
  now: Date,
  classes: readonly VehicleTypeClass[] | null = null,
): Prisma.BookingWhereInput {
  const overlaps = (w: { startAt: Date; endAt: Date }): Prisma.BookingWhereInput => ({
    startAt: { lt: w.endAt },
    endAt: { gt: w.startAt },
  });

  const or: Prisma.BookingWhereInput[] = [];
  if (input.mode === "create" || !input.window) {
    // Out vehicles block every other start, whatever the dates
    or.push({ status: BookingStatus.PICKED_UP });
  } else {
    // extend: an out vehicle is busy from its start until it's returned —
    // at least until its booked end, and still now if it's overdue.
    const w = input.window;
    or.push(
      now >= w.startAt
        ? { status: BookingStatus.PICKED_UP, startAt: { lt: w.endAt } }
        : { status: BookingStatus.PICKED_UP, ...overlaps(w) },
    );
  }
  if (input.window) {
    or.push({ status: BookingStatus.CONFIRMED, ...overlaps(input.window) });
    or.push({ status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, ...overlaps(input.window) });
  }

  return {
    customer: { drivingLicenceNumber: dl },
    ...(input.excludeBookingId !== undefined && { id: { not: input.excludeBookingId } }),
    // Only a booking holding a vehicle of a class being booked blocks
    ...(classes !== null && {
      items: { some: { vehicle: { category: { typeClass: { in: [...new Set(classes)] } } } } },
    }),
    OR: or,
  };
}

/**
 * The first booking that stops this DL from starting / extending a booking,
 * or null. A vehicle that is out is reported before an overlap.
 */
export async function findDlConflict(
  input: DlCheckInput,
  db: Db = prisma,
): Promise<DlInUseError | null> {
  const dl =
    input.dlNumber !== undefined
      ? cleanDl(input.dlNumber)
      : input.customerId !== undefined
        ? await getCustomerDrivingLicence(input.customerId, db)
        : null;
  if (!dl) return null;

  const classes = await requestedTypeClasses(input, db);

  // Two cars (or two scooters) in the booking being made
  if (input.typeClasses !== undefined && input.mode === "create") {
    const dup = duplicateTypeClass(input.typeClasses);
    if (dup) return new DlInUseError("SAME_BOOKING", input.mode, null, dup);
  }

  const now = input.now ?? new Date();
  const rows = await db.booking.findMany({
    where: conflictWhere(dl, input, now, classes),
    orderBy: { startAt: "asc" },
    take: 10,
    select: {
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      customer: { select: { user: { select: { name: true } } } },
      items: {
        orderBy: { id: "asc" },
        select: {
          vehicle: { select: { make: true, model: true, regNo: true, category: { select: { typeClass: true } } } },
        },
      },
    },
  });
  if (rows.length === 0) return null;

  const row = rows.find((r) => r.status === BookingStatus.PICKED_UP) ?? rows[0]!;
  const typeClass = sharedTypeClass(
    classes,
    row.items.map((i) => i.vehicle.category.typeClass),
  );
  // The vehicle of the shared class (a car + scooter booking names its car)
  const vehicle =
    row.items.find((i) => i.vehicle.category.typeClass === typeClass)?.vehicle ?? row.items[0]?.vehicle ?? null;
  return new DlInUseError(
    row.status === BookingStatus.PICKED_UP ? "VEHICLE_OUT" : "OVERLAP",
    input.mode,
    {
      publicId: row.publicId,
      status: row.status,
      vehicle: vehicle ? { make: vehicle.make, model: vehicle.model, regNo: vehicle.regNo } : null,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      customerName: row.customer.user.name,
    },
    typeClass,
  );
}

/** Throws DlInUseError when the DL is in use (no lock — early refusals and quotes). */
export async function assertDlFree(input: DlCheckInput, db: Db = prisma): Promise<void> {
  const conflict = await findDlConflict(input, db);
  if (conflict) throw conflict;
}

/**
 * Race-safe check. Call INSIDE the interactive transaction that writes the
 * booking (create), extension or reschedule: takes a transaction-scoped advisory
 * lock on the DL, then re-checks. Two requests for the same licence serialise
 * on the lock and the second sees the first one's committed row.
 */
export async function lockAndAssertDlFree(input: DlCheckInput, tx: Prisma.TransactionClient): Promise<void> {
  const dl =
    input.dlNumber !== undefined
      ? cleanDl(input.dlNumber)
      : input.customerId !== undefined
        ? await getCustomerDrivingLicence(input.customerId, tx)
        : null;
  if (!dl) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dl:" + dl}))`;
  await assertDlFree({ ...input, dlNumber: dl }, tx);
}
