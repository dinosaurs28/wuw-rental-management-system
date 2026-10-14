import { z } from "zod";

// ─── Festival (special-date) pricing ──────────────────────────────────────────
//
// A branch's festival pricing rule, e.g. "Dussehra", 20–22 Oct, +10% and/or
// +₹200 a day on every vehicle. Dates are IST calendar days (YYYY-MM-DD), both
// inclusive. A priced block (a day of the trip, the remainder, a trip of up to
// 24 h) with at least half of its time on those days is billed at
// rent × (1 + percent / 100) + flatAmount × (billed hours / 24).
//
// A GROUPS rule (the festival dialog since Oct 16) instead sets one change per
// vehicle group — the branch's vehicles of one make + model + category: a
// percentage or a flat ₹ a day, either up or off (items; value signed).

export const SPECIAL_PRICING_NAME_MAX = 60;
export const SPECIAL_PRICING_PERCENT_MIN = -90;
export const SPECIAL_PRICING_PERCENT_MAX = 300;
/** The flat ₹ a day a rule adds (negative: takes off), either way at most this. */
export const SPECIAL_PRICING_FLAT_MAX = 100000;
/** Longest festival, in days (start and end day included). */
export const SPECIAL_PRICING_MAX_DAYS = 60;
export const SPECIAL_PRICING_SCOPES = ["ALL", "CATEGORIES", "VEHICLES", "GROUPS"] as const;
export type SpecialPricingScopeValue = (typeof SPECIAL_PRICING_SCOPES)[number];
/** A vehicle group's change under a GROUPS rule: rent × (1 + value / 100), or value ₹ a day. */
export const SPECIAL_PRICING_CHANGES = ["PERCENT", "FLAT"] as const;
export type SpecialPricingChangeValue = (typeof SPECIAL_PRICING_CHANGES)[number];
/** Most vehicle groups one rule can price. */
export const SPECIAL_PRICING_MAX_GROUPS = 500;

/** A vehicle group's key: MAKE__MODEL__categoryId (make / model trimmed, spaces collapsed, upper case). */
export function vehicleGroupKey(make: string, model: string, categoryId: number): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  return `${norm(make)}__${norm(model)}__${categoryId}`;
}
/** List filters, by the rule's dates against today (IST); a paused rule is listed by its dates. */
export const SPECIAL_PRICING_LIST_FILTERS = ["upcoming", "active", "past", "all"] as const;
export type SpecialPricingListFilter = (typeof SPECIAL_PRICING_LIST_FILTERS)[number];
export type SpecialPricingStatus = "UPCOMING" | "ACTIVE" | "PAST" | "PAUSED";

