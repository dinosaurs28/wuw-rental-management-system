/**
 * Filters of the Fleet Pickup / Return queue search bar (client, Oct 20 2026):
 * vehicle type (type class, category), vehicle model (make + model), trip type,
 * time (today / tomorrow / overdue / a date range) and payment. Different
 * filters combine with AND; several values of one filter with OR. All of them
 * combine with the registration-number search `q` and stay branch-scoped.
 *
 * Every param is optional: with none, the queue endpoints answer exactly as
 * before (old app builds never send them). List params take repeated / `[]`
 * values or one comma-separated string (groupKey: repeated only — names can
 * hold commas).
 *
 * Vehicle filters (type, category, model, trip type) resolve to the branch's
 * matching vehicle ids together with `q` — one vehicle must meet all of them —
 * and filter the bookings like the search does. Time and payment filter the
 * bookings directly. parseQueueFilters / vehicleMatchesQueueFilters /
 * buildQueueFilterWhere are pure (queueFilters.test.ts).
 */
import { z } from "zod";
import type { DateTime } from "luxon";
import { prisma, type Prisma, VehicleTypeClass } from "@repo/database/client";
import {
  normalizeUseCases,
  VEHICLE_USE_CASE_LABELS,
  VEHICLE_USE_CASES,
  type VehicleUseCaseValue,
} from "@repo/schemas";
import { TimezoneService } from "../../services/timezone/timezone.service.js";
import { fleetSearchBookingWhere, vehicleMatchesFleetQuery, type FleetQuery } from "./fleetSearch.js";
import type { QueuePhase } from "./completedQueue.js";

export const QUEUE_WHEN_VALUES = ["today", "tomorrow", "overdue"] as const;
export type QueueWhen = (typeof QUEUE_WHEN_VALUES)[number];

/**
 * balance_due: an advance-only booking whose balance is still to collect
 * (isAdvancePayment, remainingBalance > 0, remainingPaidAt unset);
 * paid: every other booking (paid in full up front, or the balance settled).
 */
export const QUEUE_PAYMENT_VALUES = ["balance_due", "paid"] as const;
export type QueuePayment = (typeof QUEUE_PAYMENT_VALUES)[number];

export const QUEUE_TYPE_CLASSES = [
  VehicleTypeClass.TWO_WHEELER,
  VehicleTypeClass.FOUR_WHEELER,
  VehicleTypeClass.OTHER,
] as const;
export type QueueTypeClass = (typeof QUEUE_TYPE_CLASSES)[number];

export const QUEUE_TYPE_CLASS_LABELS: Record<QueueTypeClass, string> = {
  TWO_WHEELER: "Two-wheeler",
  FOUR_WHEELER: "Four-wheeler",
  OTHER: "Other",
};

/** Most values kept per list param. */
export const QUEUE_FILTER_MAX_VALUES = 50;

export interface QueueFilters {
  typeClass: QueueTypeClass[];
  /** VehicleCategory publicIds */
  category: string[];
  /** queueGroupKey(make, model) */
  groupKey: string[];
  tripType: VehicleUseCaseValue[];
  when: QueueWhen[];
  /** IST day YYYY-MM-DD, inclusive (either end may be open) */
  from: string | null;
  to: string | null;
  payment: QueuePayment[];
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  typeClass: [],
  category: [],
  groupKey: [],
  tripType: [],
  when: [],
  from: null,
  to: null,
  payment: [],
};

/** Make / model in the form group keys compare: trimmed, spaces collapsed, upper-case. */
const normalizeGroupPart = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/** The model-filter key of a make + model ("MARUTI__SWIFT DZIRE"). */
export const queueGroupKey = (make: string, model: string) =>
  `${normalizeGroupPart(make)}__${normalizeGroupPart(model)}`;

const isIndexedObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && Object.keys(v).length > 0 && Object.keys(v).every((k) => /^\d+$/.test(k));

