/**
 * Applies the actual-pickup rule (actual-pickup-shift.ts) inside a pickup
 * completion transaction: the Fleet legacy pickup, the PICKUP payment-session
 * settlement and the branch manager's confirm-pickup. Call it after the
 * booking row lock and after the booking is PICKED_UP (and, on a session,
 * after an extension paid on the same bill is confirmed).
 *
 * The scheduled times are kept on the booking (scheduledStartAt /
 * scheduledEndAt, set once) with the handover time (pickedUpAt) and the delay.
 * Extension rows and originalEndAt slide with the window, so the extension
 * history, the drop-bill timeline and a pending extension's confirm all stay
 * consistent with the new endAt. The price never changes.
 */
import { ExtensionStatus, prisma, type Prisma } from "@repo/database/client";
import { extensionAvailabilityService } from "../extension/extension-availability.service.js";
import { partialExtensionEnd } from "../extension/partial-extension.js";
import {
  loadBranchScheduleConfig,
  validateReturnTime,
} from "../../utils/booking/branchScheduleValidator.js";
import {
  planPickupShift,
  returnShiftMessage,
  type PickupShiftCapReason,
} from "./actual-pickup-shift.js";

/** What the handover response carries (`returnShift`) and staff screens show. */
export interface ReturnShift {
  pickedUpAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  startAt: string;
  endAt: string;
  delayMinutes: number;
  appliedMinutes: number;
  shifted: boolean;
  capped: boolean;
  capReason: PickupShiftCapReason | null;
  /** The new return is outside the branch's return window (kept; staff warned). */
  afterHours: boolean;
  message: string;
}

const LIVE_EXTENSION = { notIn: [ExtensionStatus.REJECTED, ExtensionStatus.CANCELLED] };

/** Latest return each of the booking's cars allows from endAt towards target (null = all free). */
async function latestAllowedEnd(
  tx: Prisma.TransactionClient,
  bookingId: number,
  vehicleIds: number[],
  endAt: Date,
  target: Date,
): Promise<{ latest: Date | null; reason: PickupShiftCapReason | null }> {
  let latest: Date | null = null;
  let reason: PickupShiftCapReason | null = null;
  for (const vehicleId of vehicleIds) {
    // Same rows and rule as an extension from endAt to target (2 h buffer before a
    // booking / rental / checkout, none before a booking lock's effective start)
    const res = await extensionAvailabilityService.checkVehicleAvailability(vehicleId, endAt, target, bookingId, tx);
    if (res.available) continue;
    const cap = partialExtensionEnd(endAt, target, res.conflictingBookings) ?? endAt;
    if (!latest || cap.getTime() < latest.getTime()) {
      latest = cap;
      const first = [...res.conflictingBookings].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
      reason = first?.kind === "LOCK" ? "BOOKING_LOCK" : first?.kind === "HOLD" ? "CHECKOUT" : "NEXT_BOOKING";
    }
  }
  return { latest, reason };
}

