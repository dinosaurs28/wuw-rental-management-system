/**
 * Shared loaders for the booking / customer / staff reports (Admin Reports 3.x, 7.x, 8.x).
 * Read-only. Definitions: utils/reporting/bookings/definitions.ts.
 */
import { prisma, Prisma, BookingStatus } from "@repo/database/client";
import {
  bookingWhereFromFilters,
  computeDelta,
  type Delta,
  type ReportFilters,
} from "../../../utils/reporting/index.js";
import { bookingSourceOf, type SourceKey } from "../../../utils/reporting/bookings/definitions.js";

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const num = (v: { toString(): string } | number | null | undefined): number =>
  v == null ? 0 : Number(v.toString());

/** The statuses that are bookings (HOLD / HOLD_EXPIRED never were). */
export const LISTED_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
  BookingStatus.CANCELLED,
];

export const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
];

/** A failed online checkout (CANCELLED by the payment failure, no cancelledAt) is never a booking. */
export const NOT_FAILED_CHECKOUT: Prisma.BookingWhereInput = {
  NOT: { status: BookingStatus.CANCELLED, paymentStatus: "FAILED", cancelledAt: null },
};

export type Range = { start: Date; end: Date };

export const bookingRowSelect = {
  id: true,
  publicId: true,
  status: true,
  paymentStatus: true,
  startAt: true,
  endAt: true,
  createdAt: true,
  cancelledAt: true,
  returnedAt: true,
  totalFinal: true,
  totalDeposit: true,
  rentalPeriodType: true,
  cancellationReason: true,
  cancellationSource: true,
  cancelledById: true,
  displacedByExtensionId: true,
  extensionCount: true,
  originalEndAt: true,
  customerId: true,
  createdById: true,
  branch: { select: { publicId: true, name: true } },
  createdBy: { select: { publicId: true, name: true, role: true } },
  customer: { select: { publicId: true, user: { select: { name: true, phone: true } } } },
  items: {
    orderBy: { id: "asc" },
    select: {
      vehicle: {
        select: { publicId: true, regNo: true, make: true, model: true, category: { select: { publicId: true, name: true } } },
      },
    },
  },
} satisfies Prisma.BookingSelect;

export type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingRowSelect }>;

/** Bookings for the filters (startAt anchor) in `statuses`, failed checkouts excluded. */
export async function loadBookings(
  f: ReportFilters,
  opts: { statuses?: BookingStatus[]; range?: Range; extra?: Prisma.BookingWhereInput } = {},
): Promise<BookingRow[]> {
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingWhereFromFilters(f, { statuses: opts.statuses ?? LISTED_STATUSES, range: opts.range }),
      NOT_FAILED_CHECKOUT,
      ...(opts.extra ? [opts.extra] : []),
    ],
  };
  return prisma.booking.findMany({ where, select: bookingRowSelect, orderBy: [{ startAt: "asc" }, { id: "asc" }] });
}

/** Display fields shared by every booking-level table / CSV. */
export function bookingDisplay(b: BookingRow) {
  const v = b.items[0]?.vehicle;
  const source: SourceKey = bookingSourceOf(b.createdBy?.role);
  return {
    bookingId: b.publicId,
    customerId: b.customer.publicId,
    customerName: b.customer.user.name,
    customerPhone: b.customer.user.phone || null,
    branchId: b.branch.publicId,
    branchName: b.branch.name,
    vehicleId: v?.publicId ?? null,
    vehicle: v ? `${v.make} ${v.model} (${v.regNo})` : "",
    regNo: v?.regNo ?? "",
    categoryId: v?.category.publicId ?? null,
    category: v?.category.name ?? "Not recorded",
    vehicleCount: b.items.length,
    source,
    createdByName: b.createdBy?.name ?? null,
    createdByRole: b.createdBy?.role ?? null,
  };
}

/** Group-by helper: Map key → accumulated value. */
export function groupInto<T, K, V>(rows: T[], keyOf: (r: T) => K, init: () => V, add: (acc: V, r: T) => void): Map<K, V> {
  const out = new Map<K, V>();
  for (const r of rows) {
    const k = keyOf(r);
    let acc = out.get(k);
    if (acc === undefined) {
      acc = init();
      out.set(k, acc);
    }
    add(acc, r);
  }
  return out;
}

/** Deltas for every numeric key present in both objects. */
export function deltasOf<T extends Record<string, unknown>>(cur: T, prev: T, keys: (keyof T)[]): Record<string, Delta> {
  const out: Record<string, Delta> = {};
  for (const k of keys) {
    const c = cur[k];
    const p = prev[k];
    out[String(k)] = computeDelta(typeof c === "number" ? c : null, typeof p === "number" ? p : null);
  }
  return out;
}

export interface Page {
  page: number;
  limit: number;
}

export function parsePage(query: Record<string, unknown>, defLimit = 50): Page {
  const p = Number.parseInt(String(query.page ?? "1"), 10);
  const l = Number.parseInt(String(query.limit ?? String(defLimit)), 10);
  return {
    page: Number.isFinite(p) && p > 0 ? p : 1,
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, 500) : defLimit,
  };
}

export function paginate<T>(rows: T[], page: Page) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / page.limit));
  const current = Math.min(page.page, totalPages);
  return {
    rows: rows.slice((current - 1) * page.limit, current * page.limit),
    pagination: { page: current, limit: page.limit, total, totalPages },
  };
}

/** Period description for every response. */
export function periodInfo(f: ReportFilters) {
  return {
    from: f.from,
    to: f.to,
    days: f.days,
    label: f.previous.currentLabel,
    previous: { from: f.previous.from, to: f.previous.to, label: f.previous.label },
    filters: {
      branchId: f.branchPublicId,
      categories: f.categoryPublicIds,
      vehicleId: f.vehiclePublicId,
    },
  };
}

/** User names by id (staff / cancelling users). */
export async function userNames(ids: Iterable<number | null | undefined>): Promise<Map<number, { name: string; role: string; publicId: string }>> {
  const list = [...new Set([...ids].filter((x): x is number => typeof x === "number"))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: list } },
    select: { id: true, name: true, role: true, publicId: true },
  });
  return new Map(users.map((u) => [u.id, { name: u.name, role: u.role, publicId: u.publicId }]));
}
