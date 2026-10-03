/**
 * One vehicle per driving licence (X3). Matched on the normalised
 * Customer.drivingLicenceNumber across every customer and branch:
 *
 *  - A DL with a booking out (PICKED_UP, overdue or not) can't start any other
 *    booking until that vehicle is returned.
 *  - A DL with an unexpired HOLD or a CONFIRMED booking can't get a second
 *    booking whose window overlaps it.
 *
 * Checked at customer create, staff walk-in create, pickup (both paths and the
 * manager's pickup confirmation) and extension evaluate/commit. Creates and
 * pickups re-check inside their transaction under a per-DL advisory lock, so
 * two requests for the same licence can't both pass. A customer with no DL
 * number on file skips the check.
 *
 * Refusals are 409 DL_IN_USE. Customers get a message that never names another
 * person's booking; staff and branch managers get the booking named plus
 * `conflictingBooking`.
 */
import { prisma, BookingStatus } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { normalizeDrivingLicence, isValidDrivingLicence } from "@repo/schemas";
import { DateTime } from "luxon";
import { StatusCode } from "../../types/statusCode.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const DL_IN_USE = "DL_IN_USE" as const;

/**
 * create  — a new booking for `window` (customer hold or walk-in).
 * pickup  — handing over a vehicle: refused while another booking on the DL is out.
 * extend  — an extension adding `window` (current end → new end) to a booking.
 * reschedule — a confirmed booking moved to `window` (its new pickup → return);
 *           checked like extend: an out vehicle blocks only while it overlaps.
 */
export type DlCheckMode = "create" | "pickup" | "extend" | "reschedule";

/** Who reads the refusal: customers never see another booking's details. */
export type DlAudience = "customer" | "staff";

/** VEHICLE_OUT: the other booking is PICKED_UP. OVERLAP: a HOLD/CONFIRMED booking overlaps. */
export type DlConflictKind = "VEHICLE_OUT" | "OVERLAP";

export const DL_IN_USE_CUSTOMER_MESSAGES = {
  VEHICLE_OUT:
    "This driving licence is already linked to a vehicle that hasn't been returned. You can book again once it's returned.",
  OVERLAP: "This driving licence already has a booking for these dates.",
  EXTEND_VEHICLE_OUT:
    "This driving licence is already linked to another vehicle that hasn't been returned. You can extend once it's returned.",
} as const;

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
    public readonly conflictingBooking: DlConflictingBooking,
  ) {
    super(staffMessage(kind, mode, conflictingBooking));
    this.name = "DlInUseError";
  }

  customerMessage(): string {
    if (this.kind === "OVERLAP") return DL_IN_USE_CUSTOMER_MESSAGES.OVERLAP;
    return this.mode === "extend"
      ? DL_IN_USE_CUSTOMER_MESSAGES.EXTEND_VEHICLE_OUT
      : DL_IN_USE_CUSTOMER_MESSAGES.VEHICLE_OUT;
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
      conflictingBooking: this.conflictingBooking,
    };
  }
}

