import { DateTime } from "luxon";
import {
  prisma,
  Prisma,
  BookingStatus,
  ExtensionStatus,
  PaymentStatus,
  RefundStatus,
  Role,
  type RentalPeriodType,
} from "@repo/database/client";
import { round2 } from "@repo/schemas";
import {
  buildBookingWhere,
  getCollections,
  getPaidByBooking,
  DB_STATUS_TO_SPEC,
  type CollectionTxn,
} from "../../utils/reporting/index.js";
import {
  enumerateIstBuckets,
  istBucketIndexer,
  type IstBucket,
  type IstPeriod,
  type PeriodGroupBy,
} from "../../utils/reporting/istPeriod.js";
import { DurationCalculatorService } from "../pricing/duration-calculator.service.js";
import { SYSTEM_TIMEZONE } from "../timezone/timezone.service.js";

/**
 * Branch Manager "Period" report (#14) — one branch, one IST date range.
 *
 * Date anchors (same conventions as the admin reporting core):
 *   bookings / booking value / outstanding / breakdowns → Booking.startAt
 *     (CONFIRMED, PICKED_UP, RETURNED; buildBookingWhere)
 *   collected     → payment time (collectedAt, else createdAt; getCollections)
 *   cancellations → Booking.cancelledAt (CANCELLED)
 *   returns       → Booking.returnedAt, else ReturnReceipt.createdAt (RETURNED)
 *   extensions    → BookingExtension.createdAt (CONFIRMED)
 *   refunds       → RefundRequest.completedAt (COMPLETED)
 *
 * Rental period type is recomputed from startAt/endAt with the pricing
 * DurationCalculatorService: the stored Booking.rentalPeriodType is missing on
 * walk-ins and goes stale after an extension. An explicit monthly plan
 * (stored MONTHLY) always stays Monthly.
 *
 * Invariants: Σ byRentalPeriod.bookingValue == Σ bySource.bookingValue ==
 * Σ trend.bookingValue == summary.bookingValue, and the same for counts.
 */

export const PERIOD_TYPES = [
  "HOURLY",
  "HALF_DAY",
  "FULL_DAY",
  "MULTI_DAY",
  "MONTHLY",
] as const;
export type PeriodTypeKey = (typeof PERIOD_TYPES)[number];

export const PERIOD_TYPE_LABELS: Record<PeriodTypeKey, string> = {
  HOURLY: "Hourly",
  HALF_DAY: "12 hours",
  FULL_DAY: "1 day",
  MULTI_DAY: "Multi-day",
  MONTHLY: "Monthly",
};

export const BOOKING_SOURCES = ["ONLINE", "COUNTER"] as const;
export type BookingSourceKey = (typeof BOOKING_SOURCES)[number];

export const BOOKING_SOURCE_LABELS: Record<BookingSourceKey, string> = {
  ONLINE: "Online",
  COUNTER: "Counter",
};

/** Statuses the bookings list can show (HOLD / HOLD_EXPIRED never were bookings). */
export const LISTABLE_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
  BookingStatus.CANCELLED,
] as const;
export type ListableStatus = (typeof LISTABLE_STATUSES)[number];

/** Online = booked by the customer; Counter = created by staff/manager (walk-in). */
export const bookingSource = (creatorRole: Role | null | undefined): BookingSourceKey =>
  creatorRole === Role.CUSTOMER ? "ONLINE" : "COUNTER";

/**
 * Rental period type from the booking's CURRENT start/end, using the same
 * classifier pricing uses. Stored MONTHLY (explicit monthly plan) wins.
 */
export const classifyRentalPeriod = (
  startAt: Date,
  endAt: Date,
  stored: RentalPeriodType | null,
): PeriodTypeKey => {
  if (stored === "MONTHLY") return "MONTHLY";
  try {
    return DurationCalculatorService.calculate(
      DateTime.fromJSDate(startAt, { zone: SYSTEM_TIMEZONE }),
      DateTime.fromJSDate(endAt, { zone: SYSTEM_TIMEZONE }),
    ).periodType as PeriodTypeKey;
  } catch {
    // endAt <= startAt (corrupt row) — fall back to what was stored.
    return (stored ?? "FULL_DAY") as PeriodTypeKey;
  }
};