const toList = (splitCommas: boolean) => (raw: unknown) => {
  if (raw === undefined || raw === null || raw === "") return [];
  const parts = Array.isArray(raw)
    ? raw
    : isIndexedObject(raw)
      ? Object.values(raw) // the query parser turns more than 20 repeated values into {"0": …}
      : [raw];
  const out: unknown[] = [];
  for (const part of parts) {
    if (typeof part !== "string") {
      out.push(part);
      continue;
    }
    for (const piece of splitCommas ? part.split(",") : [part]) {
      const value = piece.trim();
      if (value) out.push(value);
    }
  }
  return [...new Set(out)];
};

const upper = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : v);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

const listOf = <T extends z.ZodType>(item: T, splitCommas = true) =>
  z.preprocess(toList(splitCommas), z.array(item).max(QUEUE_FILTER_MAX_VALUES));

const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => TimezoneService.parseISO(s).isValid, "is not a valid date");

const optionalYmd = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v),
  ymdSchema.nullable(),
);

const tripTypeSchema = z
  .string()
  .transform((s, ctx) => {
    const [value] = normalizeUseCases([s]);
    if (!value) {
      ctx.addIssue({ code: "custom", message: `must be one of ${VEHICLE_USE_CASES.join(", ")}` });
      return z.NEVER;
    }
    return value;
  });

export const queueFiltersQuerySchema = z
  .object({
    typeClass: listOf(z.preprocess(upper, z.enum(QUEUE_TYPE_CLASSES))),
    category: listOf(z.string().max(64)),
    groupKey: listOf(z.string().max(200), false),
    tripType: listOf(tripTypeSchema),
    when: listOf(z.preprocess(lower, z.enum(QUEUE_WHEN_VALUES))),
    from: optionalYmd,
    to: optionalYmd,
    payment: listOf(z.preprocess(lower, z.enum(QUEUE_PAYMENT_VALUES))),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: "from must be on or before to", path: ["from"] });

export const INVALID_QUEUE_FILTER = "INVALID_QUEUE_FILTER";

export type ParsedQueueFilters = { ok: true; filters: QueueFilters } | { ok: false; message: string };

