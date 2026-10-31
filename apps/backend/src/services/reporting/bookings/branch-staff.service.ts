/**
 * Admin Reports 8.1 Branch Comparison and 8.2 Staff Activity. Read-only.
 *
 * 8.1 per branch, same period: bookings (startAt anchor, confirmed / active / completed),
 *     cancellations, revenue (Finance booking revenue), collected (rental payments received
 *     in the period at that branch — payment date anchor, deposits and refunds excluded),
 *     outstanding dues of the period's bookings (Finance, as of now) and utilization
 *     (Fleet computeUtilization). The branch filter is ignored (it is a comparison);
 *     category / vehicle filters apply. With one branch the page shows a single card.
 *
 * 8.2 per staff member (users who are not customers), each action on the day it happened:
 *     bookings handled  = bookings they created (createdById), by createdAt; failed online
 *                         checkouts and unpaid holds excluded
 *     payments / cash   = PaymentTransaction rows they collected (collectedById), COLLECTED or
 *                         CONFIRMED, by collectedAt (else createdAt): rent, extension, damage,
 *                         drop and deposit money; the cash part separately
 *     refunds paid      = refund rows they recorded (OVERPAYMENT_REFUND / CANCELLATION_REFUND)
 *     handovers         = pickups / drops they performed (see definitions.ts: settled bill,
 *                         legacy activity entry, approval request, manager confirm, readings);
 *                         pickups by the handover time, drops by returnedAt
 *     Branch = the booking's / payment's branch. Online gateway payments have no collector.
 */