const pct = (part: number, whole: number): number =>
  whole > 0 ? round2((part / whole) * 100) : 0;

/** % change vs the previous period; null when the previous value is 0 and current isn't. */
const change = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

// ─── Facts: raw rows for one window ───────────────────────────────────────────

interface BranchRef {
  id: number;
  publicId: string;
  name: string;
}

interface Window {
  start: Date;
  end: Date;
}

interface PeriodFacts {
  bookings: {
    id: number;
    startAt: Date;
    endAt: Date;
    rentalPeriodType: RentalPeriodType | null;
    totalFinal: Prisma.Decimal;
    totalDeposit: Prisma.Decimal;
    createdBy: { role: Role };
  }[];
  paid: Map<number, { total: number }>;
  collections: CollectionTxn[];
  cancellations: {
    cancelledAt: Date | null;
    cancellationInvoice: { cancellationFee: Prisma.Decimal } | null;
  }[];
  returns: {
    returnedAt: Date | null;
    returnReceipt: { createdAt: Date } | null;
  }[];
  extensions: {
    createdAt: Date;
    additionalAmount: Prisma.Decimal;
    baseAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxableAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    cgstAmount: Prisma.Decimal;
    sgstAmount: Prisma.Decimal;
  }[];
  refunds: { completedAt: Date | null; amount: Prisma.Decimal }[];
}

const loadFacts = async (branch: BranchRef, w: Window): Promise<PeriodFacts> => {
  const range = { gte: w.start, lte: w.end };

  const [bookings, collections, cancellations, returns, extensions, refunds] =
    await Promise.all([
      prisma.booking.findMany({
        where: { ...buildBookingWhere({ from: w.start, to: w.end }), branchId: branch.id },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          rentalPeriodType: true,
          totalFinal: true,
          totalDeposit: true,
          createdBy: { select: { role: true } },
        },
      }),
      getCollections({ branchPublicId: branch.publicId, from: w.start, to: w.end }),
      prisma.booking.findMany({
        where: {
          ...buildBookingWhere({
            from: w.start,
            to: w.end,
            statuses: [BookingStatus.CANCELLED],
            dateField: "cancelledAt",
          }),
          branchId: branch.id,
        },
        select: {
          cancelledAt: true,
          cancellationInvoice: { select: { cancellationFee: true } },
        },
      }),
      prisma.booking.findMany({
        where: {
          deletedAt: null,
          branchId: branch.id,
          status: BookingStatus.RETURNED,
          OR: [
            { returnedAt: range },
            { returnedAt: null, returnReceipt: { createdAt: range } },
          ],
        },
        select: {
          returnedAt: true,
          returnReceipt: { select: { createdAt: true } },
        },
      }),
      prisma.bookingExtension.findMany({
        where: {
          branchId: branch.id,
          extensionStatus: ExtensionStatus.CONFIRMED,
          createdAt: range,
          booking: { deletedAt: null },
        },
        select: {
          createdAt: true,
          additionalAmount: true,
          baseAmount: true,
          discountAmount: true,
          taxableAmount: true,
          taxAmount: true,
          cgstAmount: true,
          sgstAmount: true,
        },
      }),
      prisma.refundRequest.findMany({
        where: {
          branchId: branch.id,
          status: RefundStatus.COMPLETED,
          completedAt: range,
        },
        select: { completedAt: true, amount: true },
      }),
    ]);

  const paid = await getPaidByBooking(bookings.map((b) => b.id));

  return { bookings, paid, collections, cancellations, returns, extensions, refunds };
};

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export interface PeriodKpis {
  bookings: number;
  /** Σ Booking.totalFinal (incl. confirmed extensions and the refundable category deposit). */
  bookingValue: number;
  /** Portion of bookingValue that is refundable category deposit (Σ totalDeposit). */
  depositsInBookingValue: number;
  averageBookingValue: number;
  collected: {
    total: number;
    cash: number;
    online: number;
    upi: number;
    gateway: number;
    payments: number;
  };
  outstanding: number;
  outstandingBookings: number;
  cancellations: { count: number; fees: number };
  returns: { count: number };
  extensions: {
    count: number;
    amount: number;
    baseAmount: number;
    discountAmount: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    taxAmount: number;
  };
  refunds: { count: number; amount: number };
}

