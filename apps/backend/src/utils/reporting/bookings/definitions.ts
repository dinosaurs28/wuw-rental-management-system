/**
 * Admin Reports — booking / customer / staff business rules (3.1–3.5, 7.1, 7.2, 8.1, 8.2).
 * Pure functions only (unit-tested in definitions.test.ts); the services read the
 * database and apply these.
 *
 * DATE ANCHOR — every booking-level report selects bookings by Booking.startAt (the
 * scheduled pickup) in the IST range, like the rest of the reporting core, so 3.1's
 * status counts, 3.2's cancellations and 3.3–3.5's figures all add up for one filter.
 * Staff activity (8.2) is anchored on when each action happened (see below).
 *
 * BOOKINGS — HOLD / HOLD_EXPIRED are never bookings (an unpaid checkout), nor is a
 * failed online checkout (CANCELLED + paymentStatus FAILED + no cancelledAt).
 *
 * STATUS (3.1): Upcoming = CONFIRMED (booked, not yet picked up — includes a missed
 * pickup that hasn't been cancelled yet), Active = PICKED_UP, Completed = RETURNED,
 * Cancelled = CANCELLED.
 *
 * NO-SHOW (3.2): the system records it. A no-show is a CANCELLED booking cancelled
 * through the no-show path — the daily auto-cancel (CONFIRMED and paid, 24 h past
 * startAt, reason "Auto-cancelled: Customer no-show …") or the manager's Cancel
 * No-Show (AuditLog CANCEL_BOOKING_NO_SHOW) — or whose cancellation reason says
 * "no show". A CONFIRMED booking 24 h past its startAt that nobody has cancelled yet
 * is a "missed pickup": shown separately, not counted as a no-show or as lost.
 *
 * CANCELLATION TYPE: No-show; Manager cancel (cancellationSource MANUAL_BM);
 * Displaced by an extension (displacedByExtensionId set); Other (anything else — the
 * system does not record who cancelled older rows).
 *
 * ESTIMATED REVENUE LOST (3.2) per cancelled booking:
 *   booked rent = totalFinal − totalDeposit (GST-inclusive rent after discounts, as
 *                 Finance's "rent")
 *   money kept  = max(0, money in (confirmed + awaiting confirmation) − refunds paid out)
 *   rent kept   = min(booked rent, money kept)  (e.g. a forfeited advance)
 *   lost        = booked rent − rent kept
 *   Limitation: a deposit the customer paid and was not refunded counts as kept.
 *
 * LEAD TIME (3.4) = createdAt → startAt, in hours (never negative: a walk-in created a
 * moment after its start is 0).
 * DURATION (3.4): booked = startAt → endAt (endAt already includes confirmed
 * extensions); actual = startAt → returnedAt, completed bookings with a recorded
 * return only. Both are shown; the headline is booked.
 *
 * LATE RETURN (3.5) = a RETURNED booking whose returnedAt is after endAt (endAt
 * includes extensions). Late minutes = returnedAt − endAt. Whether a fee was charged
 * (grace, under one hour, waived, rate missing) is the drop bill's call: see the fee.
 * Overdue now = PICKED_UP with endAt in the past (snapshot, not a late return yet).
 *
 * NEW vs REPEAT customer (7.1): NEW when the customer's first-ever booking (CONFIRMED /
 * PICKED_UP / RETURNED, any branch, any category) starts inside the period; REPEAT
 * when they had one starting before it.
 *
 * BOOKING SOURCE (3.3): App = created by the customer (createdBy role CUSTOMER);
 * Walk-in = created by staff / a manager / an admin at the counter.
 *
 * HANDOVER PERFORMER (8.2): who did a pickup / drop — the settled pickup / drop bill
 * (whoever recorded its last payment, else who opened it), else the activity entry
 * the legacy pickup / drop wrote, else the employee who sent it for the manager's
 * approval, else the manager who confirmed it, else whoever recorded the fuel /
 * licence reading. Unknown when nothing records it.
 */
import { Role } from "@repo/database/client";

export const NO_SHOW_GRACE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Status ────────────────────────────────────────────────────────────────────

