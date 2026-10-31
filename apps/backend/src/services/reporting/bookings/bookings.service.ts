/**
 * Admin Reports 3.1–3.5 — Booking Summary, Cancellations & No-Shows, Booking Source,
 * Rental Duration & Lead Time, Extensions & Late Returns. Read-only.
 * Definitions (anchors, no-show, revenue lost, lead time, duration, late return):
 * utils/reporting/bookings/definitions.ts.
 */
import { prisma, BookingStatus, ExtensionStatus } from "@repo/database/client";
import {
  enumerateIstBuckets,
  istBucketIndexer,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import {
  CANCELLATION_TYPES,
  CANCELLATION_TYPE_LABELS,
  LEAD_BUCKETS,
  LEAD_BUCKET_LABELS,
  SOURCES,
  SOURCE_LABELS,
  STATUS_BUCKETS,
  STATUS_BUCKET_LABELS,
  actualDurationHours,
  average,
  bookedDurationHours,
  classifyCancellation,
  estimatedRevenueLost,
  isMissedPickup,
  isOverdueNow,
  lateMinutes,
  leadBucket,
  leadTimeHours,
  median,
  pctOf,
  statusBucket,
  type CancellationType,
  type LeadBucket,
  type SourceKey,
  type StatusBucket,
} from "../../../utils/reporting/bookings/definitions.js";
import { getRevenueByBooking, getMoneyByBooking } from "../finance/booking-finance.js";
import { getChargedVsCollectedByBooking } from "../charge-collection.service.js";
import {
  PERIOD_TYPES,
  PERIOD_TYPE_LABELS,
  classifyRentalPeriod,
  type PeriodTypeKey,
} from "../branch-period-report.service.js";
import {
  ACTIVE_STATUSES,
  bookingDisplay,
  deltasOf,
  groupInto,
  loadBookings,
  num,
  periodInfo,
  r2,
  userNames,
  type BookingRow,
  type Range,
} from "./common.js";

const zeroStatus = (): Record<StatusBucket, number> => ({ UPCOMING: 0, ACTIVE: 0, COMPLETED: 0, CANCELLED: 0 });

// ═══ 3.1 Booking Summary ════════════════════════════════════════════════════════

function summarizeStatus(rows: BookingRow[]) {
  const byStatus = zeroStatus();
  for (const b of rows) {
    const s = statusBucket(b.status);
    if (s) byStatus[s] += 1;
  }
  const total = rows.length;
  return {
    total,
    upcoming: byStatus.UPCOMING,
    active: byStatus.ACTIVE,
    completed: byStatus.COMPLETED,
    cancelled: byStatus.CANCELLED,
    cancellationRatePct: pctOf(byStatus.CANCELLED, total),
  };
}

export async function bookingSummaryReport(f: ReportFilters) {
  const rows = await loadBookings(f);
  const summary = summarizeStatus(rows);

  const groupStatus = (keyOf: (b: BookingRow) => string, nameOf: (b: BookingRow) => string) =>
    [
      ...groupInto(
        rows,
        keyOf,
        () => ({ id: "", name: "", total: 0, ...zeroStatus() }),
        (acc, b) => {
          acc.id = keyOf(b);
          acc.name = nameOf(b);
          acc.total += 1;
          const s = statusBucket(b.status);
          if (s) acc[s] += 1;
        },
      ).values(),
    ].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const byBranch = groupStatus((b) => b.branch.publicId, (b) => b.branch.name);
  const byCategory = groupStatus(
    (b) => b.items[0]?.vehicle.category.publicId ?? "none",
    (b) => b.items[0]?.vehicle.category.name ?? "Not recorded",
  );

  const buckets = enumerateIstBuckets(f, f.groupBy);
  const indexOf = istBucketIndexer(f, f.groupBy, buckets);
  const trend = buckets.map((bk) => ({ key: bk.key, label: bk.label, from: bk.from, to: bk.to, total: 0, ...zeroStatus() }));
  for (const b of rows) {
    const i = indexOf(b.startAt);
    const s = statusBucket(b.status);
    if (i >= 0 && s) {
      trend[i]!.total += 1;
      trend[i]![s] += 1;
    }
  }

  let previous: ReturnType<typeof summarizeStatus> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeStatus(await loadBookings(f, { range: f.previous }));
    deltas = deltasOf(summary, previous, ["total", "upcoming", "active", "completed", "cancelled", "cancellationRatePct"]);
  }

  return {
    period: periodInfo(f),
    statusLabels: STATUS_BUCKET_LABELS,
    summary,
    previous,
    deltas,
    byBranch,
    byCategory,
    trend,
    rows: rows.map((b) => ({
      ...bookingDisplay(b),
      status: statusBucket(b.status)!,
      statusLabel: STATUS_BUCKET_LABELS[statusBucket(b.status)!],
      createdAt: b.createdAt,
      startAt: b.startAt,
      endAt: b.endAt,
      returnedAt: b.returnedAt,
      cancelledAt: b.cancelledAt,
      bookingValue: r2(num(b.totalFinal)),
    })),
    notes: [
      "Bookings are counted by their scheduled pickup date (startAt) in the range.",
      "Upcoming = confirmed and not picked up yet (a missed pickup stays Upcoming until it is cancelled). Unpaid holds and failed online checkouts are not bookings.",
      "Category = the category of the booking's (first) vehicle.",
    ],
  };
}