const summarize = (facts: PeriodFacts): PeriodKpis => {
  let bookingValue = 0;
  let deposits = 0;
  let outstanding = 0;
  let outstandingBookings = 0;
  for (const b of facts.bookings) {
    const total = Number(b.totalFinal);
    bookingValue += total;
    deposits += Number(b.totalDeposit);
    const due = total - (facts.paid.get(b.id)?.total ?? 0);
    if (due > 0.004) {
      outstanding += due;
      outstandingBookings += 1;
    }
  }

  const collected = { total: 0, cash: 0, online: 0, upi: 0, gateway: 0 };
  for (const c of facts.collections) {
    collected.total += c.total;
    collected.cash += c.cash;
    collected.online += c.online;
    collected.upi += c.upi;
    collected.gateway += c.gateway;
  }

  const ext = {
    amount: 0,
    baseAmount: 0,
    discountAmount: 0,
    taxableAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    taxAmount: 0,
  };
  for (const e of facts.extensions) {
    ext.amount += Number(e.additionalAmount);
    ext.baseAmount += Number(e.baseAmount);
    ext.discountAmount += Number(e.discountAmount);
    ext.taxableAmount += Number(e.taxableAmount);
    ext.cgstAmount += Number(e.cgstAmount);
    ext.sgstAmount += Number(e.sgstAmount);
    ext.taxAmount += Number(e.taxAmount);
  }

  const count = facts.bookings.length;
  return {
    bookings: count,
    bookingValue: round2(bookingValue),
    depositsInBookingValue: round2(deposits),
    averageBookingValue: count > 0 ? round2(bookingValue / count) : 0,
    collected: {
      total: round2(collected.total),
      cash: round2(collected.cash),
      online: round2(collected.online),
      upi: round2(collected.upi),
      gateway: round2(collected.gateway),
      payments: facts.collections.length,
    },
    outstanding: round2(outstanding),
    outstandingBookings,
    cancellations: {
      count: facts.cancellations.length,
      fees: round2(
        facts.cancellations.reduce(
          (s, c) => s + Number(c.cancellationInvoice?.cancellationFee ?? 0),
          0,
        ),
      ),
    },
    returns: { count: facts.returns.length },
    extensions: {
      count: facts.extensions.length,
      amount: round2(ext.amount),
      baseAmount: round2(ext.baseAmount),
      discountAmount: round2(ext.discountAmount),
      taxableAmount: round2(ext.taxableAmount),
      cgstAmount: round2(ext.cgstAmount),
      sgstAmount: round2(ext.sgstAmount),
      taxAmount: round2(ext.taxAmount),
    },
    refunds: {
      count: facts.refunds.length,
      amount: round2(facts.refunds.reduce((s, r) => s + Number(r.amount), 0)),
    },
  };
};

export interface PeriodKpiChange {
  bookings: number | null;
  bookingValue: number | null;
  collected: number | null;
  outstanding: number | null;
  cancellations: number | null;
  returns: number | null;
  extensions: number | null;
  extensionAmount: number | null;
  refunds: number | null;
  refundAmount: number | null;
}

const compare = (cur: PeriodKpis, prev: PeriodKpis): PeriodKpiChange => ({
  bookings: change(cur.bookings, prev.bookings),
  bookingValue: change(cur.bookingValue, prev.bookingValue),
  collected: change(cur.collected.total, prev.collected.total),
  outstanding: change(cur.outstanding, prev.outstanding),
  cancellations: change(cur.cancellations.count, prev.cancellations.count),
  returns: change(cur.returns.count, prev.returns.count),
  extensions: change(cur.extensions.count, prev.extensions.count),
  extensionAmount: change(cur.extensions.amount, prev.extensions.amount),
  refunds: change(cur.refunds.count, prev.refunds.count),
  refundAmount: change(cur.refunds.amount, prev.refunds.amount),
});

// ─── Breakdowns + trend ───────────────────────────────────────────────────────

export interface RentalPeriodBreakdownRow {
  type: PeriodTypeKey;
  label: string;
  bookings: number;
  bookingValue: number;
  averageValue: number;
  bookingsSharePct: number;
  valueSharePct: number;
}

