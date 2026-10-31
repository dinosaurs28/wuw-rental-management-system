import type { Response } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { Prisma, BookingStatus } from "@repo/database/client";
import { SYSTEM_TIMEZONE } from "../../services/timezone/timezone.service.js";
import {
  MAX_PERIOD_DAYS,
  PeriodRangeError,
  parseIstDate,
  resolveGroupBy,
  type PeriodGroupBy,
} from "./istPeriod.js";
import {
  REPORT_PRESETS,
  previousPeriod,
  resolvePresetDays,
  type PreviousPeriod,
  type ReportPreset,
} from "./previousPeriod.js";
import { buildBookingWhere } from "./filters.js";

/**
 * THE shared report filter parser (spec §9.1). Every report endpoint (and the
 * dashboard) parses its query with `parseReportFilters` so filters behave the
 * same everywhere:
 *
 *   from, to     yyyy-MM-dd IST days, inclusive. Both or neither (neither ⇒
 *                the default preset, "thisMonth" unless overridden).
 *   preset       today|yesterday|thisWeek|lastWeek|thisMonth|lastMonth|custom;
 *                overrides from/to (custom ⇒ from/to required).
 *   branchId     Branch.publicId (alias `branch`); "all"/empty ⇒ all branches.
 *   categories   VehicleCategory.publicId list, comma-separated or repeated
 *                (alias `categoryId`).
 *   vehicleId    Vehicle.publicId.
 *   compare      "1"/"true" ⇒ caller wants previous-period numbers.
 *   export       "csv" ⇒ caller wants a CSV download.
 *   groupBy      day|week|month|auto (default auto).
 * All filters combine (AND).
 */

export class ReportFilterError extends Error {
  readonly code = "INVALID_REPORT_FILTER";
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ReportFilterError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const emptyToUndef = (v: unknown) => {
  if (Array.isArray(v)) v = v[0];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" || s === "all" || s === "undefined" || s === "null" ? undefined : s;
};

const listParam = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  const parts = (Array.isArray(v) ? v : [v])
    .flatMap((x) => String(x).split(","))
    .map((s) => s.trim())
    .filter((s) => s && s !== "all");
  return Array.from(new Set(parts));
};

const boolParam = (v: unknown) => {
  const s = emptyToUndef(v);
  return s === "1" || s === "true" || s === "yes";
};

export const reportFilterQuerySchema = z.object({
  from: z.preprocess(emptyToUndef, z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional()),
  to: z.preprocess(emptyToUndef, z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional()),
  preset: z.preprocess(emptyToUndef, z.enum(REPORT_PRESETS as [ReportPreset, ...ReportPreset[]]).optional()),
  branchId: z.preprocess(emptyToUndef, z.string().regex(ID_RE, "invalid branchId").optional()),
  categories: z.preprocess(listParam, z.array(z.string().regex(ID_RE, "invalid category id")).max(50)),
  vehicleId: z.preprocess(emptyToUndef, z.string().regex(ID_RE, "invalid vehicleId").optional()),
  compare: z.preprocess(boolParam, z.boolean()),
  export: z.preprocess(emptyToUndef, z.enum(["csv"]).optional()),
  groupBy: z.preprocess(emptyToUndef, z.enum(["day", "week", "month", "auto"]).optional()),
});

export type ReportFilterQuery = z.infer<typeof reportFilterQuerySchema>;

export interface ReportFilters {
  /** yyyy-MM-dd IST, inclusive. */
  from: string;
  to: string;
  /** 00:00:00.000 IST of from / 23:59:59.999 IST of to. */
  start: Date;
  end: Date;
  days: number;
  preset: ReportPreset | null;
  branchPublicId: string | null;
  categoryPublicIds: string[];
  vehiclePublicId: string | null;
  compare: boolean;
  exportCsv: boolean;
  groupBy: PeriodGroupBy;
  /** The immediately preceding equivalent range (always computed). */
  previous: PreviousPeriod;
}

export interface ParseReportFiltersOptions {
  now?: DateTime;
  /** Used when neither preset nor from/to is given. Default thisMonth. */
  defaultPreset?: Exclude<ReportPreset, "custom">;
  maxDays?: number;
}

/** Normalise legacy aliases (branch, categoryId) onto the canonical names. */
const normaliseAliases = (query: Record<string, unknown>): Record<string, unknown> => {
  const q = { ...query };
  if (emptyToUndef(q.branchId) === undefined && q.branch !== undefined) q.branchId = q.branch;
  if (listParam(q.categories).length === 0 && q.categoryId !== undefined) q.categories = q.categoryId;
  return q;
};

export const parseReportFilters = (
  query: Record<string, unknown> | undefined | null,
  opts: ParseReportFiltersOptions = {},
): ReportFilters => {
  const parsed = reportFilterQuerySchema.safeParse(normaliseAliases(query ?? {}));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ReportFilterError(first?.message ?? "Invalid report filters");
  }
  const q = parsed.data;
  const now = (opts.now ?? DateTime.now()).setZone(SYSTEM_TIMEZONE);
  const maxDays = opts.maxDays ?? MAX_PERIOD_DAYS;

  let preset: ReportPreset | null = q.preset ?? null;
  let from: string;
  let to: string;

  if (preset && preset !== "custom") {
    ({ from, to } = resolvePresetDays(preset, now));
  } else if (q.from && q.to) {
    from = q.from;
    to = q.to;
  } else if (q.from || q.to || preset === "custom") {
    throw new ReportFilterError("Send both 'from' and 'to' (YYYY-MM-DD).");
  } else {
    preset = opts.defaultPreset ?? "thisMonth";
    ({ from, to } = resolvePresetDays(preset, now));
  }

  const fromDay = parseIstDate(from);
  const toDay = parseIstDate(to);
  if (!fromDay) throw new ReportFilterError(`'${from}' is not a valid date.`);
  if (!toDay) throw new ReportFilterError(`'${to}' is not a valid date.`);
  if (toDay < fromDay) throw new ReportFilterError("The start date must be on or before the end date.");
  const days = Math.round(toDay.diff(fromDay, "days").days) + 1;
  if (days > maxDays) {
    throw new ReportFilterError(`Pick a range of at most ${maxDays} days (this one is ${days}).`);
  }

  return {
    from,
    to,
    start: fromDay.startOf("day").toJSDate(),
    end: toDay.endOf("day").toJSDate(),
    days,
    preset,
    branchPublicId: q.branchId ?? null,
    categoryPublicIds: q.categories,
    vehiclePublicId: q.vehicleId ?? null,
    compare: q.compare,
    exportCsv: q.export === "csv",
    groupBy: resolveGroupBy(q.groupBy ?? "auto", days),
    previous: previousPeriod({ from, to, preset, now }),
  };
};