export const STATUS_BUCKETS = ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];
export const STATUS_BUCKET_LABELS: Record<StatusBucket, string> = {
  UPCOMING: "Upcoming",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function statusBucket(status: string): StatusBucket | null {
  switch (status) {
    case "CONFIRMED":
      return "UPCOMING";
    case "PICKED_UP":
      return "ACTIVE";
    case "RETURNED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
}

/** A failed online checkout: CANCELLED by the payment failure, never a booking. */
export function isFailedCheckout(b: { status: string; paymentStatus: string; cancelledAt: Date | null }): boolean {
  return b.status === "CANCELLED" && b.paymentStatus === "FAILED" && b.cancelledAt === null;
}

// ── Cancellations / no-shows ──────────────────────────────────────────────────

export const CANCELLATION_TYPES = ["NO_SHOW", "MANUAL_BM", "DISPLACED", "OTHER"] as const;
export type CancellationType = (typeof CANCELLATION_TYPES)[number];
export const CANCELLATION_TYPE_LABELS: Record<CancellationType, string> = {
  NO_SHOW: "No-show",
  MANUAL_BM: "Manager cancel",
  DISPLACED: "Displaced by an extension",
  OTHER: "Other / not recorded",
};

const NO_SHOW_RE = /\bno[\s-]?show\b/i;

export function isNoShowReason(reason: string | null | undefined): boolean {
  return !!reason && NO_SHOW_RE.test(reason);
}

export function classifyCancellation(b: {
  cancellationSource: string | null;
  cancellationReason: string | null;
  displacedByExtensionId: number | null;
  /** an AuditLog CANCEL_BOOKING_NO_SHOW row exists for it */
  noShowAudit: boolean;
}): CancellationType {
  if (b.noShowAudit || isNoShowReason(b.cancellationReason)) return "NO_SHOW";
  if (b.cancellationSource === "MANUAL_BM") return "MANUAL_BM";
  if (b.displacedByExtensionId != null) return "DISPLACED";
  return "OTHER";
}

/** CONFIRMED, 24 h past its start, not picked up and not cancelled yet. */
export function isMissedPickup(b: { status: string; startAt: Date }, now: Date): boolean {
  return b.status === "CONFIRMED" && b.startAt.getTime() + NO_SHOW_GRACE_HOURS * HOUR_MS <= now.getTime();
}

export interface RevenueLost {
  bookedRent: number;
  moneyKept: number;
  rentKept: number;
  lost: number;
}

export function estimatedRevenueLost(b: {
  totalFinal: number;
  totalDeposit: number;
  /** confirmed + awaiting-confirmation money in (refund rows excluded) */
  moneyIn: number;
  refundedOut: number;
}): RevenueLost {
  const bookedRent = r2(Math.max(0, b.totalFinal - b.totalDeposit));
  const moneyKept = r2(Math.max(0, b.moneyIn - b.refundedOut));
  const rentKept = r2(Math.min(bookedRent, moneyKept));
  return { bookedRent, moneyKept, rentKept, lost: r2(bookedRent - rentKept) };
}

// ── Source ────────────────────────────────────────────────────────────────────

export const SOURCES = ["APP", "WALK_IN"] as const;
export type SourceKey = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<SourceKey, string> = { APP: "App / online", WALK_IN: "Walk-in (counter)" };

export function bookingSourceOf(creatorRole: string | null | undefined): SourceKey {
  return creatorRole === Role.CUSTOMER ? "APP" : "WALK_IN";
}

// ── Lead time / duration ──────────────────────────────────────────────────────

export function leadTimeHours(createdAt: Date, startAt: Date): number {
  return r2(Math.max(0, (startAt.getTime() - createdAt.getTime()) / HOUR_MS));
}

export const LEAD_BUCKETS = ["UNDER_1H", "SAME_DAY", "D1_3", "D4_7", "D8_30", "D30_PLUS"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];
export const LEAD_BUCKET_LABELS: Record<LeadBucket, string> = {
  UNDER_1H: "Under 1 hour",
  SAME_DAY: "1–24 hours",
  D1_3: "1–3 days",
  D4_7: "4–7 days",
  D8_30: "8–30 days",
  D30_PLUS: "Over 30 days",
};

export function leadBucket(hours: number): LeadBucket {
  if (hours < 1) return "UNDER_1H";
  if (hours < 24) return "SAME_DAY";
  if (hours <= 72) return "D1_3";
  if (hours <= 168) return "D4_7";
  if (hours <= 720) return "D8_30";
  return "D30_PLUS";
}

export function bookedDurationHours(startAt: Date, endAt: Date): number {
  return r2(Math.max(0, (endAt.getTime() - startAt.getTime()) / HOUR_MS));
}

/** null unless the booking is completed with a recorded return time. */
export function actualDurationHours(b: { status: string; startAt: Date; returnedAt: Date | null }): number | null {
  if (b.status !== "RETURNED" || !b.returnedAt) return null;
  return r2(Math.max(0, (b.returnedAt.getTime() - b.startAt.getTime()) / HOUR_MS));
}

// ── Late returns ──────────────────────────────────────────────────────────────

/** Minutes late (> 0) for a completed booking returned after endAt, else 0. */
export function lateMinutes(b: { status: string; endAt: Date; returnedAt: Date | null }): number {
  if (b.status !== "RETURNED" || !b.returnedAt) return 0;
  const ms = b.returnedAt.getTime() - b.endAt.getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

export function isOverdueNow(b: { status: string; endAt: Date }, now: Date): boolean {
  return b.status === "PICKED_UP" && b.endAt.getTime() < now.getTime();
}

// ── Customers ─────────────────────────────────────────────────────────────────

export type CustomerType = "NEW" | "REPEAT";

export function customerTypeOf(firstEverStartAt: Date | null, periodStart: Date): CustomerType {
  return !firstEverStartAt || firstEverStartAt.getTime() >= periodStart.getTime() ? "NEW" : "REPEAT";
}

// ── Handover performer ────────────────────────────────────────────────────────

export type HandoverMarkerKind =
  | "SESSION" // settled pickup / drop bill
  | "COMPLETED" // legacy pickup / drop activity entry
  | "SENT_TO_MANAGER" // employee sent it for approval
  | "MANAGER_CONFIRMED"
  | "RECORDED"; // a reading written at the handover

export interface HandoverMarker {
  kind: HandoverMarkerKind;
  at: Date;
  userId: number | null;
}

const PERFORMER_PRIORITY: HandoverMarkerKind[] = ["SESSION", "COMPLETED", "SENT_TO_MANAGER", "MANAGER_CONFIRMED", "RECORDED"];

/** Who physically did the handover (see the header). Latest marker of the best kind with a user. */
export function pickHandoverPerformer(markers: HandoverMarker[]): { userId: number | null; at: Date | null } {
  for (const kind of PERFORMER_PRIORITY) {
    const hit = markers
      .filter((m) => m.kind === kind && m.userId != null)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (hit) return { userId: hit.userId, at: hit.at };
  }
  return { userId: null, at: null };
}

// ── Small maths ───────────────────────────────────────────────────────────────

export function average(values: number[]): number | null {
  return values.length ? r2(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

export function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? r2((part / whole) * 100) : null;
}
