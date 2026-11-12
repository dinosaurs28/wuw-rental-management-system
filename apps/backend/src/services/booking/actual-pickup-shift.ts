/**
 * Rental duration starts at the actual handover (client TODO 10, Nov 2026).
 * Pure rules, no database. actual-pickup-shift.service.ts applies them inside
 * the pickup-completion transaction. Tests: actual-pickup-shift.test.ts.
 *
 * Rules:
 *  - delay = max(0, handoverAt − startAt), floored to whole minutes.
 *  - On time or EARLY (delay 0): nothing moves. An early pickup keeps the
 *    scheduled return, so the customer gets the booked time plus the early
 *    minutes and nobody loses time. The car is already free, since it is
 *    being handed over.
 *  - Late: the whole rental window slides by the delay. startAt and endAt both
 *    move by the same amount, so the booked length, and with it the price,
 *    the period type, the free km and the drop-bill timeline, never changes.
 *  - Conflicts: the slid return must leave the car free for what comes next,
 *    by the same rule as an extension (partial-extension.ts): the next
 *    booking, rental or checkout's pickup minus EXTENSION_BUFFER_HOURS, or a
 *    booking lock's effective start. A slide that would collide is CAPPED at
 *    that latest return (rounded down to the 30-minute grid). The cap is
 *    never earlier than the scheduled return: the slide only ever adds time.
 *  - Branch hours: a return that lands outside the branch's return window is
 *    kept, with a warning (afterHours). Rounding it back to the last return
 *    would take away time the customer paid for. Staff are told at handover
 *    so they can agree a return with the customer.
 */

export type PickupShiftCapReason = "NEXT_BOOKING" | "CHECKOUT" | "BOOKING_LOCK";

const MINUTE_MS = 60_000;

/** Whole minutes the handover came after the scheduled pickup (0 when on time or early). */
export function pickupDelayMinutes(startAt: Date, handoverAt: Date): number {
  return Math.max(0, Math.floor((handoverAt.getTime() - startAt.getTime()) / MINUTE_MS));
}

export interface PickupShiftPlan {
  delayMinutes: number;
  /** Minutes the window actually moved (= delayMinutes unless capped). */
  appliedMinutes: number;
  newStartAt: Date;
  newEndAt: Date;
  capped: boolean;
}

/**
 * Where the rental window goes. `latestEndAt` = the latest return the car's
 * next commitments allow (null = nothing in the way). The result is never
 * earlier than the scheduled window and never later than the full delay.
 */
export function planPickupShift(input: {
  startAt: Date;
  endAt: Date;
  handoverAt: Date;
  latestEndAt: Date | null;
}): PickupShiftPlan {
  const delayMinutes = pickupDelayMinutes(input.startAt, input.handoverAt);
  const target = input.endAt.getTime() + delayMinutes * MINUTE_MS;
  let end = target;
  if (input.latestEndAt && input.latestEndAt.getTime() < target) {
    end = Math.max(input.endAt.getTime(), input.latestEndAt.getTime());
  }
  const appliedMs = end - input.endAt.getTime();
  return {
    delayMinutes,
    appliedMinutes: Math.round(appliedMs / MINUTE_MS),
    newStartAt: new Date(input.startAt.getTime() + appliedMs),
    newEndAt: new Date(end),
    capped: end < target,
  };
}

/** "2h 30m", "45m", "3h". */
export function delayLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "14 Nov 2:30 PM" (IST). */
export function istDayTime(d: Date): string {
  return `${dayFmt.format(d)} ${istTime(d)}`;
}
/** "2:30 PM" (IST). */
export function istTime(d: Date): string {
  return timeFmt.format(d).replace(/ /g, " ");
}
const sameIstDay = (a: Date, b: Date) => dayFmt.format(a) === dayFmt.format(b);

const CAP_WORDS: Record<PickupShiftCapReason, string> = {
  NEXT_BOOKING: "the car is booked next",
  CHECKOUT: "a customer is checking out the car next",
  BOOKING_LOCK: "the car is blocked by the branch next",
};

/**
 * One line for staff and the customer, e.g.
 * "Return due 14 Nov 2:30 PM (scheduled 12:00 PM, pickup 2h 30m late)".
 */
export function returnShiftMessage(s: {
  scheduledEndAt: Date;
  endAt: Date;
  delayMinutes: number;
  appliedMinutes: number;
  capped: boolean;
  capReason: PickupShiftCapReason | null;
  afterHoursNote?: string | null;
}): string {
  const sched = sameIstDay(s.scheduledEndAt, s.endAt) ? istTime(s.scheduledEndAt) : istDayTime(s.scheduledEndAt);
  let msg: string;
  if (s.delayMinutes === 0) {
    msg = `Return due ${istDayTime(s.endAt)} (as scheduled)`;
  } else if (!s.capped) {
    msg = `Return due ${istDayTime(s.endAt)} (scheduled ${sched}, pickup ${delayLabel(s.delayMinutes)} late)`;
  } else {
    const why = s.capReason ? CAP_WORDS[s.capReason] : "the car is needed next";
    msg =
      s.appliedMinutes > 0
        ? `Return due ${istDayTime(s.endAt)} (scheduled ${sched}, pickup ${delayLabel(s.delayMinutes)} late; moved only ${delayLabel(s.appliedMinutes)} because ${why})`
        : `Return due ${istDayTime(s.endAt)} (as scheduled; pickup ${delayLabel(s.delayMinutes)} late, but the return can't move because ${why})`;
  }
  return s.afterHoursNote ? `${msg}. ${s.afterHoursNote}` : msg;
}