import { prisma, Prisma, BookingStatus, type PaymentPurpose, LedgerEntryClassification, PaymentSessionStatus, PaymentSessionType, Role, StaffActionType, StaffEntityType } from "@repo/database/client";
import {
  COLLECTED_PAYMENT_STATUSES,
  REVENUE_PAYMENT_PURPOSES,
  bookingScopeFromFilters,
  paymentWhereFromFilters,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import { pickHandoverPerformer, pctOf, type HandoverMarker } from "../../../utils/reporting/bookings/definitions.js";
import { activityMarkerKind } from "../../../utils/booking/completedQueue.js";
import { REFUND_PAYMENT_PURPOSES } from "../../payment/booking-owed.service.js";
import { COLLECTED_PURPOSES } from "../../financials/payment-type.js";
import { getDuesByBooking, getRevenueByBooking } from "../finance/booking-finance.js";
import { computeUtilization } from "../fleet/fleet.service.js";
import {
  ACTIVE_STATUSES,
  LISTED_STATUSES,
  NOT_FAILED_CHECKOUT,
  deltasOf,
  loadBookings,
  num,
  periodInfo,
  r2,
  type Range,
} from "./common.js";

// ═══ 8.1 Branch Comparison ══════════════════════════════════════════════════════

interface BranchFigures {
  bookings: number;
  cancellations: number;
  revenue: number;
  avgRevenuePerBooking: number | null;
  collected: number;
  due: number;
  utilizationPct: number | null;
  rentedDays: number;
  availableDays: number;
  vehicles: number;
}

async function branchFigures(f: ReportFilters, range: Range): Promise<{ by: Map<string, BranchFigures>; utilNotes: string[] }> {
  const scope = { ...f, branchPublicId: null };
  const all = await loadBookings(scope, { range });
  const active = all.filter((b) => (ACTIVE_STATUSES as string[]).includes(b.status));
  const ids = active.map((b) => b.id);
  const [revenue, dues, util, collected] = await Promise.all([
    getRevenueByBooking(ids),
    getDuesByBooking(ids),
    computeUtilization({ from: range.start, to: range.end, categoryPublicIds: f.categoryPublicIds, vehiclePublicId: f.vehiclePublicId }),
    prisma.paymentTransaction.groupBy({
      by: ["branchId"],
      where: {
        AND: [
          paymentWhereFromFilters(scope, range),
          { status: { in: COLLECTED_PAYMENT_STATUSES }, purpose: { in: REVENUE_PAYMENT_PURPOSES } },
        ],
      },
      _sum: { totalAmount: true },
    }),
  ]);
  const branchIdToPublic = new Map(
    (await prisma.branch.findMany({ select: { id: true, publicId: true } })).map((b) => [b.id, b.publicId]),
  );
  const by = new Map<string, BranchFigures>();
  const get = (id: string) => {
    let x = by.get(id);
    if (!x) {
      x = { bookings: 0, cancellations: 0, revenue: 0, avgRevenuePerBooking: null, collected: 0, due: 0, utilizationPct: null, rentedDays: 0, availableDays: 0, vehicles: 0 };
      by.set(id, x);
    }
    return x;
  };
  for (const b of all) {
    const x = get(b.branch.publicId);
    if (b.status === BookingStatus.CANCELLED) {
      x.cancellations += 1;
      continue;
    }
    x.bookings += 1;
    x.revenue = r2(x.revenue + (revenue.get(b.id)?.revenue ?? 0));
    const d = dues.get(b.id);
    if (d?.counted) x.due = r2(x.due + d.due);
  }
  for (const c of collected) {
    const pid = branchIdToPublic.get(c.branchId);
    if (pid) get(pid).collected = r2(num(c._sum.totalAmount));
  }
  for (const u of util.byBranch) {
    if (!u.publicId) continue;
    const x = get(u.publicId);
    x.utilizationPct = u.utilizationPct;
    x.rentedDays = u.rentedDays;
    x.availableDays = u.availableDays;
    x.vehicles = u.vehicles;
  }
  for (const x of by.values()) x.avgRevenuePerBooking = x.bookings ? r2(x.revenue / x.bookings) : null;
  return { by, utilNotes: util.notes };
}

export async function branchComparisonReport(f: ReportFilters) {
  const branches = await prisma.branch.findMany({
    where: { deletedAt: null },
    select: { publicId: true, name: true },
    orderBy: { name: "asc" },
  });
  const cur = await branchFigures(f, f);
  const prev = f.compare ? await branchFigures(f, f.previous) : null;
  const empty = (): BranchFigures => ({ bookings: 0, cancellations: 0, revenue: 0, avgRevenuePerBooking: null, collected: 0, due: 0, utilizationPct: null, rentedDays: 0, availableDays: 0, vehicles: 0 });
  const keys: (keyof BranchFigures)[] = ["bookings", "cancellations", "revenue", "collected", "due", "utilizationPct"];

  const rows = branches.map((b) => {
    const c = cur.by.get(b.publicId) ?? empty();
    const p = prev ? (prev.by.get(b.publicId) ?? empty()) : null;
    return {
      branchId: b.publicId,
      branchName: b.name,
      ...c,
      previous: p,
      deltas: p ? deltasOf(c as unknown as Record<string, unknown>, p as unknown as Record<string, unknown>, keys as string[]) : null,
    };
  });
  const totalsOf = (list: BranchFigures[]) => {
    const rented = list.reduce((s, x) => s + x.rentedDays, 0);
    const avail = list.reduce((s, x) => s + x.availableDays, 0);
    const bookings = list.reduce((s, x) => s + x.bookings, 0);
    const revenue = r2(list.reduce((s, x) => s + x.revenue, 0));
    return {
      bookings,
      cancellations: list.reduce((s, x) => s + x.cancellations, 0),
      revenue,
      avgRevenuePerBooking: bookings ? r2(revenue / bookings) : null,
      collected: r2(list.reduce((s, x) => s + x.collected, 0)),
      due: r2(list.reduce((s, x) => s + x.due, 0)),
      utilizationPct: pctOf(rented, avail),
      rentedDays: r2(rented),
      availableDays: r2(avail),
      vehicles: list.reduce((s, x) => s + x.vehicles, 0),
    };
  };
  const summary = totalsOf(rows);
  const previous = prev ? totalsOf(rows.map((r) => r.previous!)) : null;

  return {
    period: periodInfo(f),
    branchCount: branches.length,
    singleBranch: branches.length <= 1,
    summary,
    previous,
    deltas: previous ? deltasOf(summary, previous, keys) : null,
    rows,
    notes: [
      ...(branches.length <= 1 ? ["There is only one branch, so there is nothing to compare: the figures below are that branch's."] : []),
      "Bookings, revenue and dues use bookings scheduled (startAt) in the period; collected uses payments received in the period at the branch (rent, extensions, drop and damage money; deposits and refunds excluded).",
      "Dues = what the period's bookings still owe as of now. Utilization = rented days ÷ available days (Fleet 4.1).",
      "The branch filter is ignored here; category and vehicle filters apply.",
      ...cur.utilNotes,
    ],
  };
}

export type BranchComparisonReport = Awaited<ReturnType<typeof branchComparisonReport>>;

// ═══ 8.2 Staff Activity ══════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;

type ActivityKind = "BOOKING_CREATED" | "PAYMENT_COLLECTED" | "REFUND_PAID" | "PICKUP" | "DROP";
export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  BOOKING_CREATED: "Booking created",
  PAYMENT_COLLECTED: "Payment collected",
  REFUND_PAID: "Refund paid",
  PICKUP: "Pickup handed over",
  DROP: "Drop completed",
};

