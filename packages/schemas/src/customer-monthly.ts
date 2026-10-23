/**
 * Customer "Monthly" booking (client TODO items 1–3, Oct 23 2026). Keep in sync
 * with mobile/lib/monthlyPlan.ts.
 *
 * On the customer booking panel the customer picks Daily (the existing flow:
 * 12 h to 30 days) or Monthly: exactly CUSTOMER_MONTHLY_DAYS × 24 h from the
 * chosen pickup, priced at the vehicle's own monthly price. It is saved like
 * the counter monthly plan (Booking.rentalPeriodType = MONTHLY), so Fleet / BM
 * list it the same way. Staff keep the counter plan's 30–180-day rule
 * (MONTHLY_MIN_DAYS / MONTHLY_MAX_DAYS in booking-window.ts); a customer's
 * monthly booking is always exactly 30 days.
 */

/** Length of a customer monthly booking (days of 24 h). */
export const CUSTOMER_MONTHLY_DAYS = 30;
/** How the customer apps name it. */
export const CUSTOMER_MONTHLY_LABEL = "Monthly · 30 days";

/** Booking plan sent by the customer apps (absent on old builds = STANDARD). */
export const BOOKING_PLANS = ["STANDARD", "MONTHLY"] as const;
export type BookingPlan = (typeof BOOKING_PLANS)[number];

/** Error codes of the customer monthly booking. */
export const MONTHLY_PRICE_NOT_SET = "MONTHLY_PRICE_NOT_SET";
export const MONTHLY_PRICE_NOT_SET_MESSAGE =
  "This vehicle has no monthly price yet, so it can't be booked on the monthly plan. Choose another vehicle or book it daily.";
export const CUSTOMER_MONTHLY_LENGTH = "CUSTOMER_MONTHLY_LENGTH";
export const CUSTOMER_MONTHLY_LENGTH_MESSAGE = `A monthly booking is exactly ${CUSTOMER_MONTHLY_DAYS} days: the return is ${CUSTOMER_MONTHLY_DAYS} days after the pickup, at the same time.`;
export const MONTHLY_COUPON_NOT_ALLOWED = "MONTHLY_COUPON_NOT_ALLOWED";
export const MONTHLY_COUPON_NOT_ALLOWED_MESSAGE =
  "Coupons can't be used on a monthly booking. The monthly price already applies.";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Clients send times to the minute; anything within a minute of 30 days counts. */
const TOLERANCE_MS = 60 * 1000;

/** The return of a customer monthly booking: pickup + 30 × 24 h. */
export function customerMonthlyEnd(startAt: Date | string): Date {
  return new Date(new Date(startAt).getTime() + CUSTOMER_MONTHLY_DAYS * DAY_MS);
}

/** True when endAt − startAt is exactly 30 × 24 h (within a minute). */
export function isCustomerMonthlyLength(startAt: Date | string, endAt: Date | string): boolean {
  const span = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Number.isFinite(span) && Math.abs(span - CUSTOMER_MONTHLY_DAYS * DAY_MS) < TOLERANCE_MS;
}

/**
 * Reads a `plan` request value: undefined / null / "" → undefined (old
 * builds: the daily flow), "STANDARD" / "MONTHLY" (any case) → that plan,
 * anything else → null (invalid).
 */
export function parseBookingPlan(value: unknown): BookingPlan | undefined | null {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (BOOKING_PLANS as readonly string[]).includes(upper) ? (upper as BookingPlan) : null;
}
