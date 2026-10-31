/**
 * Admin Reports 7.1 Customer Summary and 7.2 Customer History & Lifetime Value. Read-only.
 *
 * 7.1: customers with a booking (CONFIRMED / PICKED_UP / RETURNED) scheduled in the
 *      range. New = first-ever such booking (any branch / category) starts in the range.
 *      Revenue = Finance's booking revenue; due = Finance's outstanding due (as of now).
 * 7.2: customers with a booking in the range (or every customer with `allTime`); every
 *      figure is LIFETIME — all their bookings within the branch / category / vehicle
 *      filters, any date. Trips = completed (RETURNED) bookings. Total spend = Finance
 *      revenue summed; paid = confirmed money in less refunds paid out; outstanding =
 *      Finance due (counted dues only, as of now).
 */
import { prisma, Prisma, BookingStatus } from "@repo/database/client";
import { bookingScopeFromFilters, type ReportFilters } from "../../../utils/reporting/index.js";
import {
  STATUS_BUCKET_LABELS,
  customerTypeOf,
  pctOf,
  statusBucket,
  type CustomerType,
} from "../../../utils/reporting/bookings/definitions.js";
import { getDuesByBooking, getMoneyByBooking, getRevenueByBooking } from "../finance/booking-finance.js";
import {
  ACTIVE_STATUSES,
  LISTED_STATUSES,
  NOT_FAILED_CHECKOUT,
  bookingDisplay,
  bookingRowSelect,
  deltasOf,
  groupInto,
  loadBookings,
  num,
  periodInfo,
  r2,
  type BookingRow,
  type Range,
} from "./common.js";

export type CustomerSort = "revenue" | "bookings" | "due" | "name" | "recent";
const SORTS: CustomerSort[] = ["revenue", "bookings", "due", "name", "recent"];
export const parseCustomerSort = (v: unknown): CustomerSort =>
  SORTS.includes(String(v) as CustomerSort) ? (String(v) as CustomerSort) : "revenue";

/** First-ever active booking start per customer (any branch / category). */
async function firstBookingStart(customerIds: number[]): Promise<Map<number, Date>> {
  if (!customerIds.length) return new Map();
  const g = await prisma.booking.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customerIds }, deletedAt: null, status: { in: ACTIVE_STATUSES } },
    _min: { startAt: true },
  });
  return new Map(g.filter((x) => x._min.startAt).map((x) => [x.customerId, x._min.startAt!]));
}

// ═══ 7.1 ═══════════════════════════════════════════════════════════════════════

interface CustomerAgg {
  customerId: number;
  customerPublicId: string;
  name: string;
  phone: string | null;
  bookings: number;
  revenue: number;
  due: number;
  firstBookingAt: Date | null;
  lastBookingAt: Date;
  type: CustomerType;
}

async function customerFacts(f: ReportFilters, range: Range) {
  const rows = await loadBookings(f, { statuses: ACTIVE_STATUSES, range });
  const ids = rows.map((b) => b.id);
  const [revenue, dues, first] = await Promise.all([
    getRevenueByBooking(ids),
    getDuesByBooking(ids),
    firstBookingStart([...new Set(rows.map((b) => b.customerId))]),
  ]);
  const by = groupInto(
    rows,
    (b) => b.customerId,
    () => ({ list: [] as BookingRow[] }),
    (acc, b) => acc.list.push(b),
  );
  const customers: CustomerAgg[] = [...by.entries()].map(([customerId, { list }]) => {
    const b0 = list[0]!;
    const firstAt = first.get(customerId) ?? null;
    return {
      customerId,
      customerPublicId: b0.customer.publicId,
      name: b0.customer.user.name,
      phone: b0.customer.user.phone || null,
      bookings: list.length,
      revenue: r2(list.reduce((s, b) => s + (revenue.get(b.id)?.revenue ?? 0), 0)),
      due: r2(list.reduce((s, b) => s + (dues.get(b.id)?.counted ? dues.get(b.id)!.due : 0), 0)),
      firstBookingAt: firstAt,
      lastBookingAt: list.reduce((m, b) => (b.startAt > m ? b.startAt : m), b0.startAt),
      type: customerTypeOf(firstAt, range.start),
    };
  });
  return { rows, customers };
}

function summarizeCustomers(customers: CustomerAgg[]) {
  const isNew = customers.filter((c) => c.type === "NEW");
  const repeat = customers.filter((c) => c.type === "REPEAT");
  const revenue = r2(customers.reduce((s, c) => s + c.revenue, 0));
  const newRevenue = r2(isNew.reduce((s, c) => s + c.revenue, 0));
  const repeatRevenue = r2(repeat.reduce((s, c) => s + c.revenue, 0));
  const bookings = customers.reduce((s, c) => s + c.bookings, 0);
  return {
    customers: customers.length,
    newCustomers: isNew.length,
    repeatCustomers: repeat.length,
    repeatSharePct: pctOf(repeat.length, customers.length),
    bookings,
    revenue,
    newRevenue,
    repeatRevenue,
    avgRevenuePerCustomer: customers.length ? r2(revenue / customers.length) : null,
    due: r2(customers.reduce((s, c) => s + c.due, 0)),
  };
}