export interface ActivityRow {
  kind: ActivityKind;
  kindLabel: string;
  at: Date;
  staffUserId: number;
  staffId: string;
  staffName: string;
  staffRole: string;
  branchId: string;
  branchName: string;
  bookingId: string;
  customerName: string;
  amount: number | null;
  cash: number | null;
  online: number | null;
  detail: string | null;
}

const bookingRef = {
  publicId: true,
  branch: { select: { publicId: true, name: true } },
  customer: { select: { user: { select: { name: true } } } },
} satisfies Prisma.BookingSelect;

/** Who performed each booking's pickup / drop, and when (user ids). */
async function handoverPerformers(
  phase: "PICKUP" | "RETURN",
  bookings: Array<{
    id: number;
    publicId: string;
    startAt: Date;
    returnedAt: Date | null;
    licenseCollectedAt: Date | null;
    licenseCollectedById: number | null;
    licenseReturnedAt: Date | null;
    licenseReturnedById: number | null;
    fuelRecord: { pickupAt: Date; returnAt: Date | null; capturedByPickupId: number; capturedByReturnId: number | null } | null;
  }>,
): Promise<Map<number, { userId: number | null; at: Date | null }>> {
  const out = new Map<number, { userId: number | null; at: Date | null }>();
  if (!bookings.length) return out;
  const ids = bookings.map((b) => b.id);
  const since = new Date(bookings.reduce((m, b) => Math.min(m, b.startAt.getTime()), Infinity) - 2 * DAY_MS);
  const [sessions, activity] = await Promise.all([
    prisma.paymentSession.findMany({
      where: {
        bookingId: { in: ids },
        sessionType: phase === "PICKUP" ? PaymentSessionType.PICKUP : PaymentSessionType.RETURN,
        status: PaymentSessionStatus.COMPLETED,
      },
      select: { id: true, bookingId: true, completedAt: true, updatedAt: true, actorId: true },
    }),
    prisma.staffActivityLog.findMany({
      where: {
        entityType: StaffEntityType.BOOKING,
        entityRef: { in: bookings.map((b) => b.publicId) },
        actionType: { in: [StaffActionType.CONFIRMED, StaffActionType.COMPLETED, StaffActionType.INITIATED] },
        createdAt: { gte: since },
      },
      select: { entityRef: true, actionType: true, description: true, actorPublicId: true, createdAt: true },
    }),
  ]);
  const payers = sessions.length
    ? await prisma.ledgerEntry.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, classification: LedgerEntryClassification.PAYMENT, isVoided: false },
        orderBy: { createdAt: "desc" },
        select: { sessionId: true, actorId: true },
      })
    : [];
  const settledBy = new Map<number, number>();
  for (const p of payers) if (!settledBy.has(p.sessionId)) settledBy.set(p.sessionId, p.actorId);
  const actorIds = new Map(
    (
      await prisma.user.findMany({
        where: { publicId: { in: [...new Set(activity.map((a) => a.actorPublicId))] } },
        select: { id: true, publicId: true },
      })
    ).map((u) => [u.publicId, u.id]),
  );

  // Grouped once (was a full scan of sessions + activity per booking: O(n²) on big ranges)
  const sessionsBy = new Map<number, typeof sessions>();
  for (const s of sessions) {
    if (s.bookingId == null) continue;
    const l = sessionsBy.get(s.bookingId);
    if (l) l.push(s);
    else sessionsBy.set(s.bookingId, [s]);
  }
  const activityBy = new Map<string, typeof activity>();
  for (const a of activity) {
    if (a.entityRef == null) continue;
    const l = activityBy.get(a.entityRef);
    if (l) l.push(a);
    else activityBy.set(a.entityRef, [a]);
  }

  for (const b of bookings) {
    const markers: HandoverMarker[] = [];
    for (const s of sessionsBy.get(b.id) ?? []) {
      markers.push({ kind: "SESSION", at: s.completedAt ?? s.updatedAt, userId: settledBy.get(s.id) ?? s.actorId });
    }
    for (const a of activityBy.get(b.publicId) ?? []) {
      const kind = activityMarkerKind(phase, a);
      if (kind && kind !== "SESSION" && kind !== "RECORDED") markers.push({ kind, at: a.createdAt, userId: actorIds.get(a.actorPublicId) ?? null });
    }
    const fuel = b.fuelRecord;
    if (phase === "PICKUP") {
      if (fuel) markers.push({ kind: "RECORDED", at: fuel.pickupAt, userId: fuel.capturedByPickupId });
      if (b.licenseCollectedAt) markers.push({ kind: "RECORDED", at: b.licenseCollectedAt, userId: b.licenseCollectedById });
    } else {
      if (fuel?.returnAt) markers.push({ kind: "RECORDED", at: fuel.returnAt, userId: fuel.capturedByReturnId });
      if (b.licenseReturnedAt) markers.push({ kind: "RECORDED", at: b.licenseReturnedAt, userId: b.licenseReturnedById });
    }
    out.set(b.id, pickHandoverPerformer(markers));
  }
  return out;
}

