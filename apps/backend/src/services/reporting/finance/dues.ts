/**
 * 2.3 Outstanding Dues & Aging — snapshot "as of now"; rules in booking-finance.ts
 * (due = max(0, totalOwed − netConfirmed) = financial-state amountDue; aged from
 * the pickup, or from the return when only drop charges are unpaid).
 * No date range: dues are a position, not a flow. Branch / category / vehicle apply.
 */
import { prisma, BookingStatus } from "@repo/database/client";
import { bookingScopeFromFilters } from "../../../utils/reporting/index.js";
import { computeBookingsOwed } from "../../payment/booking-owed.service.js";
import {
  AGING_BUCKETS,
  dueOf,
  getMoneyByBooking,
  type AgingBucket,
  type BookingDue,
} from "./booking-finance.js";
import type { FinanceScope } from "./revenue.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DueRow extends BookingDue {
  bookingId: number;
  bookingPublicId: string;
  status: string;
  startAt: Date;
  endAt: Date;
  returnedAt: Date | null;
  branchName: string;
  customerId: number;
  customerPublicId: string;
  customerName: string;
  customerPhone: string | null;
  vehicle: string;
  category: string;
  totalFinal: number;
  extras: number;
  lastPaymentAt: Date | null;
}

export interface CustomerDue {
  customerPublicId: string;
  customerName: string;
  customerPhone: string | null;
  bookings: number;
  due: number;
  pendingConfirmation: number;
  oldestAgeDays: number;
  buckets: Record<AgingBucket, number>;
}

export interface OutstandingDues {
  total: number;
  customers: number;
  bookings: number;
  awaitingConfirmation: number;
  buckets: { d0_7: number; d8_30: number; d31plus: number };
  bucketCounts: { d0_7: number; d8_30: number; d31plus: number };
  /** Confirmed bookings still to start with an unpaid balance (not in total) */
  notYetDue: { amount: number; bookings: number };
  rows: DueRow[];
  byCustomer: CustomerDue[];
  asOf: Date;
}

const emptyBuckets = (): Record<AgingBucket, number> => ({ "0-7": 0, "8-30": 0, "31+": 0 });

export async function getOutstandingDues(scope: FinanceScope & { now?: Date }): Promise<OutstandingDues> {
  const now = scope.now ?? new Date();
  const bookings = await prisma.booking.findMany({
    where: {
      AND: [
        bookingScopeFromFilters({
          branchPublicId: scope.branchPublicId ?? null,
          categoryPublicIds: scope.categoryPublicIds ?? [],
          vehiclePublicId: scope.vehiclePublicId ?? null,
        }),
        { status: { in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP, BookingStatus.RETURNED] } },
      ],
    },
    select: {
      id: true,
      publicId: true,
      status: true,
      startAt: true,
      endAt: true,
      returnedAt: true,
      deletedAt: true,
      totalFinal: true,
      customerId: true,
      branch: { select: { name: true } },
      customer: { select: { publicId: true, user: { select: { name: true, phone: true } } } },
      items: {
        select: { vehicle: { select: { regNo: true, make: true, model: true, category: { select: { name: true } } } } },
      },
    },
  });
  const ids = bookings.map((b) => b.id);
  const [owedMap, moneyMap, lastPays] = await Promise.all([
    computeBookingsOwed(ids),
    getMoneyByBooking(ids),
    ids.length
      ? prisma.paymentTransaction.groupBy({
          by: ["bookingId"],
          where: { bookingId: { in: ids }, status: { in: ["COLLECTED", "CONFIRMED"] } },
          _max: { createdAt: true, collectedAt: true },
        })
      : Promise.resolve([] as Array<{ bookingId: number; _max: { createdAt: Date | null; collectedAt: Date | null } }>),
  ]);
  const lastPay = new Map(
    lastPays.map((g) => {
      const a = g._max.collectedAt?.getTime() ?? 0;
      const c = g._max.createdAt?.getTime() ?? 0;
      return [g.bookingId, a || c ? new Date(Math.max(a, c)) : null] as const;
    }),
  );

  const rows: DueRow[] = [];
  let notYetAmount = 0;
  let notYetCount = 0;
  for (const b of bookings) {
    const owed = owedMap.get(b.id);
    const money = moneyMap.get(b.id);
    if (!owed || !money) continue;
    const d = dueOf(b, owed, { netConfirmed: Number(money.netConfirmed), pending: Number(money.pending) }, now);
    if (d.notYetDue) {
      notYetAmount += d.due;
      notYetCount += 1;
    }
    if (!d.counted) continue;
    const v = b.items[0]?.vehicle;
    rows.push({
      ...d,
      bookingId: b.id,
      bookingPublicId: b.publicId,
      status: b.status,
      startAt: b.startAt,
      endAt: b.endAt,
      returnedAt: b.returnedAt,
      branchName: b.branch.name,
      customerId: b.customerId,
      customerPublicId: b.customer.publicId,
      customerName: b.customer.user.name,
      customerPhone: b.customer.user.phone ?? null,
      vehicle: v ? `${v.regNo} · ${v.make} ${v.model}` : "Not recorded",
      category: v?.category.name ?? "Not recorded",
      totalFinal: r2(Number(b.totalFinal)),
      extras: r2(Number(owed.returnCharges)),
      lastPaymentAt: lastPay.get(b.id) ?? null,
    });
  }
  rows.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0) || b.due - a.due);

  const buckets = emptyBuckets();
  const counts = emptyBuckets();
  const byCust = new Map<number, CustomerDue>();
  let total = 0;
  let pending = 0;
  for (const r of rows) {
    total += r.due;
    pending += Math.min(r.pendingConfirmation, r.due);
    buckets[r.bucket!] += r.due;
    counts[r.bucket!] += 1;
    const c = byCust.get(r.customerId) ?? {
      customerPublicId: r.customerPublicId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      bookings: 0,
      due: 0,
      pendingConfirmation: 0,
      oldestAgeDays: 0,
      buckets: emptyBuckets(),
    };
    c.bookings += 1;
    c.due = r2(c.due + r.due);
    c.pendingConfirmation = r2(c.pendingConfirmation + Math.min(r.pendingConfirmation, r.due));
    c.oldestAgeDays = Math.max(c.oldestAgeDays, r.ageDays ?? 0);
    c.buckets[r.bucket!] = r2(c.buckets[r.bucket!] + r.due);
    byCust.set(r.customerId, c);
  }
  for (const k of AGING_BUCKETS) buckets[k] = r2(buckets[k]);

  return {
    total: r2(total),
    customers: byCust.size,
    bookings: rows.length,
    awaitingConfirmation: r2(pending),
    buckets: { d0_7: buckets["0-7"], d8_30: buckets["8-30"], d31plus: buckets["31+"] },
    bucketCounts: { d0_7: counts["0-7"], d8_30: counts["8-30"], d31plus: counts["31+"] },
    notYetDue: { amount: r2(notYetAmount), bookings: notYetCount },
    rows,
    byCustomer: [...byCust.values()].sort((a, b) => b.due - a.due),
    asOf: now,
  };
}