/** A real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to` (YYYY-MM-DD; negative when `to` is earlier). */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today's IST calendar date (YYYY-MM-DD). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** "+10%", "−12.5%" — how a festival's percentage is written in labels. */
export function formatSpecialPercent(percent: number): string {
  const digits = Math.abs(percent).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${percent < 0 ? "−" : "+"}${digits}%`;
}

/**
 * A rule's change as labels write it: "+10%", "+₹200/day", "−₹100/day",
 * "+10% + ₹200/day", "−5% − ₹50/day".
 */
export function formatSpecialChange(percent: number, flatAmount = 0): string {
  const perDay = `₹${Math.abs(flatAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/day`;
  const sign = flatAmount < 0 ? "−" : "+";
  if (percent !== 0 && flatAmount !== 0) return `${formatSpecialPercent(percent)} ${sign} ${perDay}`;
  if (flatAmount !== 0) return `${sign}${perDay}`;
  return formatSpecialPercent(percent);
}

/** A vehicle group's change as labels write it: "+10%", "10% off", "+₹200/day", "₹200/day off". */
export function formatGroupChange(type: SpecialPricingChangeValue, value: number): string {
  const digits = Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const amount = type === "PERCENT" ? `${digits}%` : `₹${digits}/day`;
  return value < 0 ? `${amount} off` : `+${amount}`;
}

/** Paused, else where today (IST) sits against the rule's dates. */
export function specialPricingStatus(
  rule: { startDate: string; endDate: string; active: boolean },
  today: string = istToday(),
): SpecialPricingStatus {
  if (!rule.active) return "PAUSED";
  if (rule.endDate < today) return "PAST";
  return rule.startDate > today ? "UPCOMING" : "ACTIVE";
}

const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) <= 1e-6;

/** Why a percentage isn't allowed, or null: −90 … +300 (0 = none), at most 2 decimals. */
export function specialPricingPercentIssue(percent: number): string | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "Enter a percentage";
  if (percent < SPECIAL_PRICING_PERCENT_MIN || percent > SPECIAL_PRICING_PERCENT_MAX) {
    return `Use a percentage from ${SPECIAL_PRICING_PERCENT_MIN}% to +${SPECIAL_PRICING_PERCENT_MAX}%`;
  }
  if (!twoDecimals(percent)) return "Use at most 2 decimal places";
  return null;
}

/** Why a flat ₹/day amount isn't allowed, or null: −1,00,000 … +1,00,000 (0 = none), paise at most. */
export function specialPricingFlatIssue(flatAmount: number): string | null {
  if (typeof flatAmount !== "number" || !Number.isFinite(flatAmount)) return "Enter an amount";
  if (Math.abs(flatAmount) > SPECIAL_PRICING_FLAT_MAX) {
    return `Use an amount up to ₹${SPECIAL_PRICING_FLAT_MAX.toLocaleString("en-IN")} a day`;
  }
  if (!twoDecimals(flatAmount)) return "Use at most 2 decimal places";
  return null;
}

/**
 * Why a vehicle group's change isn't allowed, or null: not 0, at most 2
 * decimals; a percentage up to +300% (off: up to 90%), a flat amount up to
 * ₹1,00,000 a day either way.
 */
export function specialPricingItemIssue(type: SpecialPricingChangeValue, value: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter an amount";
  if (value === 0) return "Enter an amount above 0, or leave it empty";
  if (!twoDecimals(value)) return "Use at most 2 decimal places";
  if (type === "PERCENT" && value > SPECIAL_PRICING_PERCENT_MAX) return `Use at most ${SPECIAL_PRICING_PERCENT_MAX}%`;
  if (type === "PERCENT" && value < SPECIAL_PRICING_PERCENT_MIN) return `Take off at most ${-SPECIAL_PRICING_PERCENT_MIN}%`;
  if (type === "FLAT" && Math.abs(value) > SPECIAL_PRICING_FLAT_MAX) {
    return `Use at most ₹${SPECIAL_PRICING_FLAT_MAX.toLocaleString("en-IN")} a day`;
  }
  return null;
}

type RuleShape = {
  startDate?: string | null;
  endDate?: string | null;
  percent?: number | null;
  flatAmount?: number | null;
  scope?: SpecialPricingScopeValue | null;
  categoryIds?: number[] | null;
  vehicleIds?: number[] | null;
  items?: { groupKey: string; type: SpecialPricingChangeValue; value: number }[] | null;
};

/**
 * Cross-field rules shared by create, update (checked on the merged rule) and
 * preview: end on or after start, at most SPECIAL_PRICING_MAX_DAYS days, a valid
 * percentage and flat ₹/day amount — at least one of them not 0 — and
 * categories / vehicles picked for those scopes; for GROUPS, at least one
 * vehicle group priced (each once, with a valid amount).
 */
export function specialPricingRuleIssues(rule: RuleShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (rule.startDate && rule.endDate && isCalendarDate(rule.startDate) && isCalendarDate(rule.endDate)) {
    const span = calendarDaysBetween(rule.startDate, rule.endDate);
    if (span < 0) issues.push({ path: "endDate", message: "The end date can't be before the start date" });
    else if (span + 1 > SPECIAL_PRICING_MAX_DAYS) {
      issues.push({ path: "endDate", message: `A festival can last at most ${SPECIAL_PRICING_MAX_DAYS} days` });
    }
  }
  if (rule.scope === "GROUPS") {
    const items = rule.items ?? [];
    if (items.length === 0) issues.push({ path: "items", message: "Enter an amount for at least one vehicle group" });
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const issue = seen.has(item.groupKey) ? "Each vehicle group can be priced once" : specialPricingItemIssue(item.type, item.value);
      seen.add(item.groupKey);
      if (issue) issues.push({ path: `items.${index}.value`, message: issue });
    });
    return issues;
  }
  const percentIssue = rule.percent != null ? specialPricingPercentIssue(rule.percent) : null;
  const flatIssue = rule.flatAmount != null ? specialPricingFlatIssue(rule.flatAmount) : null;
  if (percentIssue) issues.push({ path: "percent", message: percentIssue });
  if (flatIssue) issues.push({ path: "flatAmount", message: flatIssue });
  if (!percentIssue && !flatIssue && (rule.percent != null || rule.flatAmount != null)) {
    if ((rule.percent ?? 0) === 0 && (rule.flatAmount ?? 0) === 0) {
      issues.push({ path: "percent", message: "Enter a percentage or a ₹ a day amount (or both)" });
    }
  }
  if (rule.scope === "CATEGORIES" && !(rule.categoryIds?.length)) {
    issues.push({ path: "categoryIds", message: "Pick at least one category" });
  }
  if (rule.scope === "VEHICLES" && !(rule.vehicleIds?.length)) {
    issues.push({ path: "vehicleIds", message: "Pick at least one vehicle" });
  }
  return issues;
}

const calendarDate = z.string().trim().refine(isCalendarDate, "Use a valid date (YYYY-MM-DD)");
const ids = (max: number) => z.array(z.number().int().positive()).max(max);
const groupItem = z.object({
  groupKey: z.string().trim().min(1, "Pick a vehicle group").max(300),
  type: z.enum(SPECIAL_PRICING_CHANGES),
  // Signed: negative = off ("Percentage off", "Flat amount off")
  value: z.number({ invalid_type_error: "Enter an amount" }),
});

// Base object (no refinements) — allows .partial() / .extend() below
const specialPricingRuleBase = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the festival a name")
    .max(SPECIAL_PRICING_NAME_MAX, `Use at most ${SPECIAL_PRICING_NAME_MAX} characters`),
  startDate: calendarDate,
  endDate: calendarDate,
  // Either or both: rent × (1 + percent / 100) + flatAmount ₹ a day (0 = none)
  percent: z.number({ invalid_type_error: "Enter a percentage" }).default(0),
  flatAmount: z.number({ invalid_type_error: "Enter an amount" }).default(0),
  scope: z.enum(SPECIAL_PRICING_SCOPES).default("ALL"),
  // Only the list matching the scope is kept (the other is stored empty)
  categoryIds: ids(200).default([]),
  vehicleIds: ids(1000).default([]),
  // GROUPS scope: the groups priced (a group left out keeps its rent)
  items: z.array(groupItem).max(SPECIAL_PRICING_MAX_GROUPS).default([]),
  active: z.boolean().default(true),
});

const refineRule = (rule: RuleShape, ctx: z.RefinementCtx) => {
  for (const issue of specialPricingRuleIssues(rule)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  }
};

/** POST …/pricing/special-rules (branch manager: own branch). */
export const createSpecialPricingRuleSchema = specialPricingRuleBase.superRefine(refineRule);

/** POST /admin/pricing/special-rules — the same for any branch. */
export const adminCreateSpecialPricingRuleSchema = specialPricingRuleBase
  .extend({ branchId: z.number().int().positive() })
  .superRefine(refineRule);

/**
 * PATCH …/special-rules/:publicId — any subset (e.g. { active: false } to
 * pause); the merged rule is checked with specialPricingRuleIssues.
 */
export const updateSpecialPricingRuleSchema = specialPricingRuleBase.partial();

/** POST …/special-rules/preview — a draft rule's 24-hour rents before → after. */
export const specialPricingPreviewSchema = specialPricingRuleBase
  .pick({
    startDate: true,
    endDate: true,
    percent: true,
    flatAmount: true,
    scope: true,
    categoryIds: true,
    vehicleIds: true,
    items: true,
  })
  .extend({ branchId: z.number().int().positive().optional() })
  .superRefine(refineRule);

export type CreateSpecialPricingRuleInput = z.infer<typeof createSpecialPricingRuleSchema>;
export type UpdateSpecialPricingRuleInput = z.infer<typeof updateSpecialPricingRuleSchema>;
export type SpecialPricingPreviewInput = z.infer<typeof specialPricingPreviewSchema>;