export type BookingSummaryReport = Awaited<ReturnType<typeof bookingSummaryReport>>;

// ═══ 3.2 Cancellations & No-Shows ═══════════════════════════════════════════════

const NO_SHOW_AUDIT_ACTION = "CANCEL_BOOKING_NO_SHOW";

async function noShowAuditIds(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await prisma.auditLog.findMany({
    where: { action: NO_SHOW_AUDIT_ACTION, entity: "Booking", entityId: { in: ids.map(String) } },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => Number(r.entityId)));
}

interface CancelFacts {
  all: BookingRow[];
  cancelled: BookingRow[];
  missed: BookingRow[];
  types: Map<number, CancellationType>;
  money: Awaited<ReturnType<typeof getMoneyByBooking>>;
}

async function cancelFacts(f: ReportFilters, range: Range | undefined, now: Date): Promise<CancelFacts> {
  const all = await loadBookings(f, { range });
  const cancelled = all.filter((b) => b.status === BookingStatus.CANCELLED);
  const missed = all.filter((b) => isMissedPickup(b, now));
  const audit = await noShowAuditIds(cancelled.map((b) => b.id));
  const types = new Map<number, CancellationType>(
    cancelled.map((b) => [
      b.id,
      classifyCancellation({
        cancellationSource: b.cancellationSource,
        cancellationReason: b.cancellationReason,
        displacedByExtensionId: b.displacedByExtensionId,
        noShowAudit: audit.has(b.id),
      }),
    ]),
  );
  const money = await getMoneyByBooking(cancelled.map((b) => b.id));
  return { all, cancelled, missed, types, money };
}

function lostOf(b: BookingRow, money: CancelFacts["money"]) {
  const m = money.get(b.id);
  return estimatedRevenueLost({
    totalFinal: num(b.totalFinal),
    totalDeposit: num(b.totalDeposit),
    moneyIn: m ? num(m.confirmed) + num(m.pending) : 0,
    refundedOut: m ? num(m.refundedOut) : 0,
  });
}

function summarizeCancellations(x: CancelFacts) {
  const byType = Object.fromEntries(CANCELLATION_TYPES.map((t) => [t, 0])) as Record<CancellationType, number>;
  let lost = 0;
  let bookedRent = 0;
  let kept = 0;
  let refunded = 0;
  let noShowLost = 0;
  for (const b of x.cancelled) {
    const t = x.types.get(b.id)!;
    byType[t] += 1;
    const l = lostOf(b, x.money);
    lost += l.lost;
    bookedRent += l.bookedRent;
    kept += l.rentKept;
    refunded += num(x.money.get(b.id)?.refundedOut);
    if (t === "NO_SHOW") noShowLost += l.lost;
  }
  return {
    bookings: x.all.length,
    cancellations: x.cancelled.length,
    noShows: byType.NO_SHOW,
    otherCancellations: x.cancelled.length - byType.NO_SHOW,
    cancellationRatePct: pctOf(x.cancelled.length, x.all.length),
    noShowRatePct: pctOf(byType.NO_SHOW, x.all.length),
    missedPickups: x.missed.length,
    bookedRent: r2(bookedRent),
    rentKept: r2(kept),
    refundedOut: r2(refunded),
    revenueLost: r2(lost),
    noShowRevenueLost: r2(noShowLost),
    byType,
  };
}