/**
 * Standard catch-block response for report endpoints: 400 with a readable
 * message for bad filters, 500 otherwise. Never leaks internals.
 */
export const handleReportError = (res: Response, err: unknown, label: string): void => {
  if (err instanceof ReportFilterError || err instanceof PeriodRangeError) {
    res.status(400).json({ message: err.message, code: err.code });
    return;
  }
  console.error(`[reports] ${label}:`, err);
  if (!res.headersSent) res.status(500).json({ message: `Failed to load ${label}` });
  else res.end();
};

type Range = { start: Date; end: Date };

/**
 * Booking `where` for the parsed filters: wraps buildBookingWhere (startAt
 * anchor, revenue statuses by default, branch, category, soft-delete) and adds
 * the individual-vehicle filter. Pass `range: f.previous` for the previous period.
 */
export const bookingWhereFromFilters = (
  f: ReportFilters,
  opts: {
    statuses?: BookingStatus[];
    dateField?: "startAt" | "endAt" | "createdAt" | "cancelledAt";
    range?: Range;
  } = {},
): Prisma.BookingWhereInput => {
  const range = opts.range ?? f;
  const where = buildBookingWhere({
    branchPublicId: f.branchPublicId,
    categoryPublicIds: f.categoryPublicIds,
    from: range.start,
    to: range.end,
    statuses: opts.statuses,
    dateField: opts.dateField,
  });
  return applyVehicleToBookingWhere(where, f.vehiclePublicId);
};

/** Adds an individual-vehicle filter (combined with any category filter). */
export const applyVehicleToBookingWhere = (
  where: Prisma.BookingWhereInput,
  vehiclePublicId: string | null | undefined,
): Prisma.BookingWhereInput => {
  if (!vehiclePublicId) return where;
  const vehicleClause: Prisma.BookingWhereInput = {
    items: { some: { vehicle: { publicId: vehiclePublicId } } },
  };
  return { AND: [where, vehicleClause] };
};

/** Booking scope (branch/category/vehicle + not deleted) without a date or status. */
export const bookingScopeFromFilters = (
  f: Pick<ReportFilters, "branchPublicId" | "categoryPublicIds" | "vehiclePublicId">,
): Prisma.BookingWhereInput => {
  const clauses: Prisma.BookingWhereInput[] = [{ deletedAt: null }];
  if (f.branchPublicId) clauses.push({ branch: { publicId: f.branchPublicId } });
  if (f.categoryPublicIds.length > 0) {
    clauses.push({
      items: { some: { vehicle: { category: { publicId: { in: f.categoryPublicIds } } } } },
    });
  }
  if (f.vehiclePublicId) {
    clauses.push({ items: { some: { vehicle: { publicId: f.vehiclePublicId } } } });
  }
  return clauses.length === 1 ? clauses[0]! : { AND: clauses };
};

/** Vehicle `where` for the parsed filters (branch, category, vehicle). */
export const vehicleWhereFromFilters = (
  f: Pick<ReportFilters, "branchPublicId" | "categoryPublicIds" | "vehiclePublicId">,
  opts: { includeInactive?: boolean } = {},
): Prisma.VehicleWhereInput => {
  const where: Prisma.VehicleWhereInput = { deletedAt: null };
  if (!opts.includeInactive) where.status = { not: "INACTIVE" };
  if (f.branchPublicId) where.branch = { publicId: f.branchPublicId };
  if (f.categoryPublicIds.length > 0) where.category = { publicId: { in: f.categoryPublicIds } };
  if (f.vehiclePublicId) where.publicId = f.vehiclePublicId;
  return where;
};

/**
 * PaymentTransaction `where` for the parsed filters, anchored on the payment
 * date (collectedAt, else createdAt). Branch is the transaction's branch;
 * category/vehicle go through the booking. No status/purpose filter — add
 * COLLECTED_PAYMENT_STATUSES / purposes yourself (that excludes VOIDED).
 */
export const paymentWhereFromFilters = (
  f: ReportFilters,
  range?: Range,
): Prisma.PaymentTransactionWhereInput => {
  const r = range ?? f;
  const clauses: Prisma.PaymentTransactionWhereInput[] = [
    {
      OR: [
        { collectedAt: { gte: r.start, lte: r.end } },
        { collectedAt: null, createdAt: { gte: r.start, lte: r.end } },
      ],
    },
  ];
  if (f.branchPublicId) clauses.push({ branch: { publicId: f.branchPublicId } });
  if (f.categoryPublicIds.length > 0 || f.vehiclePublicId) {
    clauses.push({
      booking: bookingScopeFromFilters({ ...f, branchPublicId: null }),
    });
  }
  return { AND: clauses };
};