function sortCustomers<T extends { revenue: number; bookings: number; due: number; name: string; lastBookingAt: Date | null }>(
  list: T[],
  sort: CustomerSort,
): T[] {
  const cmp: Record<CustomerSort, (a: T, b: T) => number> = {
    revenue: (a, b) => b.revenue - a.revenue,
    bookings: (a, b) => b.bookings - a.bookings,
    due: (a, b) => b.due - a.due,
    name: (a, b) => a.name.localeCompare(b.name),
    recent: (a, b) => (b.lastBookingAt?.getTime() ?? 0) - (a.lastBookingAt?.getTime() ?? 0),
  };
  return [...list].sort((a, b) => cmp[sort](a, b) || b.revenue - a.revenue || a.name.localeCompare(b.name));
}

const matchSearch = (q: string | null, c: { name: string; phone: string | null; customerPublicId: string }) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s) || c.customerPublicId.toLowerCase() === s;
};

export async function customerSummaryReport(
  f: ReportFilters,
  opts: { type?: "new" | "repeat" | null; sort?: CustomerSort; search?: string | null } = {},
) {
  const cur = await customerFacts(f, f);
  const summary = summarizeCustomers(cur.customers);
  const sort = opts.sort ?? "revenue";
  let list = cur.customers;
  if (opts.type === "new") list = list.filter((c) => c.type === "NEW");
  if (opts.type === "repeat") list = list.filter((c) => c.type === "REPEAT");
  list = sortCustomers(list.filter((c) => matchSearch(opts.search ?? null, c)), sort);

  let previous: ReturnType<typeof summarizeCustomers> | null = null;
  let deltas = null;
  if (f.compare) {
    previous = summarizeCustomers((await customerFacts(f, f.previous)).customers);
    deltas = deltasOf(summary, previous, ["customers", "newCustomers", "repeatCustomers", "revenue", "newRevenue", "repeatRevenue", "avgRevenuePerCustomer"]);
  }

  const toRow = (c: CustomerAgg) => ({
    customerId: c.customerPublicId,
    name: c.name,
    phone: c.phone,
    type: c.type,
    typeLabel: c.type === "NEW" ? "New" : "Repeat",
    bookings: c.bookings,
    revenue: c.revenue,
    avgRevenue: c.bookings ? r2(c.revenue / c.bookings) : null,
    due: c.due,
    firstBookingAt: c.firstBookingAt,
    lastBookingAt: c.lastBookingAt,
  });

  return {
    period: periodInfo(f),
    summary,
    previous,
    deltas,
    topCustomers: sortCustomers(cur.customers, "revenue").slice(0, 10).map(toRow),
    rows: list.map(toRow),
    notes: [
      "Customers with a confirmed, active or completed booking scheduled (startAt) in the range.",
      "New = their first-ever booking (any branch, any category) starts in the range; Repeat = they had one before it.",
      "Revenue = Finance's booking revenue for those bookings. Due = what those bookings still owe as of now (Finance's outstanding dues).",
    ],
  };
}

export type CustomerSummaryReport = Awaited<ReturnType<typeof customerSummaryReport>>;

// ═══ 7.2 ═══════════════════════════════════════════════════════════════════════