export async function cancellationsReport(f: ReportFilters, now = new Date()) {
  const cur = await cancelFacts(f, undefined, now);
  const summary = summarizeCancellations(cur);
  const cancellers = await userNames(cur.cancelled.map((b) => b.cancelledById));

  const reasons = groupInto(
    cur.cancelled,
    (b) => (b.cancellationReason?.trim() ? b.cancellationReason.trim().replace(/\s+/g, " ") : "Not recorded"),
    () => ({ reason: "", count: 0, revenueLost: 0 }),
    (acc, b) => {
      acc.reason = b.cancellationReason?.trim() ? b.cancellationReason.trim().replace(/\s+/g, " ") : "Not recorded";
      acc.count += 1;
      acc.revenueLost = r2(acc.revenueLost + lostOf(b, cur.money).lost);
    },
  );
  const byReason = [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const byBranch = [
    ...groupInto(
      cur.all,
      (b) => b.branch.publicId,
      () => ({ id: "", name: "", bookings: 0, cancellations: 0, noShows: 0, revenueLost: 0 }),
      (acc, b) => {
        acc.id = b.branch.publicId;
        acc.name = b.branch.name;
        acc.bookings += 1;
        if (b.status === BookingStatus.CANCELLED) {
          acc.cancellations += 1;
          if (cur.types.get(b.id) === "NO_SHOW") acc.noShows += 1;
          acc.revenueLost = r2(acc.revenueLost + lostOf(b, cur.money).lost);
        }
      },
    ).values(),
  ].sort((a, b) => b.cancellations - a.cancellations || a.name.localeCompare(b.name));

  const rows = [
    ...cur.cancelled.map((b) => {
      const t = cur.types.get(b.id)!;
      const l = lostOf(b, cur.money);
      const m = cur.money.get(b.id);
      return {
        ...bookingDisplay(b),
        kind: "CANCELLED" as const,
        type: t,
        typeLabel: CANCELLATION_TYPE_LABELS[t],
        reason: b.cancellationReason?.trim() || null,
        cancelledBy: b.cancelledById != null ? (cancellers.get(b.cancelledById)?.name ?? null) : null,
        createdAt: b.createdAt,
        startAt: b.startAt,
        cancelledAt: b.cancelledAt,
        bookingValue: r2(num(b.totalFinal)),
        bookedRent: l.bookedRent,
        moneyIn: r2(m ? num(m.confirmed) + num(m.pending) : 0),
        refundedOut: r2(num(m?.refundedOut)),
        rentKept: l.rentKept,
        revenueLost: l.lost,
      };
    }),
    ...cur.missed.map((b) => ({
      ...bookingDisplay(b),
      kind: "MISSED_PICKUP" as const,
      type: null,
      typeLabel: "Missed pickup (not cancelled yet)",
      reason: null,
      cancelledBy: null,
      createdAt: b.createdAt,
      startAt: b.startAt,
      cancelledAt: null,
      bookingValue: r2(num(b.totalFinal)),
      bookedRent: r2(num(b.totalFinal) - num(b.totalDeposit)),
      moneyIn: null,
      refundedOut: null,
      rentKept: null,
      revenueLost: null,
    })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  let previous: ReturnType<typeof summarizeCancellations> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeCancellations(await cancelFacts(f, f.previous, now));
    deltas = deltasOf(summary, previous, [
      "cancellations",
      "noShows",
      "cancellationRatePct",
      "noShowRatePct",
      "revenueLost",
      "refundedOut",
    ]);
  }

  return {
    period: periodInfo(f),
    typeLabels: CANCELLATION_TYPE_LABELS,
    summary,
    previous,
    deltas,
    byReason,
    byBranch,
    rows,
    notes: [
      "Cancellations are bookings scheduled (startAt) in the range that are now cancelled; Cancelled At shows when.",
      "No-show = cancelled through the no-show path (the daily auto-cancel 24 h after the pickup time, or the manager's Cancel No-Show) or with a no-show reason.",
      "Missed pickup = still confirmed 24 h after its pickup time and not cancelled yet; listed, but not counted as a no-show or as lost revenue.",
      "Estimated revenue lost = booked rent (total − deposit, GST-inclusive) − rent kept, where rent kept = money received − refunds paid out, capped at the rent. A deposit that was paid and never refunded counts as kept.",
      "Who cancelled is recorded only for manager cancels (Oct 2026 onwards); older rows show Not recorded.",
    ],
  };
}

export type CancellationsReport = Awaited<ReturnType<typeof cancellationsReport>>;

// ═══ 3.3 Booking Source ═════════════════════════════════════════════════════════

async function sourceFacts(f: ReportFilters, range?: Range) {
  const all = await loadBookings(f, { range });
  const active = all.filter((b) => (ACTIVE_STATUSES as string[]).includes(b.status));
  const revenue = await getRevenueByBooking(active.map((b) => b.id));
  return { all, active, revenue };
}

function summarizeSource(x: Awaited<ReturnType<typeof sourceFacts>>) {
  const by = Object.fromEntries(
    SOURCES.map((s) => [s, { bookings: 0, cancelled: 0, revenue: 0, bookingValue: 0 }]),
  ) as Record<SourceKey, { bookings: number; cancelled: number; revenue: number; bookingValue: number }>;
  for (const b of x.all) {
    const s = bookingDisplay(b).source;
    if (b.status === BookingStatus.CANCELLED) by[s].cancelled += 1;
    else {
      by[s].bookings += 1;
      const rv = x.revenue.get(b.id);
      by[s].revenue = r2(by[s].revenue + (rv?.revenue ?? 0));
      by[s].bookingValue = r2(by[s].bookingValue + num(b.totalFinal));
    }
  }
  const totalBookings = by.APP.bookings + by.WALK_IN.bookings;
  const totalRevenue = r2(by.APP.revenue + by.WALK_IN.revenue);
  return {
    totalBookings,
    totalRevenue,
    appBookings: by.APP.bookings,
    walkInBookings: by.WALK_IN.bookings,
    appRevenue: by.APP.revenue,
    walkInRevenue: by.WALK_IN.revenue,
    appSharePct: pctOf(by.APP.bookings, totalBookings),
    walkInSharePct: pctOf(by.WALK_IN.bookings, totalBookings),
    sources: SOURCES.map((s) => ({
      source: s,
      label: SOURCE_LABELS[s],
      bookings: by[s].bookings,
      cancelled: by[s].cancelled,
      revenue: by[s].revenue,
      bookingValue: by[s].bookingValue,
      avgRevenue: by[s].bookings ? r2(by[s].revenue / by[s].bookings) : null,
      bookingSharePct: pctOf(by[s].bookings, totalBookings),
      revenueSharePct: pctOf(by[s].revenue, totalRevenue),
    })),
  };
}

export async function bookingSourceReport(f: ReportFilters) {
  const cur = await sourceFacts(f);
  const summary = summarizeSource(cur);

  const byBranch = [
    ...groupInto(
      cur.active,
      (b) => b.branch.publicId,
      () => ({ id: "", name: "", appBookings: 0, walkInBookings: 0, appRevenue: 0, walkInRevenue: 0 }),
      (acc, b) => {
        acc.id = b.branch.publicId;
        acc.name = b.branch.name;
        const rv = cur.revenue.get(b.id)?.revenue ?? 0;
        if (bookingDisplay(b).source === "APP") {
          acc.appBookings += 1;
          acc.appRevenue = r2(acc.appRevenue + rv);
        } else {
          acc.walkInBookings += 1;
          acc.walkInRevenue = r2(acc.walkInRevenue + rv);
        }
      },
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  let previous: ReturnType<typeof summarizeSource> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeSource(await sourceFacts(f, f.previous));
    deltas = deltasOf(summary, previous, [
      "totalBookings",
      "totalRevenue",
      "appBookings",
      "walkInBookings",
      "appRevenue",
      "walkInRevenue",
      "appSharePct",
    ]);
  }

  return {
    period: periodInfo(f),
    sourceLabels: SOURCE_LABELS,
    summary,
    previous,
    deltas,
    byBranch,
    rows: cur.all.map((b) => {
      const rv = cur.revenue.get(b.id);
      const d = bookingDisplay(b);
      return {
        ...d,
        sourceLabel: SOURCE_LABELS[d.source],
        status: statusBucket(b.status)!,
        statusLabel: STATUS_BUCKET_LABELS[statusBucket(b.status)!],
        createdAt: b.createdAt,
        startAt: b.startAt,
        bookingValue: r2(num(b.totalFinal)),
        revenue: b.status === BookingStatus.CANCELLED ? 0 : (rv?.revenue ?? 0),
      };
    }),
    notes: [
      "App / online = booked by the customer in the app or website; Walk-in = created at the counter by staff, a manager or an admin.",
      "Revenue = Finance's booking revenue (rent excl. deposit + drop charges − goodwill refunds) of confirmed, active and completed bookings; cancelled bookings carry none.",
      "Bookings are counted by scheduled pickup date (startAt); cancelled bookings are shown separately.",
    ],
  };
}

export type BookingSourceReport = Awaited<ReturnType<typeof bookingSourceReport>>;

// ═══ 3.4 Rental Duration & Lead Time ═══════════════════════════════════════════

function durationRow(b: BookingRow) {
  const booked = bookedDurationHours(b.startAt, b.endAt);
  const actual = actualDurationHours(b);
  const lead = leadTimeHours(b.createdAt, b.startAt);
  const period: PeriodTypeKey = classifyRentalPeriod(b.startAt, b.endAt, b.rentalPeriodType);
  return { booked, actual, lead, leadBucket: leadBucket(lead), period };
}

function summarizeDuration(rows: BookingRow[]) {
  const facts = rows.map(durationRow);
  const booked = facts.map((x) => x.booked);
  const actual = facts.map((x) => x.actual).filter((x): x is number => x != null);
  const lead = facts.map((x) => x.lead);
  const leadDist = Object.fromEntries(LEAD_BUCKETS.map((k) => [k, 0])) as Record<LeadBucket, number>;
  const periodDist = Object.fromEntries(PERIOD_TYPES.map((k) => [k, 0])) as Record<PeriodTypeKey, number>;
  for (const x of facts) {
    leadDist[x.leadBucket] += 1;
    periodDist[x.period] += 1;
  }
  const avgBookedHours = average(booked);
  const avgActualHours = average(actual);
  const avgLeadHours = average(lead);
  return {
    bookings: rows.length,
    avgBookedHours,
    avgBookedDays: avgBookedHours == null ? null : r2(avgBookedHours / 24),
    medianBookedHours: median(booked),
    completedWithReturn: actual.length,
    avgActualHours,
    avgActualDays: avgActualHours == null ? null : r2(avgActualHours / 24),
    avgLeadHours,
    avgLeadDays: avgLeadHours == null ? null : r2(avgLeadHours / 24),
    medianLeadHours: median(lead),
    leadDistribution: LEAD_BUCKETS.map((k) => ({ key: k, label: LEAD_BUCKET_LABELS[k], count: leadDist[k], pct: pctOf(leadDist[k], rows.length) })),
    periodDistribution: PERIOD_TYPES.map((k) => ({ key: k, label: PERIOD_TYPE_LABELS[k], count: periodDist[k], pct: pctOf(periodDist[k], rows.length) })),
  };
}

export async function durationLeadTimeReport(f: ReportFilters) {
  const rows = await loadBookings(f, { statuses: ACTIVE_STATUSES });
  const summary = summarizeDuration(rows);

  const groupDur = (keyOf: (b: BookingRow) => string, nameOf: (b: BookingRow) => string) =>
    [
      ...groupInto(
        rows,
        keyOf,
        () => ({ id: "", name: "", list: [] as BookingRow[] }),
        (acc, b) => {
          acc.id = keyOf(b);
          acc.name = nameOf(b);
          acc.list.push(b);
        },
      ).values(),
    ]
      .map((g) => {
        const s = summarizeDuration(g.list);
        return {
          id: g.id,
          name: g.name,
          bookings: s.bookings,
          avgBookedHours: s.avgBookedHours,
          avgActualHours: s.avgActualHours,
          avgLeadHours: s.avgLeadHours,
          medianLeadHours: s.medianLeadHours,
        };
      })
      .sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name));

  let previous: ReturnType<typeof summarizeDuration> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeDuration(await loadBookings(f, { statuses: ACTIVE_STATUSES, range: f.previous }));
    deltas = deltasOf(summary, previous, ["bookings", "avgBookedHours", "avgActualHours", "avgLeadHours", "medianLeadHours"]);
  }

  return {
    period: periodInfo(f),
    summary,
    previous,
    deltas,
    byCategory: groupDur(
      (b) => b.items[0]?.vehicle.category.publicId ?? "none",
      (b) => b.items[0]?.vehicle.category.name ?? "Not recorded",
    ),
    byBranch: groupDur((b) => b.branch.publicId, (b) => b.branch.name),
    rows: rows.map((b) => {
      const x = durationRow(b);
      return {
        ...bookingDisplay(b),
        status: statusBucket(b.status)!,
        statusLabel: STATUS_BUCKET_LABELS[statusBucket(b.status)!],
        createdAt: b.createdAt,
        startAt: b.startAt,
        endAt: b.endAt,
        returnedAt: b.returnedAt,
        bookedHours: x.booked,
        actualHours: x.actual,
        leadHours: x.lead,
        leadBucket: x.leadBucket,
        leadBucketLabel: LEAD_BUCKET_LABELS[x.leadBucket],
        periodType: x.period,
        periodTypeLabel: PERIOD_TYPE_LABELS[x.period],
      };
    }),
    notes: [
      "Lead time = booking created → scheduled pickup (startAt); a walk-in created at pickup time is 0.",
      "Booked duration = scheduled pickup → scheduled return (endAt, including confirmed extensions). Actual duration = pickup time → recorded return, for completed bookings only.",
      "Cancelled bookings are left out. Bookings are selected by scheduled pickup date (startAt).",
    ],
  };
}