/** The queue filters of a request's query (unknown params ignored). */
export function parseQueueFilters(query: Record<string, unknown>): ParsedQueueFilters {
  const result = queueFiltersQuerySchema.safeParse({
    typeClass: query.typeClass,
    category: query.category,
    groupKey: query.groupKey,
    tripType: query.tripType,
    when: query.when,
    from: query.from,
    to: query.to,
    payment: query.payment,
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path?.[0] != null ? String(issue.path[0]) : "filter";
    return { ok: false, message: `Invalid ${field}: ${issue?.message ?? "bad value"}` };
  }
  const f = result.data;
  return {
    ok: true,
    filters: {
      typeClass: f.typeClass,
      category: f.category,
      groupKey: f.groupKey.map((key) => {
        const idx = key.indexOf("__");
        return idx === -1 ? normalizeGroupPart(key) : queueGroupKey(key.slice(0, idx), key.slice(idx + 2));
      }),
      tripType: [...new Set(f.tripType)],
      when: f.when,
      from: f.from,
      to: f.to,
      payment: f.payment,
    },
  };
}

export const hasVehicleFilters = (f: QueueFilters) =>
  f.typeClass.length > 0 || f.category.length > 0 || f.groupKey.length > 0 || f.tripType.length > 0;

export const hasTimeFilter = (f: QueueFilters) => f.when.length > 0 || f.from != null || f.to != null;

/** Both payment values (or none) leave the list unfiltered. */
export const hasPaymentFilter = (f: QueueFilters) => f.payment.length === 1;

export const hasAnyQueueFilter = (f: QueueFilters) => hasVehicleFilters(f) || hasTimeFilter(f) || hasPaymentFilter(f);

export interface QueueFilterVehicle {
  make: string;
  model: string;
  useCases: readonly unknown[];
  category: { publicId: string; typeClass: string } | null;
}

/** Whether a vehicle meets every vehicle filter (each one: any of its values). */
export function vehicleMatchesQueueFilters(v: QueueFilterVehicle, f: QueueFilters): boolean {
  if (f.typeClass.length > 0 && !(v.category && (f.typeClass as string[]).includes(v.category.typeClass))) return false;
  if (f.category.length > 0 && !(v.category && f.category.includes(v.category.publicId))) return false;
  if (f.groupKey.length > 0 && !f.groupKey.includes(queueGroupKey(v.make, v.model))) return false;
  if (f.tripType.length > 0) {
    const tags = normalizeUseCases(v.useCases);
    if (!f.tripType.some((t) => tags.includes(t))) return false;
  }
  return true;
}

export interface TimeRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * The scheduled-time ranges of the time filter (pickup: startAt, return: endAt),
 * any of which matches: today / tomorrow are IST days, overdue is "before now",
 * from / to one range of IST days. Empty = no time filter.
 */
export function queueTimeRanges(f: QueueFilters, now: DateTime): TimeRange[] {
  const ranges: TimeRange[] = [];
  const day = (dt: DateTime): TimeRange => ({
    gte: TimezoneService.toPrisma(TimezoneService.startOfDay(dt)),
    lte: TimezoneService.toPrisma(TimezoneService.endOfDay(dt)),
  });
  for (const when of f.when) {
    if (when === "today") ranges.push(day(now));
    else if (when === "tomorrow") ranges.push(day(now.plus({ days: 1 })));
    else ranges.push({ lt: TimezoneService.toPrisma(now) });
  }
  if (f.from || f.to) {
    ranges.push({
      ...(f.from && { gte: TimezoneService.toPrisma(TimezoneService.startOfDay(TimezoneService.parseISO(f.from))) }),
      ...(f.to && { lte: TimezoneService.toPrisma(TimezoneService.endOfDay(TimezoneService.parseISO(f.to))) }),
    });
  }
  return ranges;
}

export const balanceDueWhere: Prisma.BookingWhereInput = {
  isAdvancePayment: true,
  remainingPaidAt: null,
  remainingBalance: { gt: 0 },
};

export function paymentWhere(f: QueueFilters): Prisma.BookingWhereInput | null {
  if (!hasPaymentFilter(f)) return null;
  return f.payment[0] === "balance_due" ? balanceDueWhere : { NOT: balanceDueWhere };
}

/** Pickup queue rows are scheduled by startAt, return queue rows by endAt. */
export const scheduledField = (phase: QueuePhase) => (phase === "PICKUP" ? "startAt" : "endAt");

export function timeWhere(phase: QueuePhase, f: QueueFilters, now: DateTime): Prisma.BookingWhereInput | null {
  const ranges = queueTimeRanges(f, now);
  if (ranges.length === 0) return null;
  const field = scheduledField(phase);
  const clauses = ranges.map((range) => ({ [field]: range }) as Prisma.BookingWhereInput);
  return clauses.length === 1 ? clauses[0]! : { OR: clauses };
}

/**
 * The booking filter for the queue filters: `vehicleIds` (search and/or vehicle
 * filters, undefined = neither), the time filter and the payment filter, ANDed.
 * Returns {} when nothing applies.
 */
export function buildQueueFilterWhere(
  phase: QueuePhase,
  f: QueueFilters,
  opts: { now: DateTime; vehicleIds?: number[] },
): Prisma.BookingWhereInput {
  const parts: Prisma.BookingWhereInput[] = [];
  if (opts.vehicleIds) parts.push(fleetSearchBookingWhere(opts.vehicleIds));
  const time = timeWhere(phase, f, opts.now);
  if (time) parts.push(time);
  const payment = paymentWhere(f);
  if (payment) parts.push(payment);
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0]! : { AND: parts };
}

/**
 * The day range the `completed` list covers under a time filter: the span of
 * its days (today / tomorrow / from–to; an open end takes the fallback day's
 * edge). Null when the time filter is only "overdue" — nothing done is overdue.
 * Without a time filter: the fallback (the requested day).
 */
