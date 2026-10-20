/**
 * Customers never see festival pricing details (client, Oct 2026: "don't show
 * customers the price hike") — only the final price, which already holds any
 * festival change. Public and customer API responses therefore drop:
 *   - `festival` — a FestivalBreakdown (base-price-rule.ts: festivalBlocks,
 *     amount, rules with names / percent / flat ₹ a day, the label), wherever
 *     it sits (listing pricingDetails, details / summary pricingBreakdown, …)
 *   - `specialRules` — the festival rules a window was priced with (a booking's
 *     pricingSnapshot.specialRules, the engine's pricingBreakdown.specialRules)
 *   - `specialShare` — an extension charge's festival / weekend parts (staff
 *     extension responses; never built for customers, stripped here as well)
 * Totals and every other field stay as they are. Staff endpoints (Fleet walk-in,
 * pickup / drop, BM / admin) keep the data — this runs only on the customer
 * mounts (middlewares/hideFestivalPricing.middleware.ts).
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** A FestivalBreakdown as the pricer builds it (older shapes included). */
const isFestivalBreakdown = (value: unknown): boolean =>
  isPlainObject(value) && ("festivalBlocks" in value || "rules" in value || "label" in value);

/**
 * `body` without festival breakdowns and stored festival rules, at any depth.
 * Arrays and plain objects are copied; anything else (Date, Decimal, …) is
 * kept as it is, so JSON serialisation is unchanged.
 */
export function withoutFestivalPricing<T>(body: T): T {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isPlainObject(value)) return value;
    // A weekend label next to a festival price quotes the pre-festival weekend
    // rent ("1 weekend day at ₹1,600" beside ₹1,760), which gives the hike away
    const hasFestival = isFestivalBreakdown(value.festival);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "specialRules" || key === "specialShare") continue;
      if (key === "festival" && isFestivalBreakdown(entry)) continue;
      if (key === "weekend" && hasFestival) continue;
      out[key] = strip(entry);
    }
    return out;
  };
  return strip(body) as T;
}
