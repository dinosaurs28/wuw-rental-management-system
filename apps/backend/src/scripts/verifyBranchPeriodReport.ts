/**
 * Numeric verification of the Branch Manager Period report (#14).
 *
 * Run against a THROWAWAY database (fixture rows are created under a random
 * prefix and removed again at the end, success or failure):
 *   TZ=UTC DATABASE_URL="postgresql://postgres:pw@localhost:55432/vrms_x" \
 *     npx tsx src/scripts/verifyBranchPeriodReport.ts
 *
 * TZ=UTC on purpose: day boundaries must be IST no matter where the server runs.
 * Calls the ACTUAL controllers with mock req/res and asserts hand-computed
 * numbers, IST boundary traps, breakdown/trend invariants, the bookings list,
 * CSV output and the 400 error contract.
 */
import {
  prisma,
  BookingStatus,
  ExtensionStatus,
  ExtensionTrigger,
  PaymentMethod,
  PaymentPurpose,
  PaymentTransactionStatus,
  RefundStatus,
  Role,
  type RentalPeriodType,
} from "@repo/database/client";
import {
  GetPeriodReport,
  GetPeriodBookings,
  ExportPeriodReport,
} from "../controller/branchManager/period-report.controller.js";

const P = `d11v${Math.random().toString(36).slice(2, 8)}`;
/** IST wall clock 'yyyy-MM-ddTHH:mm' → instant. */
const ist = (s: string) => new Date(`${s}:00+05:30`);

let failures = 0;
const assert = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
};

const mockRes = () => {
  const r: any = { _status: 200, _json: null, _send: null, headers: {} };
  r.status = (c: number) => ((r._status = c), r);
  r.json = (x: any) => ((r._json = x), r);
  r.setHeader = (k: string, v: string) => ((r.headers[k] = v), r);
  r.send = (x: any) => ((r._send = x), r);
  return r;
};
const call = async (fn: any, branchId: number | undefined, query: Record<string, string>) => {
  const res = mockRes();
  await fn({ query, branch_Id: branchId } as any, res as any);
  return res;
};

const ids = {
  branches: [] as number[],
  users: [] as number[],
  customer: 0,
  category: 0,
  vehicle: 0,
  bookings: [] as number[],
};

