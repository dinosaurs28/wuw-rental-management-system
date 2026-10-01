/**
 * Base-price slab selection — the one rule shared by
 * PricingEngineService.determineBasePrice (bookings, details, extensions, km
 * allowance) and the listing batch pricer, so a listed price always equals the
 * booked price.
 *
 * Vehicles without an hourly rate keep the plain slab rules:
 *   ≤ 12 h  → price12Hour, else price24Hour
 *   ≤ 24 h  → price24Hour
 *   > 24 h  → full days × price24Hour + the remainder as a 12 h / 24 h slab
 *   monthly → priceMonthly × months + overflow days + remainder slab
 *
 * Vehicles WITH an hourly rate (#5): hourly billing is capped at the slab, per
 * block of up to 24 h:
 *   ≤ 12 h  → min(hourly × ceil(h), price12Hour ?? price24Hour)
 *   12–24 h → min(hourly × ceil(h), price24Hour)
 *   > 24 h  → each full day min(hourly × 24, price24Hour), remainder as above
 *   monthly → the monthly slab, overflow/remainder capped as above
 * Free km follow whichever option wins. Hours billed hourly earn
 * floor(hours × freeKm24Hour / 24) — a full day earns exactly the configured
 * 24-hour free km (#21; it used to be a hard-coded 8 km/hour).
 */
import Decimal from "decimal.js";
import { RentalPeriodType, type RentalDuration } from "./duration-calculator.service.js";

export interface RateCard {
  /** null (or 0 upstream) = not offered */
  hourlyRate: Decimal | null;
  price12Hour: Decimal | null;
  price24Hour: Decimal;
  priceMonthly: Decimal | null;
  freeKm12Hour: number;
  freeKm24Hour: number;
  freeKmMonthly: number;
}

/** How the price was actually worked out (may differ from the duration's periodType). */
export type BilledAsType = "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";

export interface BasePriceSelection {
  basePrice: Decimal;
  freeKmLimit: number;
  billedAsType: BilledAsType;
  /** Human label of what was billed, e.g. "5 hours", "12 hours", "1 day", "2 days + 12 hours". */
  billedAs: string;
}

const DAY_MINUTES = 24 * 60;
const MONTH_MINUTES = 30 * DAY_MINUTES;

interface Block {
  price: Decimal;
  km: number;
  kind: "HOURS" | "HALF_DAY" | "FULL_DAY";
  hours: number;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Price one block of up to 24 h (`minutes` > 0). */
function priceBlock(card: RateCard, minutes: number): Block {
  const slab: Block =
    minutes <= 12 * 60 && card.price12Hour
      ? { price: card.price12Hour, km: card.freeKm12Hour, kind: "HALF_DAY", hours: 12 }
      : { price: card.price24Hour, km: card.freeKm24Hour, kind: "FULL_DAY", hours: 24 };
  if (!card.hourlyRate || !card.hourlyRate.gt(0)) return slab;

  const hours = Math.max(1, Math.ceil(minutes / 60));
  const hourly = card.hourlyRate.mul(hours);
  // A tie goes to the slab (same price, the slab's free km)
  if (hourly.lt(slab.price)) {
    return { price: hourly, km: Math.floor((hours * card.freeKm24Hour) / 24), kind: "HOURS", hours };
  }
  return slab;
}

function blockLabel(block: Block): string {
  if (block.kind === "HOURS") return plural(block.hours, "hour");
  return block.kind === "HALF_DAY" ? "12 hours" : "1 day";
}

/** Full days + remainder block, e.g. "2 days + 12 hours" or "3 days". */
function daysLabel(fullDays: number, rest: Block | null): string {
  if (!rest) return plural(fullDays, "day");
  if (rest.kind === "FULL_DAY") return plural(fullDays + 1, "day");
  const restLabel = blockLabel(rest);
  return fullDays > 0 ? `${plural(fullDays, "day")} + ${restLabel}` : restLabel;
}

export function selectBasePrice(card: RateCard, duration: RentalDuration): BasePriceSelection {
  // Whole minutes (times are minute-granular; the epsilon absorbs float noise)
  const totalMinutes = Math.max(1, Math.ceil(duration.actualDuration * 60 - 1e-6));

  // ── Up to 24 h: one block ────────────────────────────────────────────────
  if (
    duration.periodType === RentalPeriodType.HOURLY ||
    duration.periodType === RentalPeriodType.HALF_DAY ||
    duration.periodType === RentalPeriodType.FULL_DAY
  ) {
    const block = priceBlock(card, Math.min(totalMinutes, DAY_MINUTES));
    return {
      basePrice: block.price,
      freeKmLimit: block.km,
      billedAsType: block.kind === "HOURS" ? "HOURLY" : block.kind,
      billedAs: blockLabel(block),
    };
  }

  const dayBlock = priceBlock(card, DAY_MINUTES);

  // ── Monthly (30+ billable days) ──────────────────────────────────────────
  if (duration.periodType === RentalPeriodType.MONTHLY) {
    if (!card.priceMonthly) {
      // No monthly rate — bill per started day
      const days = Math.ceil(totalMinutes / DAY_MINUTES);
      return {
        basePrice: dayBlock.price.mul(days),
        freeKmLimit: dayBlock.km * days,
        billedAsType: "MULTI_DAY",
        billedAs: plural(days, "day"),
      };
    }
    const fullMonths = Math.floor(totalMinutes / MONTH_MINUTES);
    const afterMonths = totalMinutes - fullMonths * MONTH_MINUTES;
    const overflowDays = Math.floor(afterMonths / DAY_MINUTES);
    const leftover = afterMonths - overflowDays * DAY_MINUTES;
    const rest = leftover > 0 ? priceBlock(card, leftover) : null;

    let basePrice = card.priceMonthly.mul(fullMonths).add(dayBlock.price.mul(overflowDays));
    let freeKmLimit = card.freeKmMonthly * fullMonths + dayBlock.km * overflowDays;
    if (rest) {
      basePrice = basePrice.add(rest.price);
      freeKmLimit += rest.km;
    }

    const parts: string[] = [];
    if (fullMonths > 0) parts.push(plural(fullMonths, "month"));
    if (overflowDays > 0 || rest) parts.push(daysLabel(overflowDays, rest));
    return {
      basePrice,
      freeKmLimit,
      billedAsType: fullMonths > 0 ? "MONTHLY" : "MULTI_DAY",
      billedAs: parts.join(" + ") || plural(0, "day"),
    };
  }

  // ── Multi-day: full days + remainder block ───────────────────────────────
  const fullDays = Math.floor(totalMinutes / DAY_MINUTES);
  const remainder = totalMinutes - fullDays * DAY_MINUTES;
  const rest = remainder > 0 ? priceBlock(card, remainder) : null;

  let basePrice = dayBlock.price.mul(fullDays);
  let freeKmLimit = dayBlock.km * fullDays;
  if (rest) {
    basePrice = basePrice.add(rest.price);
    freeKmLimit += rest.km;
  }
  return {
    basePrice,
    freeKmLimit,
    billedAsType: "MULTI_DAY",
    billedAs: daysLabel(fullDays, rest),
  };
}
