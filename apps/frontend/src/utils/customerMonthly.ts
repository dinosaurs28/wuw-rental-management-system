/**
 * Customer "Monthly · 30 days" booking (client TODO items 1–3, Oct 23 2026).
 * Monthly = exactly CUSTOMER_MONTHLY_DAYS × 24 h from the chosen pickup (same
 * clock time), at each vehicle's own monthly price. The return is computed,
 * never picked; the server checks the same rule (CUSTOMER_MONTHLY_LENGTH).
 */
import { addDays } from "date-fns";
import { CUSTOMER_MONTHLY_DAYS, CUSTOMER_MONTHLY_LABEL } from "@repo/schemas";
import type { SearchPlan } from "@/store/search.store";

export { CUSTOMER_MONTHLY_DAYS, CUSTOMER_MONTHLY_LABEL };

/** The monthly return for a pickup: pickup day + 30, same time. */
export function monthlyReturn(pickupDate: Date, pickupTime: string): { returnDate: Date; returnTime: string } {
  const day = new Date(pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate());
  return { returnDate: addDays(day, CUSTOMER_MONTHLY_DAYS), returnTime: pickupTime };
}

export const isMonthlyPlan = (plan: SearchPlan | string | null | undefined): boolean => plan === "MONTHLY";

/** `plan` request param: only sent for Monthly (Daily keeps the old requests byte-for-byte). */
export const planParam = (plan: SearchPlan | string | null | undefined): { plan?: "MONTHLY" } =>
  plan === "MONTHLY" ? { plan: "MONTHLY" } : {};

/** "Monthly · 30 days" (or "Monthly · N days" for a longer counter plan). */
export function monthlyLabel(days?: number | null): string {
  return days && days !== CUSTOMER_MONTHLY_DAYS ? `Monthly · ${days} days` : CUSTOMER_MONTHLY_LABEL;
}
