/**
 * Completed pickups / returns on the Fleet queues (client item 1, Oct 2026):
 * the rows of a day / tab and who completed each one, and when.
 *
 * The rules (which day a row belongs to, which event counts as completing it)
 * are in utils/booking/completedQueue.ts. Here they are read from the database:
 *  - the settled pickup / drop bill (PaymentSession COMPLETED) and who recorded
 *    its last payment
 *  - the activity entries the pickup / drop / manager-confirm endpoints write
 *  - readings written at the pickup / drop, for rows older than both
 */
import {
  prisma,
  Prisma,
  LedgerEntryClassification,
  PaymentSessionStatus,
  PaymentSessionType,
  StaffActionType,
  StaffEntityType,
} from "@repo/database/client";
import { bookingListTypeOf, type BookingListType } from "../../utils/booking/bookingTypeFilter.js";
import { displayEmail } from "../../utils/customer/identity.js";
import { fleetSearchBookingWhere } from "../../utils/booking/fleetSearch.js";
import {
  activityMarkerKind,
  completedPickupWhere,
  completedReturnWhere,
  onQueueDay,
  pickCompletion,
  queueStateOf,
  sortCompletedQueue,
  type CompletionInfo,
  type CompletionMarker,
  type DayRange,
  type QueuePhase,
} from "../../utils/booking/completedQueue.js";

/** Booking fields the completion time / person is read from. */
export const completionMarkerSelect = {
  id: true,
  publicId: true,
  status: true,
  startAt: true,
  requiresManagerConfirmation: true,
  licenseCollectedAt: true,
  returnedAt: true,
  fuelRecord: {
    select: {
      pickupAt: true,
      returnAt: true,
      capturedByPickup: { select: { name: true } },
      capturedByReturn: { select: { name: true } },
    },
  },
} satisfies Prisma.BookingSelect;

export type CompletionMarkerBooking = Prisma.BookingGetPayload<{ select: typeof completionMarkerSelect }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When and by whom each booking's pickup / return was completed (keyed by Booking.id). */
export async function loadCompletionInfo(
  phase: QueuePhase,
  bookings: CompletionMarkerBooking[],
): Promise<Map<number, CompletionInfo>> {
  const result = new Map<number, CompletionInfo>();
  if (bookings.length === 0) return result;

  const ids = bookings.map((b) => b.id);
  // Activity entries can't predate the rental: bound the scan by createdAt (indexed)
  const since = new Date(Math.min(...bookings.map((b) => b.startAt.getTime())) - 2 * DAY_MS);
  const [sessions, activity] = await Promise.all([
    prisma.paymentSession.findMany({
      where: {
        bookingId: { in: ids },
        sessionType: phase === "PICKUP" ? PaymentSessionType.PICKUP : PaymentSessionType.RETURN,
        status: PaymentSessionStatus.COMPLETED,
      },
      select: { id: true, bookingId: true, completedAt: true, updatedAt: true, actor: { select: { name: true } } },
    }),
    prisma.staffActivityLog.findMany({
      where: {
        entityType: StaffEntityType.BOOKING,
        entityRef: { in: bookings.map((b) => b.publicId) },
        actionType: { in: [StaffActionType.CONFIRMED, StaffActionType.COMPLETED, StaffActionType.INITIATED] },
        createdAt: { gte: since },
      },
      select: { entityRef: true, actionType: true, description: true, actorName: true, createdAt: true },
    }),
  ]);

  // Who settled each bill: whoever recorded its last payment / refund
  const payments = sessions.length
    ? await prisma.ledgerEntry.findMany({
        where: {
          sessionId: { in: sessions.map((s) => s.id) },
          classification: LedgerEntryClassification.PAYMENT,
          isVoided: false,
        },
        orderBy: { createdAt: "desc" },
        select: { sessionId: true, actor: { select: { name: true } } },
      })
    : [];
  const settledBy = new Map<number, string>();
  for (const p of payments) if (!settledBy.has(p.sessionId)) settledBy.set(p.sessionId, p.actor.name);

  for (const booking of bookings) {
    const state = queueStateOf(phase, booking);
    if (!state) continue;
    const markers: CompletionMarker[] = [];
    for (const s of sessions) {
      if (s.bookingId !== booking.id) continue;
      markers.push({ kind: "SESSION", at: s.completedAt ?? s.updatedAt, byName: settledBy.get(s.id) ?? s.actor.name });
    }
    for (const entry of activity) {
      if (entry.entityRef !== booking.publicId) continue;
      const kind = activityMarkerKind(phase, entry);
      if (kind) markers.push({ kind, at: entry.createdAt, byName: entry.actorName });
    }
    const fuel = booking.fuelRecord;
    if (phase === "PICKUP") {
      if (fuel?.pickupAt) markers.push({ kind: "RECORDED", at: fuel.pickupAt, byName: fuel.capturedByPickup?.name ?? null });
      if (booking.licenseCollectedAt) markers.push({ kind: "RECORDED", at: booking.licenseCollectedAt, byName: null });
    } else {
      const returnName = fuel?.capturedByReturn?.name ?? null;
      if (booking.returnedAt) markers.push({ kind: "RECORDED", at: booking.returnedAt, byName: returnName });
      if (fuel?.returnAt) markers.push({ kind: "RECORDED", at: fuel.returnAt, byName: returnName });
    }
    result.set(booking.id, pickCompletion(state, markers));
  }
  return result;
}

