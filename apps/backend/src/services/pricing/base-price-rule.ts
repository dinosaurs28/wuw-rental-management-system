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
 *
 * Weekend rates (utils/pricing/weekendRule.ts): given where the window sits on
 * the calendar, each block above (a full day, the remainder, the single block
 * of up to 24 h — never a full month) is a weekend block when at least half of
 * its minutes fall on the branch's weekend days, and is then priced with the
 * weekend 12 h / 24 h slab (each falling back to the weekday slab): the hourly
 * rate is the same, capped at that block's slab.
 *
 * Festival pricing (utils/pricing/specialDateRule.ts): each of those blocks
 * with at least half of its minutes on a festival rule's dates then has its
 * rent (after the slab choice and the hourly cap) changed by the rule's
 * percentage — the rule giving the highest rent when several apply. Free km
 * never change; full months are never festival blocks.
 */
import Decimal from "decimal.js";
import { RentalPeriodType, type RentalDuration } from "./duration-calculator.service.js";
import { formatRupees, isWeekendBlock } from "../../utils/pricing/weekendRule.js";
import { festivalPriceFor, ruleLabel, type SpecialRule } from "../../utils/pricing/specialDateRule.js";

export interface RateCard {
  /** null (or 0 upstream) = not offered */
  hourlyRate: Decimal | null;
  price12Hour: Decimal | null;
  price24Hour: Decimal;
  priceMonthly: Decimal | null;
  freeKm12Hour: number;
  freeKm24Hour: number;
  freeKmMonthly: number;
  /** Weekend 12 h / 24 h slab (GST-inclusive); null / absent = the weekday slab */
  weekendPrice12Hour?: Decimal | null;
  weekendPrice24Hour?: Decimal | null;
}

/** Where the billed window sits on the calendar and which days are the weekend — for the weekend rule. */
export interface WeekendContext {
  /** Billing start (the pickup) */
  startAt: Date;
  /**
   * The real return. Blocks are classified on the hours before it: a 12-hour
   * package held to closing (Fri 18:00 → 22:30) is billed to pickup + 12 h but
   * is a weekday block — the car is only out on Friday. Absent = the billed end.
   */
  endAt?: Date;
  /** ISO weekdays, 1 = Mon … 7 = Sun; empty = no weekend pricing */
  weekendDays: readonly number[];
  /**
   * Festival rules covering this vehicle (specialDateRule.ts; already filtered
   * by scope). Absent / empty = no festival pricing.
   */
  specialRules?: readonly SpecialRule[];
}

/**
 * The weekend rates inside a price — persisted per item in the booking's
 * pricingSnapshot so receipts show what was charged.
 */
export interface WeekendBreakdown {
  /** Blocks billed at a weekend rate / at the weekday rate (full months are not blocks) */
  weekendBlocks: number;
  weekdayBlocks: number;
  /** The rate card's weekend slabs (GST-inclusive); null = same as weekday */
  weekendPrice12Hour: number | null;
  weekendPrice24Hour: number | null;
  /** What the weekend-billed blocks cost, and the same blocks at weekday rates */
  weekendAmount: number;
  weekdayAmount: number;
  /** e.g. "Includes 1 weekend day at ₹1,600" */
  label: string;
}

/**
 * The festival rules inside a price — persisted per item in the booking's
 * pricingSnapshot so labels and receipts show what was charged.
 */
export interface FestivalBreakdown {
  /** Blocks billed under a festival rule */
  festivalBlocks: number;
  /** What the festival rules changed the rent by (GST-inclusive; negative = a festival discount) */
  amount: number;
  /** Each rule applied, in the order first met: its blocks and what it changed the rent by */
  rules: { id: number; name: string; percent: number; blocks: number; amount: number }[];
  /** e.g. "Includes 3 festival days (Dussehra +10%)" */
  label: string;
}

/** How the price was actually worked out (may differ from the duration's periodType). */
export type BilledAsType = "HOURLY" | "HALF_DAY" | "FULL_DAY" | "MULTI_DAY" | "MONTHLY";