const handoverSelect = {
  id: true,
  startAt: true,
  returnedAt: true,
  licenseCollectedAt: true,
  licenseCollectedById: true,
  licenseReturnedAt: true,
  licenseReturnedById: true,
  fuelRecord: { select: { pickupAt: true, returnAt: true, capturedByPickupId: true, capturedByReturnId: true } },
  ...bookingRef,
} satisfies Prisma.BookingSelect;

async function staffActivityRows(f: ReportFilters, range: Range, staffUserId: number | null): Promise<{ rows: ActivityRow[]; unattributedHandovers: number }> {
  const scope = bookingScopeFromFilters(f);
  const byStaff = staffUserId != null;

  const [created, payments, pickupCands, drops] = await Promise.all([
    prisma.booking.findMany({
      where: {
        AND: [
          scope,
          NOT_FAILED_CHECKOUT,
          { status: { in: LISTED_STATUSES }, createdAt: { gte: range.start, lte: range.end }, createdBy: { role: { not: Role.CUSTOMER } } },
          ...(byStaff ? [{ createdById: staffUserId }] : []),
        ],
      },
      select: { createdAt: true, createdById: true, totalFinal: true, status: true, ...bookingRef },
    }),
    prisma.paymentTransaction.findMany({
      where: {
        AND: [
          paymentWhereFromFilters(f, range),
          {
            status: { in: COLLECTED_PAYMENT_STATUSES },
            purpose: { in: [...(COLLECTED_PURPOSES as PaymentPurpose[]), ...REFUND_PAYMENT_PURPOSES] },
            collectedById: byStaff ? staffUserId : { not: null },
          },
        ],
      },
      select: {
        collectedById: true,
        collectedAt: true,
        createdAt: true,
        purpose: true,
        totalAmount: true,
        cashAmount: true,
        onlineAmount: true,
        method: true,
        booking: { select: bookingRef },
      },
    }),
    // Pickups: candidates around the range; the handover time decides
    prisma.booking.findMany({
      where: {
        AND: [
          scope,
          { status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURNED, BookingStatus.CANCELLED] } },
          {
            OR: [
              { startAt: { gte: new Date(range.start.getTime() - 7 * DAY_MS), lte: new Date(range.end.getTime() + 7 * DAY_MS) } },
              {
                paymentSessions: {
                  some: { sessionType: PaymentSessionType.PICKUP, status: PaymentSessionStatus.COMPLETED, completedAt: { gte: range.start, lte: range.end } },
                },
              },
            ],
          },
        ],
      },
      select: handoverSelect,
    }),
    prisma.booking.findMany({
      where: { AND: [scope, { status: BookingStatus.RETURNED, returnedAt: { gte: range.start, lte: range.end } }] },
      select: handoverSelect,
    }),
  ]);

  const [pickupBy, dropBy] = await Promise.all([handoverPerformers("PICKUP", pickupCands), handoverPerformers("RETURN", drops)]);

  const userIds = new Set<number>();
  created.forEach((b) => userIds.add(b.createdById));
  payments.forEach((p) => p.collectedById != null && userIds.add(p.collectedById));
  pickupBy.forEach((v) => v.userId != null && userIds.add(v.userId));
  dropBy.forEach((v) => v.userId != null && userIds.add(v.userId));
  const users = new Map(
    (
      await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, publicId: true, name: true, role: true } })
    ).map((u) => [u.id, u]),
  );
  const staff = (id: number) => {
    const u = users.get(id);
    return { staffUserId: id, staffId: u?.publicId ?? String(id), staffName: u?.name ?? "Unknown user", staffRole: u?.role ?? "" };
  };
  const ref = (b: { publicId: string; branch: { publicId: string; name: string }; customer: { user: { name: string } } }) => ({
    branchId: b.branch.publicId,
    branchName: b.branch.name,
    bookingId: b.publicId,
    customerName: b.customer.user.name,
  });

  const rows: ActivityRow[] = [];
  for (const b of created) {
    rows.push({ kind: "BOOKING_CREATED", kindLabel: ACTIVITY_LABELS.BOOKING_CREATED, at: b.createdAt, ...staff(b.createdById), ...ref(b), amount: r2(num(b.totalFinal)), cash: null, online: null, detail: b.status });
  }
  for (const p of payments) {
    const isRefund = (REFUND_PAYMENT_PURPOSES as string[]).includes(p.purpose);
    const kind: ActivityKind = isRefund ? "REFUND_PAID" : "PAYMENT_COLLECTED";
    rows.push({
      kind,
      kindLabel: ACTIVITY_LABELS[kind],
      at: p.collectedAt ?? p.createdAt,
      ...staff(p.collectedById!),
      ...ref(p.booking),
      amount: r2(num(p.totalAmount)),
      cash: r2(num(p.cashAmount)),
      online: r2(num(p.onlineAmount)),
      detail: p.purpose,
    });
  }
  let unattributed = 0;
  const pushHandover = (kind: "PICKUP" | "DROP", b: (typeof pickupCands)[number], who: { userId: number | null; at: Date | null } | undefined, fallbackAt: Date | null) => {
    const at = who?.at ?? fallbackAt;
    if (!at || at < range.start || at > range.end) return;
    if (who?.userId == null) {
      if (!byStaff) unattributed += 1;
      return;
    }
    if (byStaff && who.userId !== staffUserId) return;
    rows.push({ kind, kindLabel: ACTIVITY_LABELS[kind], at, ...staff(who.userId), ...ref(b), amount: null, cash: null, online: null, detail: null });
  };
  for (const b of pickupCands) pushHandover("PICKUP", b, pickupBy.get(b.id), null);
  // A drop counts on its return day (returnedAt), whoever did it
  for (const b of drops) {
    const who = dropBy.get(b.id);
    pushHandover("DROP", b, who ? { userId: who.userId, at: b.returnedAt } : undefined, b.returnedAt);
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { rows, unattributedHandovers: unattributed };
}

