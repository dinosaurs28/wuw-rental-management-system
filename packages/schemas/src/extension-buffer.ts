/**
 * Extension buffer (client request, Oct 2026): an extension's new return must
 * be at least EXTENSION_BUFFER_HOURS before the next pickup on the same car
 * (a CONFIRMED booking, or a checkout in progress: a live HOLD row or a Redis
 * hold). The same rule binds a swap-to-another-car extension: the replacement
 * must be free until the extended return, and its next pickup must be at
 * least this long after it.
 *
 * New bookings keep their own, longer turnaround (BOOKING_TURNAROUND_HOURS).
 * The backend works out "available until" (next pickup − buffer, rounded down
 * to EXTENSION_SLOT_MINUTES, capped by the rental-length limit) and returns
 * it. Web and mobile only display it.
 */

/** Hours kept free between an extended return and the car's next pickup. */
export const EXTENSION_BUFFER_HOURS = 2;
export const EXTENSION_BUFFER_MS = EXTENSION_BUFFER_HOURS * 60 * 60 * 1000;

/**
 * "Available until" and a partial extension's end are rounded down to this
 * grid: the staff pickers offer :00 / :30 (mobile) and 15-minute steps (web),
 * and IST's +5:30 offset keeps a 30-minute UTC grid on IST :00 / :30.
 */
export const EXTENSION_SLOT_MINUTES = 30;

/**
 * Which limit decides "available until":
 * NEXT_BOOKING: EXTENSION_BUFFER_HOURS before the car's next pickup;
 * MAX_RENTAL_PERIOD: the rental-length cap (30 days, or 180 for a monthly plan).
 */
export type ExtensionLimitReason = "NEXT_BOOKING" | "MAX_RENTAL_PERIOD";
