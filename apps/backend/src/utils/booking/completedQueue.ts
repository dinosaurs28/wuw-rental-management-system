import { BookingStatus, PaymentSessionStatus, PaymentSessionType, Prisma } from "@repo/database/client";
import { bookingTypeWhere, type BookingListType } from "./bookingTypeFilter.js";

/**
 * Completed pickups and returns kept in the Fleet queues (client item 1, Oct 2026).
 *
 * A pickup / return stays on its queue day after it is done, tagged Completed
 * (or "Awaiting manager" when it was sent for the branch manager's
 * confirmation), and opens a read-only summary instead of the workflow.
 *
 * The queue endpoints add them only for clients that send `includeCompleted=1`
 * (in a separate `completed` array); older app builds get the exact old
 * response. With the flag, the waiting list and its counts leave out the
 * awaiting-manager rows — they are listed as completed.
 *
 * Which day a completed row belongs to (both tabs): its scheduled day, like
 * the waiting list (pickup: startAt, return: endAt), AND the day it was
 * actually done (pickup: when it was completed, return: returnedAt) — once when
 * both are the same day. So an overdue return finished today, or a monthly
 * rental picked up a day late, is listed today too.
 */

export type QueuePhase = "PICKUP" | "RETURN";
export type QueueItemState = "PENDING" | "COMPLETED" | "AWAITING_MANAGER";

export interface QueueStateInput {
  status: string;
  requiresManagerConfirmation: boolean;
}

/** Where a booking stands on the pickup queue; null = not a pickup-queue booking (hold, cancelled …). */
export function pickupQueueState(booking: QueueStateInput): QueueItemState | null {
  if (booking.status === BookingStatus.CONFIRMED) {
    // Handover recorded and sent to a manager: nothing left for Fleet to do
    return booking.requiresManagerConfirmation ? "AWAITING_MANAGER" : "PENDING";
  }
  if (booking.status === BookingStatus.PICKED_UP || booking.status === BookingStatus.RETURNED) {
    return "COMPLETED";
  }
  return null;
}

/** Where a booking stands on the return queue; null = not on it (not picked up yet, cancelled …). */
export function returnQueueState(booking: QueueStateInput): QueueItemState | null {
  if (booking.status === BookingStatus.PICKED_UP) {
    // Legacy drop recorded and sent to a manager: the car is back
    return booking.requiresManagerConfirmation ? "AWAITING_MANAGER" : "PENDING";
  }
  if (booking.status === BookingStatus.RETURNED) return "COMPLETED";
  return null;
}

export function queueStateOf(phase: QueuePhase, booking: QueueStateInput): QueueItemState | null {
  return phase === "PICKUP" ? pickupQueueState(booking) : returnQueueState(booking);
}

/** `?includeCompleted=` — only "1" / "true" / "yes" (any case) turn it on. */
export function parseIncludeCompleted(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** Waiting-list filter fragment: with includeCompleted the awaiting-manager rows move to `completed`. */
export function pendingOnlyWhere(includeCompleted: boolean): Prisma.BookingWhereInput {
  return includeCompleted ? { requiresManagerConfirmation: false } : {};
}

export interface DayRange {
  gte: Date;
  lte: Date;
}

/**
 * Candidate bookings whose pickup is done (or waiting on a manager) for the day
 * / tab: scheduled that day, or with a pickup event that day — a reading written
 * at it, its settled pickup bill, or (`activityRefs`) a pickup activity entry.
 * Narrow the result with onQueueDay once the completion time is known.
 */
export function completedPickupWhere(
  branchId: number,
  type: BookingListType | undefined,
  day: DayRange,
  activityRefs: string[] = [],
): Prisma.BookingWhereInput {
  const range = { gte: day.gte, lte: day.lte };
  return {
    branchId,
    AND: [
      bookingTypeWhere(type),
      {
        OR: [
          { status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED] } },
          { status: BookingStatus.CONFIRMED, requiresManagerConfirmation: true },
        ],
      },
      {
        OR: [
          { startAt: range },
          { licenseCollectedAt: range },
          { fuelRecord: { pickupAt: range } },
          {
            paymentSessions: {
              some: { sessionType: PaymentSessionType.PICKUP, status: PaymentSessionStatus.COMPLETED, completedAt: range },
            },
          },
          ...(activityRefs.length ? [{ publicId: { in: activityRefs } }] : []),
        ],
      },
    ],
  };
}

/** Bookings whose return is done (or waiting on a manager): due that day, or returned that day. */
export function completedReturnWhere(
  branchId: number,
  type: BookingListType | undefined,
  day: DayRange,
): Prisma.BookingWhereInput {
  const range = { gte: day.gte, lte: day.lte };
  return {
    branchId,
    AND: [
      bookingTypeWhere(type),
      {
        OR: [
          { status: BookingStatus.RETURNED },
          { status: BookingStatus.PICKED_UP, requiresManagerConfirmation: true },
        ],
      },
      { OR: [{ endAt: range }, { returnedAt: range }] },
    ],
  };
}