/** JSON of a completion for clients. */
export function serializeCompletion(info: CompletionInfo | undefined) {
  return { at: info?.at?.toISOString() ?? null, byName: info?.byName ?? null };
}

/** What a completed queue row shows (the waiting rows' fields, plus the completion). */
const completedRowSelect = {
  ...completionMarkerSelect,
  endAt: true,
  rentalPeriodType: true,
  dlStatus: true,
  dlDepositNote: true,
  days: true,
  totalFinal: true,
  isAdvancePayment: true,
  advanceAmount: true,
  remainingBalance: true,
  remainingPaidAt: true,
  remainingPaidDuring: true,
  customer: {
    select: {
      user: { select: { publicId: true, name: true, email: true, phone: true } },
    },
  },
  items: {
    select: {
      vehicle: {
        select: {
          publicId: true,
          make: true,
          model: true,
          regNo: true,
          status: true,
          images: {
            where: { isThumbnail: true },
            take: 1,
            select: { file: { select: { url: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

/**
 * The completed (or awaiting-manager) pickups / returns of a day and tab, in
 * the order they were done. Each row has `completed: { at, byName }` and
 * `awaitingManager`.
 */
export async function listCompletedQueue(
  phase: QueuePhase,
  opts: {
    branchId: number;
    type: BookingListType | undefined;
    day: DayRange;
    /** Fleet search (`q`): only bookings with one of these vehicles */
    vehicleIds?: number[];
  },
) {
  const range = { gte: opts.day.gte, lte: opts.day.lte };
  // Pickups completed / sent to a manager that day per their activity entry (no booking column for it)
  const activityRefs =
    phase === "PICKUP"
      ? (
          await prisma.staffActivityLog.findMany({
            where: {
              branchId: opts.branchId,
              entityType: StaffEntityType.BOOKING,
              actionType: { in: [StaffActionType.CONFIRMED, StaffActionType.INITIATED] },
              createdAt: range,
            },
            select: { entityRef: true, actionType: true, description: true },
          })
        )
          .filter((entry) => activityMarkerKind("PICKUP", entry) != null)
          .map((entry) => entry.entityRef)
      : [];
  const phaseWhere =
    phase === "PICKUP"
      ? completedPickupWhere(opts.branchId, opts.type, opts.day, [...new Set(activityRefs)])
      : completedReturnWhere(opts.branchId, opts.type, opts.day);
  const rows = await prisma.booking.findMany({
    where: opts.vehicleIds ? { AND: [phaseWhere, fleetSearchBookingWhere(opts.vehicleIds)] } : phaseWhere,
    select: completedRowSelect,
  });
  const info = await loadCompletionInfo(phase, rows);
  // Pickup candidates came from any event that day: keep those scheduled or completed that day.
  // Returns are matched exactly (endAt / returnedAt).
  const listed =
    phase === "PICKUP"
      ? rows.filter((row) => onQueueDay(row.startAt, info.get(row.id)?.at ?? null, opts.day))
      : rows;
  const items = listed.map((row) => {
    const { id, licenseCollectedAt: _l, fuelRecord: _f, requiresManagerConfirmation: _r, customer, ...rest } = row;
    const completion = info.get(id);
    return {
      ...rest,
      // Walk-in placeholder emails never leave the server (#1)
      customer: { user: { ...customer.user, email: displayEmail(customer.user.email) } },
      bookingType: bookingListTypeOf(row.rentalPeriodType),
      draft: null,
      awaitingManager: queueStateOf(phase, row) === "AWAITING_MANAGER",
      completed: serializeCompletion(completion),
    };
  });
  return sortCompletedQueue(items, (r) => ({
    completedAt: r.completed.at ? new Date(r.completed.at) : null,
    scheduledAt: phase === "PICKUP" ? r.startAt : r.endAt,
  }));
}