export async function applyActualPickupShift(
  tx: Prisma.TransactionClient,
  bookingId: number,
  handoverAt: Date = new Date(),
): Promise<ReturnShift | null> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      branchId: true,
      startAt: true,
      endAt: true,
      originalEndAt: true,
      pickedUpAt: true,
      items: { select: { vehicleId: true } },
    },
  });
  if (!booking) return null;
  // Applied once: a booking already handed over keeps its window
  if (booking.pickedUpAt) return null;

  const delayProbe = planPickupShift({ startAt: booking.startAt, endAt: booking.endAt, handoverAt, latestEndAt: null });
  let latest: Date | null = null;
  let capReason: PickupShiftCapReason | null = null;
  if (delayProbe.delayMinutes > 0) {
    // Vehicle rows locked (as the extension commit does) so a new booking or an
    // extension on the next renter can't slip in between the check and the write
    const vehicleIds = [...new Set(booking.items.map((i) => i.vehicleId))].sort((a, b) => a - b);
    for (const id of vehicleIds) await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${id} FOR UPDATE`;
    ({ latest, reason: capReason } = await latestAllowedEnd(tx, booking.id, vehicleIds, booking.endAt, delayProbe.newEndAt));
  }
  const plan = planPickupShift({ startAt: booking.startAt, endAt: booking.endAt, handoverAt, latestEndAt: latest });
  const appliedMs = plan.appliedMinutes * 60_000;
  const slide = (d: Date | null) => (d ? new Date(d.getTime() + appliedMs) : d);

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      pickedUpAt: handoverAt,
      scheduledStartAt: booking.startAt,
      scheduledEndAt: booking.endAt,
      pickupDelayMinutes: plan.delayMinutes,
      pickupShiftCapReason: plan.capped ? capReason : null,
      ...(appliedMs > 0 && {
        startAt: plan.newStartAt,
        endAt: plan.newEndAt,
        ...(booking.originalEndAt && { originalEndAt: slide(booking.originalEndAt) }),
      }),
    },
  });

  if (appliedMs > 0) {
    const exts = await tx.bookingExtension.findMany({
      where: { bookingId: booking.id, extensionStatus: LIVE_EXTENSION },
      select: { id: true, oldEndAt: true, requestedEndAt: true, actualNewEndAt: true },
    });
    for (const e of exts) {
      await tx.bookingExtension.update({
        where: { id: e.id },
        data: {
          oldEndAt: slide(e.oldEndAt)!,
          requestedEndAt: slide(e.requestedEndAt)!,
          ...(e.actualNewEndAt && { actualNewEndAt: slide(e.actualNewEndAt) }),
        },
      });
    }
  }

  const afterHoursNote = appliedMs > 0 ? await afterHoursNoteFor(booking.branchId, plan.newEndAt, plan.newStartAt) : null;

  return {
    pickedUpAt: handoverAt.toISOString(),
    scheduledStartAt: booking.startAt.toISOString(),
    scheduledEndAt: booking.endAt.toISOString(),
    startAt: plan.newStartAt.toISOString(),
    endAt: plan.newEndAt.toISOString(),
    delayMinutes: plan.delayMinutes,
    appliedMinutes: plan.appliedMinutes,
    shifted: appliedMs > 0,
    capped: plan.capped,
    capReason: plan.capped ? capReason : null,
    afterHours: !!afterHoursNote,
    message: returnShiftMessage({
      scheduledEndAt: booking.endAt,
      endAt: plan.newEndAt,
      delayMinutes: plan.delayMinutes,
      appliedMinutes: plan.appliedMinutes,
      capped: plan.capped,
      capReason,
      afterHoursNote,
    }),
  };
}

/** Staff note when `endAt` is outside the branch's return window (null when inside). */
export async function afterHoursNoteFor(branchId: number, endAt: Date, pickupAt?: Date): Promise<string | null> {
  const config = await loadBranchScheduleConfig(branchId);
  const verdict = config ? validateReturnTime(config, endAt, { pickupAt }) : null;
  if (verdict?.status !== "RETURN_OUTSIDE_HOURS") return null;
  if (verdict.reason === "CLOSED_DAY") {
    return `The branch is closed on ${verdict.closedDayName ?? "that day"}; agree the return with the customer`;
  }
  if (verdict.reason === "BEFORE_OPEN") {
    return `That is before the branch opens (${verdict.openingTime ?? "opening time"}); agree the return with the customer`;
  }
  return `That is after the branch's last return time (${verdict.gracePeriodEnd ?? verdict.closingTime ?? "closing"}); agree the return with the customer`;
}

/**
 * returnShift of a booking already handed over (the session settle responses,
 * screens re-reading it). null before the handover or for bookings handed over
 * before this rule (no pickedUpAt).
 */
export async function loadReturnShift(bookingId: number, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ReturnShift | null> {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      branchId: true,
      startAt: true,
      endAt: true,
      pickedUpAt: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      pickupDelayMinutes: true,
      pickupShiftCapReason: true,
    },
  });
  if (!b) return null;
  const stored = storedReturnShift(b);
  if (!stored) return null;
  const shiftedEnd = new Date(Date.parse(stored.scheduledEndAt) + stored.appliedMinutes * 60_000);
  const note = stored.shifted ? await afterHoursNoteFor(b.branchId, shiftedEnd, new Date(Date.parse(stored.startAt))) : null;
  return { ...stored, afterHours: !!note, message: note ? `${stored.message}. ${note}` : stored.message };
}

/** returnShift for a booking already handed over (screens re-reading it). null before the handover. */
export function storedReturnShift(b: {
  pickedUpAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  startAt: Date;
  endAt: Date;
  pickupDelayMinutes: number | null;
  pickupShiftCapReason: string | null;
}): Omit<ReturnShift, "afterHours"> | null {
  if (!b.pickedUpAt || !b.scheduledEndAt || !b.scheduledStartAt) return null;
  const appliedMinutes = Math.round((b.startAt.getTime() - b.scheduledStartAt.getTime()) / 60_000);
  const delayMinutes = b.pickupDelayMinutes ?? 0;
  const capReason = (b.pickupShiftCapReason as PickupShiftCapReason | null) ?? null;
  const capped = appliedMinutes < delayMinutes;
  return {
    pickedUpAt: b.pickedUpAt.toISOString(),
    scheduledStartAt: b.scheduledStartAt.toISOString(),
    scheduledEndAt: b.scheduledEndAt.toISOString(),
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    delayMinutes,
    appliedMinutes,
    shifted: appliedMinutes > 0,
    capped,
    capReason,
    message: returnShiftMessage({
      scheduledEndAt: b.scheduledEndAt,
      endAt: new Date(b.scheduledEndAt.getTime() + appliedMinutes * 60_000),
      delayMinutes,
      appliedMinutes,
      capped,
      capReason,
    }),
  };
}