export async function customerLtvReport(f: ReportFilters, opts: { allTime?: boolean; sort?: CustomerSort; search?: string | null } = {}) {
  // Which customers: active in the range, or everyone with a booking (allTime)
  let customerIds: number[];
  if (opts.allTime) {
    const g = await prisma.booking.groupBy({
      by: ["customerId"],
      where: { AND: [bookingScopeFromFilters(f), { status: { in: LISTED_STATUSES } }, NOT_FAILED_CHECKOUT] },
    });
    customerIds = g.map((x) => x.customerId);
  } else {
    const inRange = await loadBookings(f, { statuses: LISTED_STATUSES });
    customerIds = [...new Set(inRange.map((b) => b.customerId))];
  }

  // Lifetime bookings of those customers within the branch / category / vehicle scope
  const lifetime: BookingRow[] = customerIds.length
    ? await prisma.booking.findMany({
        where: {
          AND: [
            bookingScopeFromFilters(f),
            // allTime: the customer set IS everyone in scope, so skip the (possibly huge) IN list
            opts.allTime ? { status: { in: LISTED_STATUSES } } : { customerId: { in: customerIds }, status: { in: LISTED_STATUSES } },
            NOT_FAILED_CHECKOUT,
          ],
        },
        select: bookingRowSelect,
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
      })
    : [];
  const activeIds = lifetime.filter((b) => (ACTIVE_STATUSES as string[]).includes(b.status)).map((b) => b.id);
  const [revenue, dues, money] = await Promise.all([
    getRevenueByBooking(activeIds),
    getDuesByBooking(activeIds),
    getMoneyByBooking(activeIds),
  ]);

  const by = groupInto(lifetime, (b) => b.customerId, () => [] as BookingRow[], (acc, b) => acc.push(b));
  let rows = [...by.values()].map((list) => {
    const b0 = list[0]!;
    const active = list.filter((b) => b.status !== BookingStatus.CANCELLED);
    const trips = list.filter((b) => b.status === BookingStatus.RETURNED).length;
    const spend = r2(active.reduce((s, b) => s + (revenue.get(b.id)?.revenue ?? 0), 0));
    const paid = r2(active.reduce((s, b) => s + num(money.get(b.id)?.netConfirmed), 0));
    const due = r2(active.reduce((s, b) => s + (dues.get(b.id)?.counted ? dues.get(b.id)!.due : 0), 0));
    return {
      customerId: b0.customer.publicId,
      name: b0.customer.user.name,
      phone: b0.customer.user.phone || null,
      trips,
      bookings: active.length,
      cancellations: list.length - active.length,
      revenue: spend,
      paid,
      due,
      avgRevenuePerTrip: trips ? r2(spend / trips) : null,
      firstBookingAt: active[0]?.startAt ?? null,
      lastBookingAt: active.length ? active[active.length - 1]!.startAt : null,
    };
  });
  rows = sortCustomers(rows.filter((c) => matchSearch(opts.search ?? null, { ...c, customerPublicId: c.customerId })), opts.sort ?? "revenue");

  const summary = {
    customers: rows.length,
    trips: rows.reduce((s, r) => s + r.trips, 0),
    bookings: rows.reduce((s, r) => s + r.bookings, 0),
    lifetimeRevenue: r2(rows.reduce((s, r) => s + r.revenue, 0)),
    paid: r2(rows.reduce((s, r) => s + r.paid, 0)),
    due: r2(rows.reduce((s, r) => s + r.due, 0)),
    customersWithDue: rows.filter((r) => r.due > 0).length,
    avgLifetimeValue: rows.length ? r2(rows.reduce((s, r) => s + r.revenue, 0) / rows.length) : null,
  };

  return {
    period: periodInfo(f),
    scope: opts.allTime ? "ALL_TIME" : "ACTIVE_IN_RANGE",
    summary,
    rows,
    notes: [
      opts.allTime
        ? "Every customer with a booking (within the branch / category / vehicle filters)."
        : "Customers with a booking scheduled in the range; their figures are lifetime (all dates).",
      "Trips = completed bookings. Total spend = Finance's booking revenue summed over confirmed, active and completed bookings. Paid = confirmed money in less refunds paid out (deposits included). Outstanding = what is still owed as of now.",
      "Lifetime value is not comparable to a previous period, so there is no comparison here.",
    ],
  };
}

export type CustomerLtvReport = Awaited<ReturnType<typeof customerLtvReport>>;

/** One customer's consolidated history (7.2 drill-down) within the branch / category / vehicle scope. */
export async function customerHistory(f: ReportFilters, customerPublicId: string) {
  const customer = await prisma.customer.findUnique({
    where: { publicId: customerPublicId },
    select: { id: true, publicId: true, isBlacklisted: true, createdAt: true, user: { select: { name: true, phone: true, createdAt: true } } },
  });
  if (!customer) return null;
  const where: Prisma.BookingWhereInput = {
    AND: [bookingScopeFromFilters(f), { customerId: customer.id, status: { in: LISTED_STATUSES } }, NOT_FAILED_CHECKOUT],
  };
  const list = await prisma.booking.findMany({ where, select: bookingRowSelect, orderBy: [{ startAt: "desc" }, { id: "desc" }] });
  const activeIds = list.filter((b) => b.status !== BookingStatus.CANCELLED).map((b) => b.id);
  const [revenue, dues, money] = await Promise.all([getRevenueByBooking(activeIds), getDuesByBooking(activeIds), getMoneyByBooking(activeIds)]);
  const rows = list.map((b) => {
    const rv = revenue.get(b.id);
    const du = dues.get(b.id);
    return {
      ...bookingDisplay(b),
      status: statusBucket(b.status)!,
      statusLabel: STATUS_BUCKET_LABELS[statusBucket(b.status)!],
      createdAt: b.createdAt,
      startAt: b.startAt,
      endAt: b.endAt,
      returnedAt: b.returnedAt,
      cancelledAt: b.cancelledAt,
      extensions: b.extensionCount,
      bookingValue: r2(num(b.totalFinal)),
      revenue: rv?.revenue ?? 0,
      paid: r2(num(money.get(b.id)?.netConfirmed)),
      due: du?.counted ? du.due : 0,
    };
  });
  return {
    customer: {
      customerId: customer.publicId,
      name: customer.user.name,
      phone: customer.user.phone || null,
      registeredAt: customer.user.createdAt,
      isBlacklisted: customer.isBlacklisted,
    },
    summary: {
      bookings: rows.filter((r) => r.status !== "CANCELLED").length,
      trips: rows.filter((r) => r.status === "COMPLETED").length,
      cancellations: rows.filter((r) => r.status === "CANCELLED").length,
      revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)),
      paid: r2(rows.reduce((s, r) => s + r.paid, 0)),
      due: r2(rows.reduce((s, r) => s + r.due, 0)),
    },
    rows,
  };
}