function staffMessage(kind: DlConflictKind, mode: DlCheckMode, b: DlConflictingBooking): string {
  const vehicle = b.vehicle ? `${b.vehicle.make} ${b.vehicle.model} (${b.vehicle.regNo})` : "vehicle";
  const named = `booking ${b.publicId} — ${b.customerName}, ${vehicle}`;
  const dates = `${formatIst(new Date(b.startAt))} – ${formatIst(new Date(b.endAt))}`;
  if (kind === "VEHICLE_OUT") {
    if (mode === "pickup") {
      return `This driving licence is linked to ${named}, which hasn't been returned. That vehicle must be returned before another is handed over.`;
    }
    if (mode === "extend") {
      return `This driving licence is linked to ${named}, which hasn't been returned and overlaps the extended dates.`;
    }
    if (mode === "reschedule") {
      return `This driving licence is linked to ${named}, which hasn't been returned and overlaps the new dates.`;
    }
    return `This driving licence is linked to ${named}, which hasn't been returned. A new booking can be made once it's returned.`;
  }
  if (mode === "reschedule") {
    return `This driving licence already has ${named} for ${dates}, which overlaps the new dates.`;
  }
  return mode === "extend"
    ? `This driving licence already has ${named} for ${dates}, which overlaps the extended dates.`
    : `This driving licence already has ${named} for ${dates}, which overlaps these dates.`;
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

/**
 * The DL a pickup request will leave on file: a valid `drivingLicenceNumber`
 * sent with the request (entered at the counter) wins over the stored one.
 */
export function pickupDlCandidate(requestValue: unknown, stored: string | null | undefined): string | null {
  if (typeof requestValue === "string" && isValidDrivingLicence(requestValue)) {
    return normalizeDrivingLicence(requestValue);
  }
  return cleanDl(stored);
}

export interface DlCheckInput {
  /** The DL to check. Omit to load it from `customerId`. */
  dlNumber?: string | null;
  customerId?: number;
  mode: DlCheckMode;
  /** create: the new booking's window. extend: current end → requested end. Unused for pickup. */
  window?: { startAt: Date; endAt: Date };
  /** The booking being picked up / extended — never its own conflict. */
  excludeBookingId?: number;
  now?: Date;
}

function conflictWhere(dl: string, input: DlCheckInput, now: Date): Prisma.BookingWhereInput {
  const overlaps = (w: { startAt: Date; endAt: Date }): Prisma.BookingWhereInput => ({
    startAt: { lt: w.endAt },
    endAt: { gt: w.startAt },
  });

  const or: Prisma.BookingWhereInput[] = [];
  if (input.mode === "pickup" || input.mode === "create" || !input.window) {
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
  if (input.mode !== "pickup" && input.window) {
    or.push({ status: BookingStatus.CONFIRMED, ...overlaps(input.window) });
    or.push({ status: BookingStatus.HOLD, holdExpiresAt: { gt: now }, ...overlaps(input.window) });
  }

  return {
    customer: { drivingLicenceNumber: dl },
    ...(input.excludeBookingId !== undefined && { id: { not: input.excludeBookingId } }),
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

  const now = input.now ?? new Date();
  const rows = await db.booking.findMany({
    where: conflictWhere(dl, input, now),
    orderBy: { startAt: "asc" },
    take: 10,
    select: {
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      customer: { select: { user: { select: { name: true } } } },
      items: {
        take: 1,
        orderBy: { id: "asc" },
        select: { vehicle: { select: { make: true, model: true, regNo: true } } },
      },
    },
  });
  if (rows.length === 0) return null;

  const row = rows.find((r) => r.status === BookingStatus.PICKED_UP) ?? rows[0]!;
  const vehicle = row.items[0]?.vehicle ?? null;
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
  );
}

/** Throws DlInUseError when the DL is in use (no lock — early refusals and quotes). */
export async function assertDlFree(input: DlCheckInput, db: Db = prisma): Promise<void> {
  const conflict = await findDlConflict(input, db);
  if (conflict) throw conflict;
}

/**
 * Race-safe check. Call INSIDE the interactive transaction that writes the
 * booking (create) or its PICKED_UP status: takes a transaction-scoped advisory
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

/**
 * Pickup guard for a booking id: reads the customer's DL inside `tx` (so a DL
 * number saved earlier in the same pickup is used), locks it and refuses while
 * another booking on that DL is out.
 */
export async function lockAndAssertDlFreeForPickup(bookingId: number, tx: Prisma.TransactionClient): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { customer: { select: { drivingLicenceNumber: true } } },
  });
  await lockAndAssertDlFree(
    {
      dlNumber: booking?.customer.drivingLicenceNumber ?? null,
      mode: "pickup",
      excludeBookingId: bookingId,
    },
    tx,
  );
}