/** A completed row is listed on its scheduled day and on the day it was actually done. */
export function onQueueDay(scheduledAt: Date, completedAt: Date | null, day: DayRange): boolean {
  const inDay = (d: Date) => d.getTime() >= day.gte.getTime() && d.getTime() <= day.lte.getTime();
  return inDay(scheduledAt) || (completedAt != null && inDay(completedAt));
}

// ── Who completed it, and when ───────────────────────────────────────────────

/**
 * Evidence of a completed pickup / return, best first:
 *  - SESSION            the pickup / drop bill was settled (payment-session branches)
 *  - COMPLETED          legacy pickup / drop submitted by Fleet
 *  - MANAGER_CONFIRMED  the branch manager confirmed a pickup / drop sent to them
 *  - SENT_TO_MANAGER    submitted for the manager's confirmation
 *  - RECORDED           a reading written at the pickup / drop (fallback for old rows)
 */
export type CompletionMarkerKind =
  | "SESSION"
  | "COMPLETED"
  | "MANAGER_CONFIRMED"
  | "SENT_TO_MANAGER"
  | "RECORDED";

export interface CompletionMarker {
  kind: CompletionMarkerKind;
  at: Date;
  byName: string | null;
}

export interface CompletionInfo {
  at: Date | null;
  byName: string | null;
}

const DONE_KINDS: CompletionMarkerKind[] = ["SESSION", "COMPLETED", "MANAGER_CONFIRMED"];

const latestFirst = (a: CompletionMarker, b: CompletionMarker) => b.at.getTime() - a.at.getTime();

/**
 * When and by whom a completed (or awaiting-manager) pickup / return was done:
 * the latest matching event; else the latest reading written at it, with the
 * name of whoever wrote one. Nulls when nothing records it (very old rows).
 */
export function pickCompletion(state: QueueItemState, markers: CompletionMarker[]): CompletionInfo {
  const wanted: CompletionMarkerKind[] = state === "AWAITING_MANAGER" ? ["SENT_TO_MANAGER"] : DONE_KINDS;
  const recorded = markers.filter((m) => m.kind === "RECORDED").sort(latestFirst);
  const recordedName = recorded.find((m) => m.byName)?.byName ?? null;
  const event = markers.filter((m) => wanted.includes(m.kind)).sort(latestFirst)[0];
  if (event) return { at: event.at, byName: event.byName ?? recordedName };
  if (state === "PENDING") return { at: null, byName: null };
  return { at: recorded[0]?.at ?? null, byName: recordedName };
}

/**
 * Kind of a Fleet / manager BOOKING activity entry for this phase, or null when
 * it is about something else. The pickup / drop endpoints write:
 *   CONFIRMED  "Vehicle pickup confirmed for booking …" (legacy pickup)
 *   COMPLETED  "Vehicle return completed for booking …" (legacy drop)
 *   CONFIRMED  "Manager confirmed vehicle pickup|return for booking …"
 *   INITIATED  "Pickup|Return approval requested for booking …"
 * The booking reference is cut off first so an id can't match a word.
 */
export function activityMarkerKind(
  phase: QueuePhase,
  entry: { actionType: string; description: string },
): CompletionMarkerKind | null {
  const text = entry.description.split(" for booking ")[0]!.toLowerCase();
  const word = phase === "PICKUP" ? "pickup" : "return";
  if (!new RegExp(`\\b${word}\\b`).test(text)) return null;
  if (entry.actionType === "INITIATED") return text.includes("approval requested") ? "SENT_TO_MANAGER" : null;
  if (text.startsWith("manager confirmed")) return entry.actionType === "CONFIRMED" ? "MANAGER_CONFIRMED" : null;
  if (phase === "PICKUP") return entry.actionType === "CONFIRMED" ? "COMPLETED" : null;
  return entry.actionType === "COMPLETED" ? "COMPLETED" : null;
}

/** Completed rows in the order they were done (unknown times last, then by schedule). */
export function sortCompletedQueue<T>(
  rows: T[],
  keyOf: (row: T) => { completedAt: Date | null; scheduledAt: Date },
): T[] {
  const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const byCompletion = time(ka.completedAt) - time(kb.completedAt);
    // Infinity − Infinity is NaN: both unknown, fall through to the schedule
    return (Number.isNaN(byCompletion) ? 0 : byCompletion) || ka.scheduledAt.getTime() - kb.scheduledAt.getTime();
  });
}