export function completedDayFor(
  f: QueueFilters,
  now: DateTime,
  fallback: { gte: Date; lte: Date },
): { gte: Date; lte: Date } | null {
  if (!hasTimeFilter(f)) return fallback;
  const ranges = queueTimeRanges(f, now).filter((r) => r.lt === undefined);
  if (ranges.length === 0) return null;
  const gte = Math.min(...ranges.map((r) => (r.gte ?? fallback.gte).getTime()));
  const lte = Math.max(...ranges.map((r) => (r.lte ?? fallback.lte).getTime()));
  return gte <= lte ? { gte: new Date(gte), lte: new Date(lte) } : null;
}

/**
 * Ids of the branch's vehicles (retired ones still on rents included) matching
 * the search and every vehicle filter; undefined when neither is given.
 */
export async function queueVehicleIds(
  branchId: number,
  search: FleetQuery | null,
  f: QueueFilters,
): Promise<number[] | undefined> {
  if (!search && !hasVehicleFilters(f)) return undefined;
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId },
    select: {
      id: true,
      make: true,
      model: true,
      regNo: true,
      useCases: true,
      category: { select: { publicId: true, typeClass: true } },
    },
  });
  return vehicles
    .filter((v) => (!search || vehicleMatchesFleetQuery(v, search)) && vehicleMatchesQueueFilters(v, f))
    .map((v) => v.id);
}

/**
 * The branch's filter options (GET /employee/queue-filters): type classes,
 * categories, models and trip types its fleet has, each with the number of the
 * branch's vehicles (retired ones left out); payment and time choices labelled
 * for the queue (`phase`).
 */
export async function queueFilterOptions(branchId: number, phase: QueuePhase) {
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId, deletedAt: null },
    select: {
      make: true,
      model: true,
      useCases: true,
      category: { select: { publicId: true, name: true, rank: true, typeClass: true } },
    },
  });
  const typeCounts = new Map<string, number>();
  const categories = new Map<string, { value: string; label: string; typeClass: string; rank: number; count: number }>();
  const groups = new Map<string, { value: string; label: string; make: string; model: string; count: number }>();
  const tripCounts = new Map<string, number>();
  for (const v of vehicles) {
    const c = v.category;
    typeCounts.set(c.typeClass, (typeCounts.get(c.typeClass) ?? 0) + 1);
    const cat = categories.get(c.publicId) ?? { value: c.publicId, label: c.name, typeClass: c.typeClass, rank: c.rank, count: 0 };
    cat.count += 1;
    categories.set(c.publicId, cat);
    const key = queueGroupKey(v.make, v.model);
    const make = v.make.trim().replace(/\s+/g, " ");
    const model = v.model.trim().replace(/\s+/g, " ");
    const group = groups.get(key) ?? { value: key, label: `${make} ${model}`, make, model, count: 0 };
    group.count += 1;
    groups.set(key, group);
    for (const tag of normalizeUseCases(v.useCases)) tripCounts.set(tag, (tripCounts.get(tag) ?? 0) + 1);
  }
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return {
    typeClasses: QUEUE_TYPE_CLASSES.filter((t) => typeCounts.has(t)).map((t) => ({
      value: t,
      label: QUEUE_TYPE_CLASS_LABELS[t],
      count: typeCounts.get(t) ?? 0,
    })),
    categories: [...categories.values()]
      .sort((a, b) => a.rank - b.rank || byLabel(a, b))
      .map(({ rank: _rank, ...rest }) => rest),
    groups: [...groups.values()].sort(byLabel),
    tripTypes: VEHICLE_USE_CASES.filter((t) => tripCounts.has(t)).map((t) => ({
      value: t,
      label: VEHICLE_USE_CASE_LABELS[t],
      count: tripCounts.get(t) ?? 0,
    })),
    when: [
      { value: "today", label: "Today" },
      { value: "tomorrow", label: "Tomorrow" },
      ...(phase === "RETURN" ? [{ value: "overdue", label: "Overdue" }] : []),
    ],
    payment:
      phase === "PICKUP"
        ? [
            { value: "balance_due", label: "Advance only" },
            { value: "paid", label: "Fully paid" },
          ]
        : [
            { value: "balance_due", label: "Balance due" },
            { value: "paid", label: "No balance due" },
          ],
  };
}