export interface BasePriceSelection {
  basePrice: Decimal;
  freeKmLimit: number;
  billedAsType: BilledAsType;
  /** Human label of what was billed, e.g. "5 hours", "12 hours", "1 day", "2 days + 12 hours". */
  billedAs: string;
  /** Absent when no block was billed at a weekend rate. */
  weekend?: WeekendBreakdown;
  /** Absent when no block was billed under a festival rule. */
  festival?: FestivalBreakdown;
}

const DAY_MINUTES = 24 * 60;
const MONTH_MINUTES = 30 * DAY_MINUTES;
const MINUTE_MS = 60_000;

interface Block {
  price: Decimal;
  km: number;
  kind: "HOURS" | "HALF_DAY" | "FULL_DAY";
  hours: number;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Price one block of up to 24 h (`minutes` > 0), at the weekend slabs when `weekend`. */
function priceBlock(card: RateCard, minutes: number, weekend = false): Block {
  const weekendSlab = (slab: Decimal | null | undefined) => (weekend && slab && slab.gt(0) ? slab : null);
  const price12Hour = weekendSlab(card.weekendPrice12Hour) ?? card.price12Hour;
  const price24Hour = weekendSlab(card.weekendPrice24Hour) ?? card.price24Hour;
  const slab: Block =
    minutes <= 12 * 60 && price12Hour
      ? { price: price12Hour, km: card.freeKm12Hour, kind: "HALF_DAY", hours: 12 }
      : { price: price24Hour, km: card.freeKm24Hour, kind: "FULL_DAY", hours: 24 };
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

/**
 * Prices the blocks of one window where they sit on the calendar: a weekend
 * block (weekendRule.ts) at the weekend slabs, then a festival block
 * (specialDateRule.ts) changed by its rule's percentage, and tallies what the
 * weekend rates and festival rules did for the breakdowns. Without a context,
 * weekend rates or festival rules every block is priced exactly as before.
 */
class BlockPricer {
  private readonly blocks: {
    /** What the block is billed at */
    block: Block;
    /** The block at its weekday / weekend slab, before any festival rule */
    slab: Block;
    weekday: Block;
    weekendBilled: boolean;
    festival: SpecialRule | null;
  }[] = [];
  private readonly weekendOn: boolean;
  private readonly festivalOn: boolean;

  constructor(private readonly card: RateCard, private readonly ctx: WeekendContext | undefined) {
    this.weekendOn =
      !!ctx && ctx.weekendDays.length > 0 && !!(card.weekendPrice12Hour?.gt(0) || card.weekendPrice24Hour?.gt(0));
    this.festivalOn = !!ctx?.specialRules?.length;
  }

  /** The block of `minutes` starting `offset` minutes after pickup, billed as `billMinutes`. */
  at(offset: number, minutes: number, billMinutes = minutes): Block {
    const weekday = priceBlock(this.card, billMinutes);
    let slab = weekday;
    // Classified on the hours the car is really out (never past the real return)
    const startMs = (this.ctx?.startAt.getTime() ?? 0) + offset * MINUTE_MS;
    const realEndMs = Math.min(startMs + minutes * MINUTE_MS, this.ctx?.endAt?.getTime() ?? Infinity);
    const endMs = realEndMs > startMs ? realEndMs : startMs + minutes * MINUTE_MS;
    if (this.weekendOn && isWeekendBlock(startMs, endMs, this.ctx!.weekendDays)) {
      slab = priceBlock(this.card, billMinutes, true);
      // Never fewer free km than the same block earns on a weekday (a weekend
      // block billed by the hour would otherwise lose the slab's km)
      if (slab.km < weekday.km) slab = { ...slab, km: weekday.km };
    }
    const weekendBilled = slab !== weekday && (!slab.price.eq(weekday.price) || slab.kind !== weekday.kind);
    // Festival: the slab's rent (hourly cap included) × the best applicable rule; km unchanged
    let block = slab;
    let festival: SpecialRule | null = null;
    if (this.festivalOn) {
      const hit = festivalPriceFor(startMs, endMs, slab.price, this.ctx!.specialRules!);
      if (hit) {
        block = { ...slab, price: hit.price };
        festival = hit.rule;
      }
    }
    this.blocks.push({ block, slab, weekday, weekendBilled, festival });
    return block;
  }

  breakdown(): WeekendBreakdown | undefined {
    const weekend = this.blocks.filter((b) => b.weekendBilled);
    if (weekend.length === 0) return undefined;

    // "1 weekend day at ₹1,600 + 12 weekend hours at ₹1,100", one part per kind of block
    // (at the weekend slab — a festival rule on top is the festival breakdown's)
    const groups = new Map<string, { block: Block; count: number }>();
    for (const { slab: block } of weekend) {
      const key = `${block.kind}:${block.hours}:${block.price.toString()}`;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { block, count: 1 });
    }
    const parts = [...groups.values()].map(({ block, count }) => {
      const price = formatRupees(block.price.toNumber());
      if (block.kind === "FULL_DAY") return `${plural(count, "weekend day")} at ${price}`;
      const what = block.kind === "HALF_DAY" ? "12 weekend hours" : plural(block.hours, "weekend hour");
      return count > 1 ? `${count} × ${what} at ${price} each` : `${what} at ${price}`;
    });

    const sum = (list: Block[]) =>
      list.reduce((s, b) => s.add(b.price), new Decimal(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    const slab = (d: Decimal | null | undefined) => (d && d.gt(0) ? d.toNumber() : null);
    return {
      weekendBlocks: weekend.length,
      weekdayBlocks: this.blocks.length - weekend.length,
      weekendPrice12Hour: slab(this.card.weekendPrice12Hour),
      weekendPrice24Hour: slab(this.card.weekendPrice24Hour),
      weekendAmount: sum(weekend.map((b) => b.slab)),
      weekdayAmount: sum(weekend.map((b) => b.weekday)),
      label: `Includes ${parts.join(" + ")}`,
    };
  }

  festivalBreakdown(): FestivalBreakdown | undefined {
    const hits = this.blocks.filter((b) => b.festival);
    if (hits.length === 0) return undefined;

    const byRule = new Map<number, { rule: SpecialRule; blocks: Block[]; amount: Decimal }>();
    for (const { block, slab, festival } of hits) {
      const entry = byRule.get(festival!.id) ?? { rule: festival!, blocks: [], amount: new Decimal(0) };
      entry.blocks.push(block);
      entry.amount = entry.amount.add(block.price.sub(slab.price));
      byRule.set(festival!.id, entry);
    }
    const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    // "3 festival days (Dussehra +10%)", "1 festival day + 6 festival hours (Diwali −5%)"
    const parts = [...byRule.values()].map(({ rule, blocks }) => {
      // A block billed as a day (the 24 h slab, or 24 hours by the hour) is a day, else its hours
      const days = blocks.filter((b) => b.hours >= 24).length;
      const hours = blocks.reduce((sum, b) => (b.hours >= 24 ? sum : sum + b.hours), 0);
      const length = [
        ...(days > 0 ? [plural(days, "festival day")] : []),
        ...(hours > 0 ? [plural(hours, "festival hour")] : []),
      ].join(" + ");
      return `${length} (${ruleLabel(rule)})`;
    });
    const total = [...byRule.values()].reduce((sum, r) => sum.add(r.amount), new Decimal(0));
    return {
      festivalBlocks: hits.length,
      amount: money(total),
      rules: [...byRule.values()].map(({ rule, blocks, amount }) => ({
        id: rule.id,
        name: rule.name,
        percent: rule.percent,
        blocks: blocks.length,
        amount: money(amount),
      })),
      label: `Includes ${parts.join(" + ")}`,
    };
  }
}

/** Full days + remainder block, e.g. "2 days + 12 hours" or "3 days". */
function daysLabel(fullDays: number, rest: Block | null): string {
  if (!rest) return plural(fullDays, "day");
  if (rest.kind === "FULL_DAY") return plural(fullDays + 1, "day");
  const restLabel = blockLabel(rest);
  return fullDays > 0 ? `${plural(fullDays, "day")} + ${restLabel}` : restLabel;
}

/**
 * `weekend` places the window on the calendar for the weekend rule and the
 * festival rules; without it (or with no weekend days / no weekend rates / no
 * festival rules) every block is a plain weekday block.
 */
export function selectBasePrice(
  card: RateCard,
  duration: RentalDuration,
  weekend?: WeekendContext,
): BasePriceSelection {
  // Whole minutes (times are minute-granular; the epsilon absorbs float noise)
  const totalMinutes = Math.max(1, Math.ceil(duration.actualDuration * 60 - 1e-6));
  const pricer = new BlockPricer(card, weekend);

  // ── Up to 24 h: one block ────────────────────────────────────────────────
  if (
    duration.periodType === RentalPeriodType.HOURLY ||
    duration.periodType === RentalPeriodType.HALF_DAY ||
    duration.periodType === RentalPeriodType.FULL_DAY
  ) {
    const block = pricer.at(0, Math.min(totalMinutes, DAY_MINUTES));
    return {
      basePrice: block.price,
      freeKmLimit: block.km,
      billedAsType: block.kind === "HOURS" ? "HOURLY" : block.kind,
      billedAs: blockLabel(block),
      ...withBreakdown(pricer),
    };
  }

  /** `count` full 24 h blocks from `offset` minutes after pickup (the last one may be cut at `end`). */
  const priceDays = (offset: number, count: number, end = Infinity) => {
    let price = new Decimal(0);
    let km = 0;
    for (let i = 0; i < count; i++) {
      const from = offset + i * DAY_MINUTES;
      const day = pricer.at(from, Math.min(DAY_MINUTES, end - from), DAY_MINUTES);
      price = price.add(day.price);
      km += day.km;
    }
    return { price, km };
  };

  // ── Monthly (30+ billable days) ──────────────────────────────────────────
  if (duration.periodType === RentalPeriodType.MONTHLY) {
    if (!card.priceMonthly) {
      // No monthly rate — bill per started day
      const days = Math.ceil(totalMinutes / DAY_MINUTES);
      const all = priceDays(0, days, totalMinutes);
      return {
        basePrice: all.price,
        freeKmLimit: all.km,
        billedAsType: "MULTI_DAY",
        billedAs: plural(days, "day"),
        ...withBreakdown(pricer),
      };
    }
    const fullMonths = Math.floor(totalMinutes / MONTH_MINUTES);
    const afterMonths = totalMinutes - fullMonths * MONTH_MINUTES;
    const overflowDays = Math.floor(afterMonths / DAY_MINUTES);
    const leftover = afterMonths - overflowDays * DAY_MINUTES;
    const overflow = priceDays(fullMonths * MONTH_MINUTES, overflowDays);
    const rest =
      leftover > 0 ? pricer.at(fullMonths * MONTH_MINUTES + overflowDays * DAY_MINUTES, leftover) : null;

    let basePrice = card.priceMonthly.mul(fullMonths).add(overflow.price);
    let freeKmLimit = card.freeKmMonthly * fullMonths + overflow.km;
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
      ...withBreakdown(pricer),
    };
  }

  // ── Multi-day: full days + remainder block ───────────────────────────────
  const fullDays = Math.floor(totalMinutes / DAY_MINUTES);
  const remainder = totalMinutes - fullDays * DAY_MINUTES;
  const days = priceDays(0, fullDays);
  const rest = remainder > 0 ? pricer.at(fullDays * DAY_MINUTES, remainder) : null;

  let basePrice = days.price;
  let freeKmLimit = days.km;
  if (rest) {
    basePrice = basePrice.add(rest.price);
    freeKmLimit += rest.km;
  }
  return {
    basePrice,
    freeKmLimit,
    billedAsType: "MULTI_DAY",
    billedAs: daysLabel(fullDays, rest),
    ...withBreakdown(pricer),
  };
}

function withBreakdown(pricer: BlockPricer): Pick<BasePriceSelection, "weekend" | "festival"> {
  const weekend = pricer.breakdown();
  const festival = pricer.festivalBreakdown();
  return { ...(weekend && { weekend }), ...(festival && { festival }) };
}