interface StaffAgg {
  staffId: string;
  staffName: string;
  staffRole: string;
  bookingsCreated: number;
  bookingValue: number;
  paymentsCollected: number;
  amountCollected: number;
  cashCollected: number;
  onlineCollected: number;
  refundsPaid: number;
  refundAmount: number;
  pickups: number;
  drops: number;
  handovers: number;
}

function aggregateStaff(rows: ActivityRow[]): StaffAgg[] {
  const by = new Map<string, StaffAgg>();
  for (const r of rows) {
    let a = by.get(r.staffId);
    if (!a) {
      a = { staffId: r.staffId, staffName: r.staffName, staffRole: r.staffRole, bookingsCreated: 0, bookingValue: 0, paymentsCollected: 0, amountCollected: 0, cashCollected: 0, onlineCollected: 0, refundsPaid: 0, refundAmount: 0, pickups: 0, drops: 0, handovers: 0 };
      by.set(r.staffId, a);
    }
    switch (r.kind) {
      case "BOOKING_CREATED":
        a.bookingsCreated += 1;
        a.bookingValue = r2(a.bookingValue + (r.amount ?? 0));
        break;
      case "PAYMENT_COLLECTED":
        a.paymentsCollected += 1;
        a.amountCollected = r2(a.amountCollected + (r.amount ?? 0));
        a.cashCollected = r2(a.cashCollected + (r.cash ?? 0));
        a.onlineCollected = r2(a.onlineCollected + (r.online ?? 0));
        break;
      case "REFUND_PAID":
        a.refundsPaid += 1;
        a.refundAmount = r2(a.refundAmount + (r.amount ?? 0));
        break;
      case "PICKUP":
        a.pickups += 1;
        a.handovers += 1;
        break;
      case "DROP":
        a.drops += 1;
        a.handovers += 1;
        break;
    }
  }
  return [...by.values()].sort((x, y) => y.handovers + y.bookingsCreated + y.paymentsCollected - (x.handovers + x.bookingsCreated + x.paymentsCollected) || x.staffName.localeCompare(y.staffName));
}