export interface SourceBreakdownRow {
  source: BookingSourceKey;
  label: string;
  bookings: number;
  bookingValue: number;
  bookingsSharePct: number;
  valueSharePct: number;
}

export interface TrendPoint extends IstBucket {
  bookings: number;
  bookingValue: number;
  collected: number;
  cash: number;
  online: number;
  cancellations: number;
  returns: number;
  extensions: number;
  extensionAmount: number;
  refunds: number;
  refundAmount: number;
}

const breakdowns = (facts: PeriodFacts, kpis: PeriodKpis) => {
  const byType = new Map<PeriodTypeKey, { bookings: number; value: number }>(
    PERIOD_TYPES.map((t) => [t, { bookings: 0, value: 0 }]),
  );
  const bySource = new Map<BookingSourceKey, { bookings: number; value: number }>(
    BOOKING_SOURCES.map((s) => [s, { bookings: 0, value: 0 }]),
  );

  for (const b of facts.bookings) {
    const value = Number(b.totalFinal);
    const t = byType.get(classifyRentalPeriod(b.startAt, b.endAt, b.rentalPeriodType))!;
    t.bookings += 1;
    t.value += value;
    const s = bySource.get(bookingSource(b.createdBy.role))!;
    s.bookings += 1;
    s.value += value;
  }

  const rentalPeriod: RentalPeriodBreakdownRow[] = PERIOD_TYPES.map((type) => {
    const agg = byType.get(type)!;
    return {
      type,
      label: PERIOD_TYPE_LABELS[type],
      bookings: agg.bookings,
      bookingValue: round2(agg.value),
      averageValue: agg.bookings > 0 ? round2(agg.value / agg.bookings) : 0,
      bookingsSharePct: pct(agg.bookings, kpis.bookings),
      valueSharePct: pct(agg.value, kpis.bookingValue),
    };
  });

  const source: SourceBreakdownRow[] = BOOKING_SOURCES.map((key) => {
    const agg = bySource.get(key)!;
    return {
      source: key,
      label: BOOKING_SOURCE_LABELS[key],
      bookings: agg.bookings,
      bookingValue: round2(agg.value),
      bookingsSharePct: pct(agg.bookings, kpis.bookings),
      valueSharePct: pct(agg.value, kpis.bookingValue),
    };
  });

  return { rentalPeriod, source };
};

const buildTrend = (
  facts: PeriodFacts,
  period: Pick<IstPeriod, "start" | "end">,
  groupBy: PeriodGroupBy,
): TrendPoint[] => {
  const buckets = enumerateIstBuckets(period, groupBy);
  const indexOf = istBucketIndexer(period, groupBy, buckets);
  const rows: TrendPoint[] = buckets.map((b) => ({
    ...b,
    bookings: 0,
    bookingValue: 0,
    collected: 0,
    cash: 0,
    online: 0,
    cancellations: 0,
    returns: 0,
    extensions: 0,
    extensionAmount: 0,
    refunds: 0,
    refundAmount: 0,
  }));
  const at = (d: Date | null | undefined) => {
    const i = indexOf(d);
    return i >= 0 ? rows[i]! : null;
  };

  for (const b of facts.bookings) {
    const r = at(b.startAt);
    if (!r) continue;
    r.bookings += 1;
    r.bookingValue += Number(b.totalFinal);
  }
  for (const c of facts.collections) {
    const r = at(c.collectedAt);
    if (!r) continue;
    r.collected += c.total;
    r.cash += c.cash;
    r.online += c.online;
  }
  for (const c of facts.cancellations) {
    const r = at(c.cancelledAt);
    if (r) r.cancellations += 1;
  }
  for (const x of facts.returns) {
    const r = at(x.returnedAt ?? x.returnReceipt?.createdAt ?? null);
    if (r) r.returns += 1;
  }
  for (const e of facts.extensions) {
    const r = at(e.createdAt);
    if (!r) continue;
    r.extensions += 1;
    r.extensionAmount += Number(e.additionalAmount);
  }
  for (const f of facts.refunds) {
    const r = at(f.completedAt);
    if (!r) continue;
    r.refunds += 1;
    r.refundAmount += Number(f.amount);
  }

  for (const r of rows) {
    r.bookingValue = round2(r.bookingValue);
    r.collected = round2(r.collected);
    r.cash = round2(r.cash);
    r.online = round2(r.online);
    r.extensionAmount = round2(r.extensionAmount);
    r.refundAmount = round2(r.refundAmount);
  }
  return rows;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export class BranchReportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BranchReportError";
  }
}

