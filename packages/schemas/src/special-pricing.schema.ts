import { z } from "zod";

// ─── Festival (special-date) pricing ──────────────────────────────────────────
//
// A branch's festival pricing rule, e.g. "Dussehra", 20–22 Oct, +10% on every
// vehicle. Dates are IST calendar days (YYYY-MM-DD), both inclusive. A priced
// block (a day of the trip, the remainder, a trip of up to 24 h) with at least
// half of its time on those days is billed at its rent × (1 + percent / 100).

export const SPECIAL_PRICING_NAME_MAX = 60;
export const SPECIAL_PRICING_PERCENT_MIN = -90;
export const SPECIAL_PRICING_PERCENT_MAX = 300;
/** Longest festival, in days (start and end day included). */
export const SPECIAL_PRICING_MAX_DAYS = 60;
export const SPECIAL_PRICING_SCOPES = ["ALL", "CATEGORIES", "VEHICLES"] as const;
export type SpecialPricingScopeValue = (typeof SPECIAL_PRICING_SCOPES)[number];
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

/** Paused, else where today (IST) sits against the rule's dates. */
export function specialPricingStatus(
  rule: { startDate: string; endDate: string; active: boolean },
  today: string = istToday(),
): SpecialPricingStatus {
  if (!rule.active) return "PAUSED";
  if (rule.endDate < today) return "PAST";
  return rule.startDate > today ? "UPCOMING" : "ACTIVE";
}

/** Why a percentage isn't allowed, or null: −90 … +300, not 0, at most 2 decimals. */
export function specialPricingPercentIssue(percent: number): string | null {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "Enter a percentage";
  if (percent < SPECIAL_PRICING_PERCENT_MIN || percent > SPECIAL_PRICING_PERCENT_MAX) {
    return `Use a percentage from ${SPECIAL_PRICING_PERCENT_MIN}% to +${SPECIAL_PRICING_PERCENT_MAX}%`;
  }
  if (percent === 0) return "A 0% change does nothing — enter an increase or a decrease";
  if (Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6) return "Use at most 2 decimal places";
  return null;
}

type RuleShape = {
  startDate?: string | null;
  endDate?: string | null;
  percent?: number | null;
  scope?: SpecialPricingScopeValue | null;
  categoryIds?: number[] | null;
  vehicleIds?: number[] | null;
};

/**
 * Cross-field rules shared by create, update (checked on the merged rule) and
 * preview: end on or after start, at most SPECIAL_PRICING_MAX_DAYS days, a valid
 * percentage, and categories / vehicles picked for those scopes.
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
  if (rule.percent != null) {
    const issue = specialPricingPercentIssue(rule.percent);
    if (issue) issues.push({ path: "percent", message: issue });
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

// Base object (no refinements) — allows .partial() / .extend() below
const specialPricingRuleBase = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the festival a name")
    .max(SPECIAL_PRICING_NAME_MAX, `Use at most ${SPECIAL_PRICING_NAME_MAX} characters`),
  startDate: calendarDate,
  endDate: calendarDate,
  percent: z.number({ invalid_type_error: "Enter a percentage" }),
  scope: z.enum(SPECIAL_PRICING_SCOPES).default("ALL"),
  // Only the list matching the scope is kept (the other is stored empty)
  categoryIds: ids(200).default([]),
  vehicleIds: ids(1000).default([]),
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
  .pick({ startDate: true, endDate: true, percent: true, scope: true, categoryIds: true, vehicleIds: true })
  .extend({ branchId: z.number().int().positive().optional() })
  .superRefine(refineRule);

export type CreateSpecialPricingRuleInput = z.infer<typeof createSpecialPricingRuleSchema>;
export type UpdateSpecialPricingRuleInput = z.infer<typeof updateSpecialPricingRuleSchema>;
export type SpecialPricingPreviewInput = z.infer<typeof specialPricingPreviewSchema>;
