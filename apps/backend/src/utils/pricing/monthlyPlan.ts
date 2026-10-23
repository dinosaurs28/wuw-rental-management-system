/**
 * Customer monthly booking (client TODO items 1–3, Oct 23 2026): which cars can
 * be booked on it and its window.
 *
 * Price: the vehicle's OWN configured monthly price — VehicleCustomPricing with
 * enabled = true and priceMonthly > 0. The branch-default priceMonthly is NOT
 * used: the client asked for each vehicle's configured price, and a car priced
 * from branch defaults has no price of its own. Such cars (and cars whose
 * custom pricing has no monthly price) are left out of Monthly results and
 * refused at create (MONTHLY_PRICE_NOT_SET). For an eligible car the pricing
 * engine's rate card IS that custom row (an enabled custom pricing always wins
 * over branch defaults), so the 30-day window is billed as priceMonthly × 1 —
 * GST-inclusive, GST split out of it, never added. User decision (Oct 23
 * 2026): no BM duration slab reduces it (PricingEngineService / batch listing
 * pricer with `monthlyPlan`, see monthlyPortion below) — the counter monthly
 * plan prices its months the same way. Listing, details, summary, create and
 * payment all run that same rule, so they show the same exact figure. The
 * price is never derived from the daily rate.
 */
import Decimal from "decimal.js";
import { customerMonthlyEnd, isCustomerMonthlyLength } from "@repo/schemas";

export { customerMonthlyEnd, isCustomerMonthlyLength };

type DecimalLike = { toString(): string } | number | string | null | undefined;

export interface MonthlyPricingSource {
  enabled?: boolean | null;
  priceMonthly?: DecimalLike;
  freeKmMonthly?: number | null;
}

/**
 * The vehicle's own monthly price (GST-inclusive), or null when it has none:
 * no custom pricing, custom pricing disabled, or priceMonthly unset / 0.
 */
export function vehicleMonthlyPrice(customPricing: MonthlyPricingSource | null | undefined): Decimal | null {
  if (!customPricing || customPricing.enabled === false) return null;
  const raw = customPricing.priceMonthly;
  if (raw == null || raw === "") return null;
  const price = new Decimal(raw.toString());
  return price.isFinite() && price.gt(0) ? price : null;
}

export const hasVehicleMonthlyPrice = (customPricing: MonthlyPricingSource | null | undefined): boolean =>
  vehicleMonthlyPrice(customPricing) !== null;

/** Prisma select for the fields vehicleMonthlyPrice reads. */
export const MONTHLY_PRICING_SELECT = { enabled: true, priceMonthly: true, freeKmMonthly: true } as const;

/** Additive response block describing a car on the monthly plan. */
export function monthlyPlanInfo(customPricing: MonthlyPricingSource | null | undefined) {
  const price = vehicleMonthlyPrice(customPricing);
  return {
    plan: "MONTHLY" as const,
    days: 30,
    /** The configured monthly price (GST-inclusive), null = "Monthly price not set" */
    priceMonthly: price ? Number(price.toFixed(2)) : null,
    freeKmMonthly: price ? customPricing?.freeKmMonthly ?? null : null,
    bookable: price !== null,
  };
}

// ── Months part of a monthly-plan price (no duration slab on it) ─────────────

const MONTH_MINUTES = 30 * 24 * 60;

export interface MonthlyPortion {
  /** Whole 30-day months billed at the monthly price */
  fullMonths: number;
  /** priceMonthly × fullMonths (GST-inclusive) — never reduced by a duration slab */
  amount: Decimal;
  /** Hours after the full months (the part slabs / coupons may still apply to) */
  remainderHours: number;
}

/**
 * User decision (Oct 23 2026): on a monthly booking — the customer
 * "Monthly · 30 days" booking and the counter monthly plan — the BM's
 * duration slabs never reduce the configured monthly price. The full months
 * of the window (the same split base-price-rule.ts bills: whole 30 × 24 h
 * blocks when the rate card has a monthly price) cost exactly priceMonthly ×
 * months; discounts apply only to the remainder, matched on its own length.
 * null = nothing billed at the monthly price (no monthly rate, or under 30 days).
 */
export function monthlyPortion(
  priceMonthly: DecimalLike,
  duration: { actualDuration: number; periodType: string },
): MonthlyPortion | null {
  if (priceMonthly == null || priceMonthly === "") return null;
  const price = new Decimal(priceMonthly.toString());
  if (!price.isFinite() || !price.gt(0) || duration.periodType !== "MONTHLY") return null;
  // Whole minutes, as base-price-rule.ts counts them
  const totalMinutes = Math.max(1, Math.ceil(duration.actualDuration * 60 - 1e-6));
  const fullMonths = Math.floor(totalMinutes / MONTH_MINUTES);
  if (fullMonths < 1) return null;
  return {
    fullMonths,
    amount: price.mul(fullMonths),
    remainderHours: Math.max(0, (totalMinutes - fullMonths * MONTH_MINUTES) / 60),
  };
}