export const getReportBranch = async (branchId: number | null | undefined): Promise<BranchRef> => {
  if (!branchId) {
    throw new BranchReportError(
      403,
      "BRANCH_NOT_ASSIGNED",
      "Your account is not linked to a branch. Ask an admin to assign one.",
    );
  }
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, publicId: true, name: true },
  });
  if (!branch) {
    throw new BranchReportError(404, "BRANCH_NOT_FOUND", "Your branch could not be found.");
  }
  return branch;
};

export interface BranchPeriodSummary {
  summary: PeriodKpis;
  previous: PeriodKpis;
  change: PeriodKpiChange;
  byRentalPeriod: RentalPeriodBreakdownRow[];
  bySource: SourceBreakdownRow[];
  trend: TrendPoint[];
}

export const getBranchPeriodSummary = async (
  branch: BranchRef,
  period: IstPeriod,
  groupBy: PeriodGroupBy,
): Promise<BranchPeriodSummary> => {
  const [current, previousFacts] = await Promise.all([
    loadFacts(branch, { start: period.start, end: period.end }),
    loadFacts(branch, { start: period.prevStart, end: period.prevEnd }),
  ]);

  const summary = summarize(current);
  const previous = summarize(previousFacts);
  const { rentalPeriod, source } = breakdowns(current, summary);

  return {
    summary,
    previous,
    change: compare(summary, previous),
    byRentalPeriod: rentalPeriod,
    bySource: source,
    trend: buildTrend(current, period, groupBy),
  };
};

// ─── Bookings list ────────────────────────────────────────────────────────────

export interface PeriodBookingFilters {
  status: "all" | ListableStatus;
  rentalPeriod: "all" | PeriodTypeKey;
  source: "all" | BookingSourceKey;
  search?: string;
}

export interface PeriodBookingRow {
  publicId: string;
  customerName: string;
  customerPhone: string;
  vehicle: string;
  regNo: string;
  vehicles: { make: string; model: string; regNo: string }[];
  startAt: string;
  endAt: string;
  rentalPeriod: PeriodTypeKey;
  rentalPeriodLabel: string;
  source: BookingSourceKey;
  sourceLabel: string;
  /** Who created a counter booking; null for online bookings. */
  counterStaffName: string | null;
  status: BookingStatus;
  statusLabel: string;
  total: number;
  paid: number;
  balance: number;
  extensionCount: number;
}

export interface PeriodBookingsPage {
  rows: PeriodBookingRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  totals: { bookings: number; total: number; paid: number; balance: number };
}

const listWhere = (
  branch: BranchRef,
  period: Pick<IstPeriod, "start" | "end">,
  filters: PeriodBookingFilters,
): Prisma.BookingWhereInput => {
  const where: Prisma.BookingWhereInput = {
    ...buildBookingWhere({
      from: period.start,
      to: period.end,
      statuses: filters.status === "all" ? [...LISTABLE_STATUSES] : [filters.status],
    }),
    branchId: branch.id,
    // A failed online checkout (failBookingPayment: HOLD → CANCELLED, payment
    // FAILED, no cancelledAt) never was a booking — same as the HOLD rows.
    NOT: { status: BookingStatus.CANCELLED, paymentStatus: PaymentStatus.FAILED, cancelledAt: null },
  };
  if (filters.source === "ONLINE") where.createdBy = { role: Role.CUSTOMER };
  else if (filters.source === "COUNTER") where.createdBy = { role: { not: Role.CUSTOMER } };

  const q = filters.search?.trim();
  if (q) {
    where.OR = [
      { publicId: { contains: q, mode: "insensitive" } },
      { customer: { user: { name: { contains: q, mode: "insensitive" } } } },
      { customer: { user: { phone: { contains: q } } } },
      { items: { some: { vehicle: { regNo: { contains: q, mode: "insensitive" } } } } },
    ];
  }
  return where;
};

