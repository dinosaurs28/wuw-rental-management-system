/**
 * Customer "Monthly · 30 days" booking (client TODO items 1–3, Oct 23 2026).
 * Mirror of packages/schemas/src/customer-monthly.ts — keep in sync.
 *
 * Monthly = exactly 30 × 24 h from the chosen pickup (same clock time), at each
 * vehicle's own monthly price. The return is computed, never picked; package
 * chips are hidden. The server checks the same rule (CUSTOMER_MONTHLY_LENGTH).
 * Daily (STANDARD) is the existing flow, unchanged; old builds send no plan.
 */
export const CUSTOMER_MONTHLY_DAYS = 30;
export const CUSTOMER_MONTHLY_LABEL = 'Monthly · 30 days';

export type BookingPlan = 'STANDARD' | 'MONTHLY';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The return of a monthly booking: pickup + 30 × 24 h. */
export function monthlyEnd(start: Date): Date {
  return new Date(start.getTime() + CUSTOMER_MONTHLY_DAYS * DAY_MS);
}

/** Route / request param value → plan (anything but MONTHLY = Daily). */
export function parsePlan(value: unknown): BookingPlan {
  return typeof value === 'string' && value.trim().toUpperCase() === 'MONTHLY' ? 'MONTHLY' : 'STANDARD';
}

/** `plan` request / route param: only sent for Monthly (Daily requests stay as before). */
export function planParam(plan: BookingPlan | null | undefined): { plan?: 'MONTHLY' } {
  return plan === 'MONTHLY' ? { plan: 'MONTHLY' } : {};
}

/** "Monthly · 30 days" (or "Monthly · N days" for a longer counter plan). */
export function monthlyLabel(days?: number | null): string {
  return days && days !== CUSTOMER_MONTHLY_DAYS ? `Monthly · ${days} days` : CUSTOMER_MONTHLY_LABEL;
}

/** Server error codes of a monthly booking. */
export const MONTHLY_PRICE_NOT_SET = 'MONTHLY_PRICE_NOT_SET';
export const MONTHLY_PRICE_NOT_SET_TEXT = 'Monthly price not set';