function totals(staff: StaffAgg[]) {
  const s = (k: keyof StaffAgg) => r2(staff.reduce((acc, x) => acc + (x[k] as number), 0));
  return {
    staff: staff.length,
    bookingsCreated: s("bookingsCreated"),
    paymentsCollected: s("paymentsCollected"),
    amountCollected: s("amountCollected"),
    cashCollected: s("cashCollected"),
    onlineCollected: s("onlineCollected"),
    refundsPaid: s("refundsPaid"),
    refundAmount: s("refundAmount"),
    pickups: s("pickups"),
    drops: s("drops"),
    handovers: s("handovers"),
  };
}

export async function staffActivityReport(f: ReportFilters, opts: { staffPublicId?: string | null; kind?: string | null } = {}) {
  let staffUserId: number | null = null;
  if (opts.staffPublicId) {
    const u = await prisma.user.findUnique({ where: { publicId: opts.staffPublicId }, select: { id: true } });
    staffUserId = u?.id ?? -1;
  }
  const cur = await staffActivityRows(f, f, staffUserId);
  const staff = aggregateStaff(cur.rows);
  const summary = { ...totals(staff), unattributedHandovers: cur.unattributedHandovers };
  let previous = null;
  let deltas = null;
  if (f.compare) {
    const p = await staffActivityRows(f, f.previous, staffUserId);
    previous = { ...totals(aggregateStaff(p.rows)), unattributedHandovers: p.unattributedHandovers };
    deltas = deltasOf(summary, previous, ["bookingsCreated", "paymentsCollected", "amountCollected", "cashCollected", "handovers"]);
  }
  const kind = opts.kind && opts.kind in ACTIVITY_LABELS ? opts.kind : null;
  const staffOptions = await prisma.user.findMany({
    where: { role: { in: [Role.STAFF, Role.MANAGER, Role.ADMIN] }, deletedAt: null },
    select: { publicId: true, name: true, role: true, isActive: true },
    orderBy: { name: "asc" },
  });
  return {
    period: periodInfo(f),
    activityLabels: ACTIVITY_LABELS,
    summary,
    previous,
    deltas,
    staff,
    transactions: kind ? cur.rows.filter((r) => r.kind === kind) : cur.rows,
    staffOptions,
    notes: [
      "Each action counts on the day it happened: bookings by creation time, payments by collection time, pickups by the handover time, drops by the return time.",
      "Bookings handled = bookings the staff member created at the counter (app bookings have no staff creator).",
      "Payments collected = money the staff member recorded (rent, extensions, drop and damage charges, deposits); online gateway payments have no collector and are not here. Cash is the cash part.",
      "Handovers = pickups and drops performed: the person who settled the pickup / drop bill, else who did the legacy pickup / drop or sent it for approval, else the manager who confirmed it, else who recorded the fuel / licence reading.",
      cur.unattributedHandovers > 0
        ? `${cur.unattributedHandovers} handover(s) in the range have no recorded performer (older rows) and are not attributed to anyone.`
        : "Every handover in the range has a recorded performer.",
    ],
  };
}

export type StaffActivityReport = Awaited<ReturnType<typeof staffActivityReport>>;