export type DurationLeadTimeReport = Awaited<ReturnType<typeof durationLeadTimeReport>>;

// ═══ 3.5 Extensions & Late Returns ═════════════════════════════════════════════

async function extensionFacts(f: ReportFilters, range: Range | undefined) {
  const rows = await loadBookings(f, { statuses: ACTIVE_STATUSES, range });
  const ids = rows.map((b) => b.id);
  const [exts, fees] = await Promise.all([
    ids.length
      ? prisma.bookingExtension.findMany({
          where: { bookingId: { in: ids }, extensionStatus: ExtensionStatus.CONFIRMED },
          select: { bookingId: true, oldEndAt: true, requestedEndAt: true, actualNewEndAt: true, additionalAmount: true },
        })
      : Promise.resolve([]),
    getChargedVsCollectedByBooking(ids, ["LATE_FEE"]),
  ]);
  const extBy = groupInto(
    exts,
    (e) => e.bookingId,
    () => ({ count: 0, amount: 0, hours: 0 }),
    (acc, e) => {
      acc.count += 1;
      acc.amount = r2(acc.amount + num(e.additionalAmount));
      const newEnd = e.actualNewEndAt ?? e.requestedEndAt;
      acc.hours = r2(acc.hours + Math.max(0, (newEnd.getTime() - e.oldEndAt.getTime()) / 3_600_000));
    },
  );
  return { rows, extBy, fees };
}