async function cleanup() {
  const bookingIds = ids.bookings;
  if (bookingIds.length) {
    await prisma.refundRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingExtension.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.returnReceipt.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.cancellationInvoice.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingItem.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
  if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
  if (ids.vehicle) await prisma.vehicle.deleteMany({ where: { id: ids.vehicle } });
  if (ids.category) await prisma.vehicleCategory.deleteMany({ where: { id: ids.category } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  if (ids.branches.length) await prisma.branch.deleteMany({ where: { id: { in: ids.branches } } });
}

async function seed() {
  const branch = await prisma.branch.create({
    data: { publicId: `${P}_br`, name: `Period Verify ${P}`, address: "MG Road" },
  });
  ids.branches.push(branch.id);
  const other = await prisma.branch.create({
    data: { publicId: `${P}_br2`, name: `Other ${P}`, address: "Elsewhere" },
  });
  ids.branches.push(other.id);
  const cat = await prisma.vehicleCategory.create({
    data: { publicId: `${P}_cat`, name: `Bikes ${P}`, rank: 1 },
  });
  ids.category = cat.id;
  const vehicle = await prisma.vehicle.create({
    data: {
      publicId: `${P}_veh`, branchId: branch.id, categoryId: cat.id,
      make: "Honda", model: "Activa", regNo: `KA01${P}`.toUpperCase(), odo: 1000,
      insuranceExpiry: new Date("2027-12-31T00:00:00Z"),
    },
  });
  ids.vehicle = vehicle.id;
  const custUser = await prisma.user.create({
    data: { publicId: `${P}_u1`, name: "Asha Rao", email: `${P}_asha@example.com`, phone: "9000011111", role: Role.CUSTOMER },
  });
  const staff = await prisma.user.create({
    data: { publicId: `${P}_u2`, name: "Ravi Staff", email: `${P}_ravi@example.com`, phone: "9000022222", role: Role.STAFF, branchId: branch.id },
  });
  ids.users.push(custUser.id, staff.id);
  const customer = await prisma.customer.create({ data: { publicId: `${P}_cus`, userId: custUser.id } });
  ids.customer = customer.id;

  const mk = async (o: {
    key: string; status: BookingStatus; start: string; end: string; total: number;
    by: "online" | "counter"; stored?: RentalPeriodType | null; createdAt?: string;
    returnedAt?: string; cancelledAt?: string; extensionCount?: number; deleted?: boolean;
    deposit?: number; branchId?: number;
  }) => {
    const b = await prisma.booking.create({
      data: {
        publicId: `${P}_${o.key}`, customerId: customer.id, branchId: o.branchId ?? branch.id,
        startAt: ist(o.start), endAt: ist(o.end), days: 1,
        rentalPeriodType: o.stored ?? null,
        totalBase: o.total, totalDiscount: 0, totalDeposit: o.deposit ?? 0, totalTax: 0,
        totalFinal: o.total, status: o.status, pricingSnapshot: {},
        createdById: o.by === "online" ? custUser.id : staff.id,
        createdAt: o.createdAt ? ist(o.createdAt) : ist(o.start),
        returnedAt: o.returnedAt ? ist(o.returnedAt) : null,
        cancelledAt: o.cancelledAt ? ist(o.cancelledAt) : null,
        extensionCount: o.extensionCount ?? 0,
        deletedAt: o.deleted ? new Date() : null,
      },
    });
    ids.bookings.push(b.id);
    await prisma.bookingItem.create({
      data: {
        bookingId: b.id, vehicleId: vehicle.id, days: 1, baseTotal: o.total, discountAmount: 0,
        discountPercent: 0, deposit: 0, finalTotal: o.total,
      },
    });
    return b;
  };

  // ── March 2026 (IST) ──────────────────────────────────────────────────────
  const A = await mk({ key: "A", status: BookingStatus.RETURNED, start: "2026-03-10T10:00", end: "2026-03-11T10:00", total: 10000, by: "online", stored: "FULL_DAY", returnedAt: "2026-03-11T10:30", deposit: 1000 });
  const B = await mk({ key: "B", status: BookingStatus.PICKED_UP, start: "2026-03-15T09:00", end: "2026-03-15T17:00", total: 2000, by: "counter", stored: null });
  // Stale stored type (extended 1 day → 3 days) must be reclassified MULTI_DAY.
  const C = await mk({ key: "C", status: BookingStatus.CONFIRMED, start: "2026-03-20T10:00", end: "2026-03-23T08:00", total: 8000, by: "counter", stored: "FULL_DAY", extensionCount: 1 });
  await mk({ key: "M", status: BookingStatus.CONFIRMED, start: "2026-03-25T10:00", end: "2026-04-24T10:00", total: 30000, by: "counter", stored: "MONTHLY" });
  const H = await mk({ key: "H", status: BookingStatus.RETURNED, start: "2026-03-05T10:00", end: "2026-03-05T10:45", total: 300, by: "online", stored: "HOURLY" });
  // IST boundary traps: 00:10 IST on 1 Mar is 28 Feb in UTC (IN); 00:05 IST on 1 Apr is 31 Mar in UTC (OUT).
  const T1 = await mk({ key: "T1", status: BookingStatus.CONFIRMED, start: "2026-03-01T00:10", end: "2026-03-03T00:10", total: 5000, by: "online", stored: "MULTI_DAY" });
  await mk({ key: "T2", status: BookingStatus.CONFIRMED, start: "2026-03-31T23:50", end: "2026-04-01T11:50", total: 1500, by: "counter", stored: null });
  await mk({ key: "T3", status: BookingStatus.CONFIRMED, start: "2026-04-01T00:05", end: "2026-04-02T00:05", total: 77777, by: "online" });
  // createdAt in range, startAt in April — excluded (startAt anchor).
  await mk({ key: "T4", status: BookingStatus.RETURNED, start: "2026-04-05T10:00", end: "2026-04-06T10:00", total: 88888, by: "online", createdAt: "2026-03-02T10:00" });
  // Cancelled (listed, not revenue); HOLD and soft-deleted (never counted); other branch.
  const D = await mk({ key: "D", status: BookingStatus.CANCELLED, start: "2026-03-18T10:00", end: "2026-03-19T10:00", total: 5000, by: "online", cancelledAt: "2026-03-17T12:00" });
  await mk({ key: "G", status: BookingStatus.HOLD, start: "2026-03-12T10:00", end: "2026-03-13T10:00", total: 12345, by: "online" });
  await mk({ key: "X", status: BookingStatus.CONFIRMED, start: "2026-03-12T10:00", end: "2026-03-13T10:00", total: 23456, by: "online", deleted: true });
  await mk({ key: "Y", status: BookingStatus.CONFIRMED, start: "2026-03-12T10:00", end: "2026-03-13T10:00", total: 34567, by: "online", branchId: other.id });
  // ── Previous window (29 Jan – 28 Feb) ─────────────────────────────────────
  const Pv = await mk({ key: "P", status: BookingStatus.RETURNED, start: "2026-02-10T10:00", end: "2026-02-11T10:00", total: 4000, by: "online", returnedAt: "2026-02-11T10:00" });

  await prisma.returnReceipt.create({ data: { publicId: `${P}_rr_h`, bookingId: H.id, createdAt: ist("2026-03-05T11:00") } });
  await prisma.cancellationInvoice.create({
    data: { publicId: `${P}_ci_d`, bookingId: D.id, customerId: customer.id, advanceAmount: 1000, cancellationFee: 500 },
  });

  let n = 0;
  const pay = async (bookingId: number, o: {
    purpose: PaymentPurpose; method: PaymentMethod; cash?: number; online?: number;
    gateway?: string | null; at: string; status?: PaymentTransactionStatus;
  }) => {
    n += 1;
    const cash = o.cash ?? 0;
    const online = o.online ?? 0;
    await prisma.paymentTransaction.create({
      data: {
        publicId: `${P}_pt${n}`, idempotencyKey: `${P}_idem${n}`, bookingId, branchId: branch.id,
        purpose: o.purpose, method: o.method, status: o.status ?? PaymentTransactionStatus.COLLECTED,
        totalAmount: cash + online, cashAmount: cash, onlineAmount: online,
        onlineGateway: o.gateway ?? null, collectedAt: ist(o.at), collectedById: staff.id,
      },
    });
  };
  await pay(A.id, { purpose: PaymentPurpose.FULL_PAYMENT, method: PaymentMethod.CASH, cash: 10000, at: "2026-03-11T10:30" });
  await pay(A.id, { purpose: PaymentPurpose.SAFETY_DEPOSIT, method: PaymentMethod.CASH, cash: 2000, at: "2026-03-10T10:00" }); // not revenue
  await pay(B.id, { purpose: PaymentPurpose.ADVANCE, method: PaymentMethod.ONLINE, online: 1000, gateway: null, at: "2026-03-14T20:00" }); // UPI
  await pay(C.id, { purpose: PaymentPurpose.ADVANCE, method: PaymentMethod.ONLINE, online: 3000, gateway: null, at: "2026-02-25T12:00" }); // prev window
  await pay(H.id, { purpose: PaymentPurpose.FULL_PAYMENT, method: PaymentMethod.SPLIT, cash: 100, online: 200, gateway: "razorpay", at: "2026-03-05T11:00" });
  await pay(T1.id, { purpose: PaymentPurpose.ADVANCE, method: PaymentMethod.ONLINE, online: 1000, gateway: "razorpay", at: "2026-02-28T23:00" }); // prev window (IST)
  await pay(Pv.id, { purpose: PaymentPurpose.FULL_PAYMENT, method: PaymentMethod.CASH, cash: 4000, at: "2026-02-11T10:00" });
  await pay(B.id, { purpose: PaymentPurpose.REMAINING_BALANCE, method: PaymentMethod.CASH, cash: 999, at: "2026-03-15T09:00", status: PaymentTransactionStatus.REJECTED }); // not collected

  const ext = (key: string, status: ExtensionStatus, createdAt: string) =>
    prisma.bookingExtension.create({
      data: {
        publicId: `${P}_ext_${key}`, bookingId: C.id, branchId: branch.id,
        extensionTrigger: ExtensionTrigger.EMPLOYEE_AT_PICKUP, extensionStatus: status,
        oldEndAt: ist("2026-03-21T10:00"), requestedEndAt: ist("2026-03-23T08:00"),
        additionalAmount: 1180, newTotalFinal: 8000, baseAmount: 1000, discountAmount: 0,
        taxableAmount: 1000, taxAmount: 180, cgstAmount: 90, sgstAmount: 90, taxRate: 18,
        actorId: staff.id, actorPublicId: staff.publicId, actorRole: "STAFF",
        createdAt: ist(createdAt),
      },
    });
  await ext("ok", ExtensionStatus.CONFIRMED, "2026-03-21T12:00");
  await ext("pending", ExtensionStatus.PENDING_PAYMENT, "2026-03-22T12:00");

  await prisma.refundRequest.create({
    data: {
      publicId: `${P}_rf1`, bookingId: A.id, branchId: branch.id, amount: 250, reason: "Overcharge",
      method: PaymentMethod.CASH, status: RefundStatus.COMPLETED, requestedById: staff.id,
      completedById: staff.id, completedAt: ist("2026-03-12T15:00"),
    },
  });
  await prisma.refundRequest.create({
    data: {
      publicId: `${P}_rf2`, bookingId: A.id, branchId: branch.id, amount: 999, reason: "Pending",
      method: PaymentMethod.CASH, status: RefundStatus.PENDING_APPROVAL, requestedById: staff.id,
    },
  });

  return { branch };
}

async function main() {
  console.log(`process TZ=${process.env.TZ ?? "(unset)"}  offset=${new Date().getTimezoneOffset()}`);
  const { branch } = await seed();
  const march = { from: "2026-03-01", to: "2026-03-31" };

  // ── Summary ────────────────────────────────────────────────────────────────
  const res = await call(GetPeriodReport, branch.id, { ...march, pageSize: "3", page: "2" });
  assert("summary status 200", res._status, 200);
  const data = res._json.data;
  const s = data.summary;
  assert("range", [data.range.from, data.range.to, data.range.days, data.range.groupBy], ["2026-03-01", "2026-03-31", 31, "day"]);
  assert("previous window", data.range.previous, { from: "2026-01-29", to: "2026-02-28" });
  assert("bookings (IST traps, startAt anchor, no HOLD/deleted/other branch)", s.bookings, 7);
  assert("bookingValue", s.bookingValue, 56800);
  assert("depositsInBookingValue", s.depositsInBookingValue, 1000);
  assert("averageBookingValue", s.averageBookingValue, 8114.29);
  assert("collected", s.collected, { total: 11300, cash: 10100, online: 1200, upi: 1000, gateway: 200, payments: 3 });
  assert("outstanding", [s.outstanding, s.outstandingBookings], [41500, 5]);
  assert("cancellations", s.cancellations, { count: 1, fees: 500 });
  assert("returns (returnedAt, else receipt date)", s.returns, { count: 2 });
  assert("extensions incl. GST split", s.extensions, {
    count: 1, amount: 1180, baseAmount: 1000, discountAmount: 0, taxableAmount: 1000,
    cgstAmount: 90, sgstAmount: 90, taxAmount: 180,
  });
  assert("refunds", s.refunds, { count: 1, amount: 250 });

  const p = data.previous;
  assert("previous bookings/value", [p.bookings, p.bookingValue], [1, 4000]);
  assert("previous collected (IST 28 Feb 23:00 counts in Feb)", p.collected.total, 8000);
  assert("previous returns", p.returns.count, 1);
  assert("change", [data.change.bookings, data.change.bookingValue, data.change.collected, data.change.cancellations], [600, 1320, 41.3, null]);

  const byType = Object.fromEntries(data.byRentalPeriod.map((r: any) => [r.type, [r.bookings, r.bookingValue]]));
  assert("byRentalPeriod (recomputed)", byType, {
    HOURLY: [1, 300], HALF_DAY: [2, 3500], FULL_DAY: [1, 10000], MULTI_DAY: [2, 13000], MONTHLY: [1, 30000],
  });
  assert("byRentalPeriod labels", data.byRentalPeriod.map((r: any) => r.label), ["Hourly", "12 hours", "1 day", "Multi-day", "Monthly"]);
  const bySrc = Object.fromEntries(data.bySource.map((r: any) => [r.source, [r.bookings, r.bookingValue]]));
  assert("bySource", bySrc, { ONLINE: [3, 15300], COUNTER: [4, 41500] });

  const sum = (rows: any[], k: string) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
  assert("Σ byRentalPeriod.bookingValue == summary", sum(data.byRentalPeriod, "bookingValue"), s.bookingValue);
  assert("Σ bySource.bookingValue == summary", sum(data.bySource, "bookingValue"), s.bookingValue);
  assert("trend buckets", data.trend.length, 31);
  assert("Σ trend.bookingValue == summary", sum(data.trend, "bookingValue"), s.bookingValue);
  assert("Σ trend.collected == summary", sum(data.trend, "collected"), s.collected.total);
  assert("Σ trend counts", [sum(data.trend, "bookings"), sum(data.trend, "cancellations"), sum(data.trend, "returns"), sum(data.trend, "extensions"), sum(data.trend, "refunds")], [7, 1, 2, 1, 1]);
  assert("trend first/last day", [data.trend[0].key, data.trend[0].bookingValue, data.trend[30].key, data.trend[30].bookingValue], ["2026-03-01", 5000, "2026-03-31", 1500]);

  // ── Bookings list (embedded page) ─────────────────────────────────────────
  const page = data.bookings;
  assert("list pagination", page.pagination, { page: 2, pageSize: 3, total: 8, totalPages: 3 });
  assert("list page 2 order (startAt desc)", page.rows.map((r: any) => r.publicId), [`${P}_D`, `${P}_B`, `${P}_A`]);
  assert("cancelled row balance 0", [page.rows[0].statusLabel, page.rows[0].balance], ["Cancelled", 0]);
  assert("walk-in row", [page.rows[1].source, page.rows[1].counterStaffName, page.rows[1].rentalPeriod, page.rows[1].rentalPeriodLabel, page.rows[1].paid, page.rows[1].balance], ["COUNTER", "Ravi Staff", "HALF_DAY", "12 hours", 1000, 1000]);
  assert("list totals", page.totals, { bookings: 8, total: 61800, paid: 15300, balance: 41500 });

  const multi = await call(GetPeriodBookings, branch.id, { ...march, rentalPeriod: "multi_day" });
  assert("filter rentalPeriod=MULTI_DAY", multi._json.data.rows.map((r: any) => r.publicId), [`${P}_C`, `${P}_T1`]);
  const online = await call(GetPeriodBookings, branch.id, { ...march, source: "ONLINE" });
  assert("filter source=ONLINE", online._json.data.pagination.total, 4);
  const conf = await call(GetPeriodBookings, branch.id, { ...march, status: "confirmed" });
  assert("filter status=confirmed (case-insensitive)", conf._json.data.pagination.total, 4);
  const search = await call(GetPeriodBookings, branch.id, { ...march, search: `${P}_t2`.toUpperCase() });
  assert("search by booking id", search._json.data.rows.map((r: any) => r.publicId), [`${P}_T2`]);
  const phone = await call(GetPeriodBookings, branch.id, { ...march, search: "0011111" });
  assert("search by phone", phone._json.data.pagination.total, 8);
  const beyond = await call(GetPeriodBookings, branch.id, { ...march, page: "9" });
  assert("page beyond end → empty rows", [beyond._json.data.rows.length, beyond._json.data.pagination.total], [0, 8]);

  // ── CSV ──────────────────────────────────────────────────────────────────
  const csv = await call(ExportPeriodReport, branch.id, { ...march });
  const lines = String(csv._send).trim().split("\n");
  assert("bookings CSV lines (header + 8 + total)", lines.length, 10);
  assert("bookings CSV header", lines[0], '"Booking ID","Customer","Phone","Vehicle","Reg No","Start (IST)","End (IST)","Rental Period","Source","Created By","Status","Extensions","Total","Paid","Balance"');
  assert("bookings CSV IST start of trap T1", lines.some((l) => l.includes(`"${P}_T1"`) && l.includes('"01-03-2026 00:10"')), true);
  assert("bookings CSV total row", lines[9]!.startsWith('"Total"') && lines[9]!.includes('"61800.00"'), true);
  assert("CSV filename", csv.headers["Content-Disposition"], `attachment; filename="period-period-verify-${P}-2026-03-01-to-2026-03-31-bookings.csv"`);
  const tcsv = await call(ExportPeriodReport, branch.id, { ...march, kind: "trend", groupBy: "week" });
  const tlines = String(tcsv._send).trim().split("\n");
  // 1 Mar 2026 is a Sunday → weeks: 1 Mar | 2–8 | 9–15 | 16–22 | 23–29 | 30–31
  assert("trend CSV lines (header + 6 weeks + total)", tlines.length, 8);
  assert("trend CSV total row", tlines[7]!.includes('"56800.00"'), true);

  // ── groupBy auto + ranges ─────────────────────────────────────────────────
  const r60 = await call(GetPeriodReport, branch.id, { from: "2026-01-01", to: "2026-03-01" });
  assert("auto groupBy 60 days → week", r60._json.data.range.groupBy, "week");
  const r366 = await call(GetPeriodReport, branch.id, { from: "2024-01-01", to: "2024-12-31", groupBy: "auto" });
  assert("366 days allowed → month buckets", [r366._status, r366._json.data.range.days, r366._json.data.trend.length], [200, 366, 12]);

  // ── Error contract ────────────────────────────────────────────────────────
  const err = async (name: string, branchId: number | undefined, q: Record<string, string>, status: number, code: string) => {
    const r = await call(GetPeriodReport, branchId, q);
    assert(`${name} → ${status} ${code}`, [r._status, r._json?.success, r._json?.code, typeof r._json?.message], [status, false, code, "string"]);
  };
  await err("367 days", branch.id, { from: "2024-01-01", to: "2025-01-01" }, 400, "PERIOD_RANGE_TOO_LONG");
  await err("from after to", branch.id, { from: "2026-03-10", to: "2026-03-01" }, 400, "INVALID_PERIOD_RANGE");
  await err("only from", branch.id, { from: "2026-03-10" }, 400, "INVALID_PERIOD_RANGE");
  await err("impossible date", branch.id, { from: "2026-02-30", to: "2026-03-01" }, 400, "INVALID_PERIOD_RANGE");
  await err("bad date format", branch.id, { from: "01/03/2026", to: "2026-03-31" }, 400, "INVALID_PERIOD_QUERY");
  await err("pageSize too big", branch.id, { ...march, pageSize: "500" }, 400, "INVALID_PERIOD_QUERY");
  await err("bad status", branch.id, { ...march, status: "HOLD" }, 400, "INVALID_PERIOD_QUERY");
  await err("no branch on token", undefined, march, 403, "BRANCH_NOT_ASSIGNED");
  const def = await call(GetPeriodReport, branch.id, {});
  assert("no dates → this month (IST) from the 1st", [def._status, def._json.data.range.from.endsWith("-01")], [200, true]);
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
