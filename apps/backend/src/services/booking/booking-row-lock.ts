/**
 * The booking row lock shared by the branch manager's manual cancel and every
 * pickup completion (Fleet legacy pickup, the payment-session PICKUP completion,
 * the BM's confirm-pickup). Both sides take it first in their transaction and
 * re-read the status under it, so a cancel can't land in the middle of a pickup
 * and a pickup can't flip a booking cancelled meanwhile back to PICKED_UP — the
 * later one sees the earlier one's result.
 *
 * pickupStateRefusal is pure (unit-tested in booking-row-lock.test.ts).
 */
import type { Prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";

/** What the lock reads back from the row. */
export interface LockedBookingRow {
  status: string;
  cancellationSource: string | null;
}

/** Locks the booking row (SELECT … FOR UPDATE) for the rest of the transaction; null when it doesn't exist. */
export async function lockBookingRow(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  bookingId: number,
): Promise<LockedBookingRow | null> {
  const rows = await tx.$queryRaw<LockedBookingRow[]>`
    SELECT "status"::text AS "status", "cancellationSource"::text AS "cancellationSource"
    FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  return rows[0] ?? null;
}

/** 409: the booking can't be handed over any more (cancelled, or no longer waiting for pickup). */
export class PickupStateError extends Error {
  readonly status = StatusCode.CONFLICT;
  constructor(
    public readonly code: "BOOKING_CANCELLED" | "BOOKING_NOT_CONFIRMED",
    message: string,
    public readonly bookingStatus: string | null,
  ) {
    super(message);
    this.name = "PickupStateError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, bookingStatus: this.bookingStatus };
  }
}

/** Why a pickup can't flip this row to PICKED_UP, or null when it is still CONFIRMED. */
export function pickupStateRefusal(row: LockedBookingRow | null): PickupStateError | null {
  if (row?.status === "CONFIRMED") return null;
  if (row?.status === "CANCELLED") {
    return new PickupStateError(
      "BOOKING_CANCELLED",
      row.cancellationSource === "MANUAL_BM"
        ? "This booking was cancelled by the branch."
        : "This booking was cancelled.",
      row.status,
    );
  }
  return new PickupStateError(
    "BOOKING_NOT_CONFIRMED",
    row?.status === "PICKED_UP"
      ? "This booking has already been picked up. Refresh and try again."
      : `This booking can't be picked up any more (status ${row?.status ?? "unknown"}). Refresh and try again.`,
    row?.status ?? null,
  );
}

/**
 * A pickup path's up-front check: a booking already cancelled answers 409
 * BOOKING_CANCELLED (same body as under the lock) instead of the path's generic
 * status error. Null for any other status — the path's own checks apply.
 */
export function cancelledPickupRefusal(booking: LockedBookingRow): PickupStateError | null {
  return booking.status === "CANCELLED" ? pickupStateRefusal(booking) : null;
}

/**
 * First thing in a pickup completion's transaction: locks the booking row and
 * throws PickupStateError (409) unless it is still CONFIRMED.
 */
export async function lockBookingForPickup(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  bookingId: number,
): Promise<void> {
  const refusal = pickupStateRefusal(await lockBookingRow(tx, bookingId));
  if (refusal) throw refusal;
}