function summarizeExtensions(x: Awaited<ReturnType<typeof extensionFacts>>, now: Date) {
  let extended = 0;
  let extensions = 0;
  let extAmount = 0;
  let extHours = 0;
  let completed = 0;
  let late = 0;
  const lateMins: number[] = [];
  let lateNotCharged = 0;
  let charged = 0;
  let collected = 0;
  let fromDeposit = 0;
  let overdue = 0;
  for (const b of x.rows) {
    const e = x.extBy.get(b.id);
    if (e) {
      extended += 1;
      extensions += e.count;
      extAmount += e.amount;
      extHours += e.hours;
    }
    if (b.status === BookingStatus.RETURNED) completed += 1;
    const m = lateMinutes(b);
    const fee = x.fees.get(b.id)?.LATE_FEE;
    if (m > 0) {
      late += 1;
      lateMins.push(m);
      if (!fee || fee.charged <= 0) lateNotCharged += 1;
    }
    if (fee) {
      charged += fee.charged;
      collected += fee.collected;
      fromDeposit += fee.fromDeposit;
    }
    if (isOverdueNow(b, now)) overdue += 1;
  }
  return {
    bookings: x.rows.length,
    extendedBookings: extended,
    extensions,
    extensionAmount: r2(extAmount),
    extensionHours: r2(extHours),
    extendedRatePct: pctOf(extended, x.rows.length),
    completedBookings: completed,
    lateReturns: late,
    lateRatePct: pctOf(late, completed),
    avgLateMinutes: average(lateMins),
    lateReturnsNotCharged: lateNotCharged,
    lateFeeCharged: r2(charged),
    lateFeeCollected: r2(collected),
    lateFeeFromDeposit: r2(fromDeposit),
    lateFeeDifference: r2(charged - collected),
    overdueNow: overdue,
  };
}