/**
 * Bookings starting in the period, newest start first. Rental period type is
 * derived, so the filter + pagination run over a light id/date pass in memory,
 * and details are fetched for the requested page only. `pageSize: null`
 * returns every matching row (CSV export).
 */
export const listBranchPeriodBookings = async (
  branch: BranchRef,
  period: Pick<IstPeriod, "start" | "end">,
  filters: PeriodBookingFilters,
  paging: { page: number; pageSize: number | null },
): Promise<PeriodBookingsPage> => {
  const light = await prisma.booking.findMany({
    where: listWhere(branch, period, filters),
    select: {
      id: true,
      startAt: true,
      endAt: true,
      rentalPeriodType: true,
      status: true,
      totalFinal: true,
    },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
  });

  const classified = light
    .map((b) => ({ ...b, period: classifyRentalPeriod(b.startAt, b.endAt, b.rentalPeriodType) }))
    .filter((b) => filters.rentalPeriod === "all" || b.period === filters.rentalPeriod);

  const total = classified.length;
  const pageSize = paging.pageSize ?? Math.max(total, 1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = paging.pageSize === null ? 1 : paging.page;
  const slice = classified.slice((page - 1) * pageSize, page * pageSize);

  // Totals across ALL matching rows (not just the page) so the table footer is real.
  const paidAll = await getPaidByBooking(classified.map((b) => b.id));
  let sumTotal = 0;
  let sumPaid = 0;
  let sumBalance = 0;
  for (const b of classified) {
    const t = Number(b.totalFinal);
    const p = paidAll.get(b.id)?.total ?? 0;
    sumTotal += t;
    sumPaid += p;
    if (b.status !== BookingStatus.CANCELLED) sumBalance += Math.max(0, t - p);
  }

  const details = slice.length
    ? await prisma.booking.findMany({
        where: { id: { in: slice.map((b) => b.id) } },
        select: {
          id: true,
          publicId: true,
          status: true,
          startAt: true,
          endAt: true,
          totalFinal: true,
          extensionCount: true,
          createdBy: { select: { role: true, name: true } },
          customer: { select: { user: { select: { name: true, phone: true } } } },
          items: {
            select: { vehicle: { select: { make: true, model: true, regNo: true } } },
            orderBy: { id: "asc" },
          },
        },
      })
    : [];
  const byId = new Map(details.map((d) => [d.id, d]));

  const rows: PeriodBookingRow[] = [];
  for (const s of slice) {
    const d = byId.get(s.id);
    if (!d) continue;
    const vehicles = d.items.map((i) => ({
      make: i.vehicle.make,
      model: i.vehicle.model,
      regNo: i.vehicle.regNo,
    }));
    const src = bookingSource(d.createdBy.role);
    const t = Number(d.totalFinal);
    const p = paidAll.get(d.id)?.total ?? 0;
    rows.push({
      publicId: d.publicId,
      customerName: d.customer.user.name,
      customerPhone: d.customer.user.phone,
      vehicle: vehicles.map((v) => `${v.make} ${v.model}`.trim()).join(", "),
      regNo: vehicles.map((v) => v.regNo).join(", "),
      vehicles,
      startAt: d.startAt.toISOString(),
      endAt: d.endAt.toISOString(),
      rentalPeriod: s.period,
      rentalPeriodLabel: PERIOD_TYPE_LABELS[s.period],
      source: src,
      sourceLabel: BOOKING_SOURCE_LABELS[src],
      counterStaffName: src === "COUNTER" ? d.createdBy.name : null,
      status: d.status,
      statusLabel: DB_STATUS_TO_SPEC[d.status] ?? d.status,
      total: round2(t),
      paid: round2(p),
      balance: d.status === BookingStatus.CANCELLED ? 0 : round2(Math.max(0, t - p)),
      extensionCount: d.extensionCount,
    });
  }

  return {
    rows,
    pagination: { page, pageSize, total, totalPages },
    totals: {
      bookings: total,
      total: round2(sumTotal),
      paid: round2(sumPaid),
      balance: round2(sumBalance),
    },
  };
};