export async function extensionsLateReport(f: ReportFilters, now = new Date()) {
  const cur = await extensionFacts(f, undefined);
  const summary = summarizeExtensions(cur, now);

  let previous: ReturnType<typeof summarizeExtensions> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeExtensions(await extensionFacts(f, f.previous), now);
    deltas = deltasOf(summary, previous, [
      "extendedBookings",
      "extensions",
      "extensionAmount",
      "lateReturns",
      "lateRatePct",
      "lateFeeCharged",
      "lateFeeCollected",
      "lateFeeDifference",
    ]);
  }

  const rows = cur.rows
    .map((b) => {
      const e = cur.extBy.get(b.id);
      const fee = cur.fees.get(b.id)?.LATE_FEE;
      const mins = lateMinutes(b);
      const overdue = isOverdueNow(b, now);
      return {
        ...bookingDisplay(b),
        status: statusBucket(b.status)!,
        statusLabel: STATUS_BUCKET_LABELS[statusBucket(b.status)!],
        startAt: b.startAt,
        originalEndAt: b.originalEndAt ?? b.endAt,
        endAt: b.endAt,
        returnedAt: b.returnedAt,
        extensions: e?.count ?? 0,
        extensionAmount: e?.amount ?? 0,
        extensionHours: e?.hours ?? 0,
        lateMinutes: mins,
        isLate: mins > 0,
        overdueNow: overdue,
        overdueMinutes: overdue ? Math.round((now.getTime() - b.endAt.getTime()) / 60000) : 0,
        lateFeeCharged: fee?.charged ?? 0,
        lateFeeCollected: fee?.collected ?? 0,
        lateFeeFromDeposit: fee?.fromDeposit ?? 0,
        lateFeeDifference: r2((fee?.charged ?? 0) - (fee?.collected ?? 0)),
      };
    })
    .filter((r) => r.extensions > 0 || r.isLate || r.overdueNow || r.lateFeeCharged !== 0 || r.lateFeeCollected !== 0);

  return {
    period: periodInfo(f),
    summary,
    previous,
    deltas,
    rows,
    notes: [
      "Bookings are selected by scheduled pickup date (startAt); cancelled bookings are left out.",
      "Late return = returned after the scheduled return (endAt, which includes confirmed extensions). A late return can carry no fee (within grace, under one hour, waived, or no extra-hour rate) — see 'Late, no fee'.",
      "Late fee charged = the drop bill's late-return lines (incl. later drop edits; legacy return charges for older drops).",
      "Late fee collected = payments split over the bill lines exactly as the Branch Manager Financials view does, plus the share of the safety deposit set off on the drop bill. Deposit set-off on legacy (pre-Oct 2026) drops is not attributed to a line, so it is not counted.",
      "Overdue now = picked up and past the scheduled return, not dropped yet (as of now).",
    ],
  };
}

export type ExtensionsLateReport = Awaited<ReturnType<typeof extensionsLateReport>>;
