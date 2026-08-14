/**
 * Numeric verification of the admin reports against a known fixture.
 *
 * Requires a reachable Postgres pointed to by DATABASE_URL (use a throwaway DB).
 *   DATABASE_URL="postgresql://postgres:verify@localhost:5432/vrms_verify" \
 *     npx tsx src/scripts/verifyReportsAgainstFixture.ts
 *
 * Inserts hand-computable bookings/payments — including the createdAt-in-range
 * but startAt-out-of-range trap — then calls the ACTUAL controllers with mock
 * req/res and asserts the revenue numbers and cross-report invariants.
 */
import {
  prisma,
  BookingStatus,
  PaymentPurpose,
  PaymentMethod,
  PaymentTransactionStatus,
} from "@repo/database/client";
import { getGlobalKpiStats } from "../controller/admin/globalKpi.controller.js";
import { GetSalesReport } from "../controller/admin/salesReportController.js";
import { GetCollectionReport } from "../controller/admin/collectionReportController.js";
import { GetReceiptReport } from "../controller/admin/receiptReportController.js";

const d = (s: string) => new Date(s);
let failures = 0;
const assert = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: expected ${expected}, got ${actual}`);
};

const mockRes = () => {
  const r: any = {};
  r._json = null;
  r._status = 200;
  r.status = (c: number) => ((r._status = c), r);
  r.json = (x: any) => ((r._json = x), r);
  r.setHeader = () => r;
  r.send = (x: any) => ((r._send = x), r);
  return r;
};
const call = async (fn: any, query: any) => {
  const res = mockRes();
  await fn({ query } as any, res as any);
  if (res._status >= 400) throw new Error(`controller returned ${res._status}: ${JSON.stringify(res._json)}`);
  return res._json;
};

async function clearAll() {
  await prisma.paymentTransaction.deleteMany({});
  await prisma.bookingItem.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.vehicle.deleteMany({});
  await prisma.vehicleCategory.deleteMany({});
  await prisma.branch.deleteMany({});
}

async function seed() {
  const branch = await prisma.branch.create({
    data: { publicId: "br_1", name: "Central", address: "MG Road" },
  });
  const cat = await prisma.vehicleCategory.create({
    data: { publicId: "cat_1", name: "Bikes", rank: 1 },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      publicId: "veh_1", branchId: branch.id, categoryId: cat.id,
      make: "Honda", model: "Activa", regNo: "KA01AB1234", odo: 1000,
      insuranceExpiry: d("2026-12-31T00:00:00Z"),
    },
  });
  const user = await prisma.user.create({
    data: { publicId: "usr_1", name: "Asha", email: "asha@example.com", phone: "9000000001", role: "CUSTOMER", authProvider: "PASSWORD" },
  });
  const customer = await prisma.customer.create({
    data: { publicId: "cus_1", userId: user.id },
  });

  // Helper to create a booking + one item
  const mkBooking = async (opts: {
    pub: string; status: BookingStatus; startAt: string; endAt: string;
    createdAt: string; totalFinal: number; cgst: number; sgst: number;
  }) => {
    const b = await prisma.booking.create({
      data: {
        publicId: opts.pub, customerId: customer.id, branchId: branch.id,
        startAt: d(opts.startAt), endAt: d(opts.endAt), days: 1,
        totalBase: opts.totalFinal - opts.cgst - opts.sgst, totalDiscount: 0,
        totalDeposit: 0, totalTax: opts.cgst + opts.sgst, totalFinal: opts.totalFinal,
        status: opts.status, pricingSnapshot: {}, createdById: user.id,
        createdAt: d(opts.createdAt),
      },
    });
    await prisma.bookingItem.create({
      data: {
        bookingId: b.id, vehicleId: vehicle.id, days: 1,
        baseTotal: opts.totalFinal - opts.cgst - opts.sgst, discountAmount: 0,
        discountPercent: 0, deposit: 0, taxAmount: opts.cgst + opts.sgst,
        cgstAmount: opts.cgst, sgstAmount: opts.sgst, taxRate: 0, finalTotal: opts.totalFinal,
      },
    });
    return b;
  };

  // In-range revenue bookings (March 2026)
  const A = await mkBooking({ pub: "bk_A", status: BookingStatus.RETURNED, startAt: "2026-03-10T10:00:00Z", endAt: "2026-03-11T10:00:00Z", createdAt: "2026-03-09T10:00:00Z", totalFinal: 10000, cgst: 900, sgst: 900 });
  const B = await mkBooking({ pub: "bk_B", status: BookingStatus.PICKED_UP, startAt: "2026-03-15T10:00:00Z", endAt: "2026-03-16T10:00:00Z", createdAt: "2026-03-14T10:00:00Z", totalFinal: 20000, cgst: 1800, sgst: 1800 });
  const C = await mkBooking({ pub: "bk_C", status: BookingStatus.CONFIRMED, startAt: "2026-03-20T10:00:00Z", endAt: "2026-03-21T10:00:00Z", createdAt: "2026-03-19T10:00:00Z", totalFinal: 8000, cgst: 0, sgst: 0 });
  // Cancelled in range (shown, revenue 0, excluded from sums)
  await mkBooking({ pub: "bk_D", status: BookingStatus.CANCELLED, startAt: "2026-03-25T10:00:00Z", endAt: "2026-03-26T10:00:00Z", createdAt: "2026-03-24T10:00:00Z", totalFinal: 5000, cgst: 0, sgst: 0 });
  // Out of range (Feb startAt) — excluded
  await mkBooking({ pub: "bk_E", status: BookingStatus.RETURNED, startAt: "2026-02-20T10:00:00Z", endAt: "2026-02-21T10:00:00Z", createdAt: "2026-02-19T10:00:00Z", totalFinal: 99999, cgst: 0, sgst: 0 });
  // TRAP: createdAt in March, startAt in April — MUST be excluded (startAt anchor)
  await mkBooking({ pub: "bk_F", status: BookingStatus.RETURNED, startAt: "2026-04-05T10:00:00Z", endAt: "2026-04-06T10:00:00Z", createdAt: "2026-03-01T10:00:00Z", totalFinal: 77777, cgst: 0, sgst: 0 });
  // HOLD in range — not a revenue status, excluded
  await mkBooking({ pub: "bk_G", status: BookingStatus.HOLD, startAt: "2026-03-12T10:00:00Z", endAt: "2026-03-13T10:00:00Z", createdAt: "2026-03-11T10:00:00Z", totalFinal: 12345, cgst: 0, sgst: 0 });

  // Collections (payment-date anchored). A: cash 10000 on 3-12. B: online/gateway 5000 on 3-15.
  await prisma.paymentTransaction.create({
    data: {
      publicId: "pt_A", idempotencyKey: "idem_A", bookingId: A.id, branchId: branch.id,
      purpose: PaymentPurpose.FULL_PAYMENT, method: PaymentMethod.CASH, status: PaymentTransactionStatus.COLLECTED,
      totalAmount: 10000, cashAmount: 10000, onlineAmount: 0, collectedAt: d("2026-03-12T10:00:00Z"), collectedById: user.id,
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      publicId: "pt_B", idempotencyKey: "idem_B", bookingId: B.id, branchId: branch.id,
      purpose: PaymentPurpose.ADVANCE, method: PaymentMethod.ONLINE, status: PaymentTransactionStatus.COLLECTED,
      totalAmount: 5000, cashAmount: 0, onlineAmount: 5000, onlineGateway: "razorpay",
      onlineTransactionRef: "rzp_123", collectedAt: d("2026-03-15T10:00:00Z"), collectedById: user.id,
    },
  });
}

async function main() {
  await clearAll();
  await seed();

  const range = { startDate: "2026-03-01", endDate: "2026-03-31" };

  console.log("\n--- Expected revenue (March, startAt anchor) = A+B+C = 38000 ---");
  const kpi = await call(getGlobalKpiStats, range);
  assert("dashboard revenue (startAt anchor, excludes createdAt-trap/Feb/cancel/hold)", kpi.revenueThisMonth.current, 38000);
  assert("dashboard pending revenue (confirmed C, unpaid)", kpi.pendingRevenue.amount, 8000);
  assert("dashboard pending count", kpi.pendingRevenue.count, 1);

  const sales = await call(GetSalesReport, range);
  assert("sales summary.totalRevenue", sales.data.summary.totalRevenue, 38000);
  assert("INVARIANT sales==dashboard revenue", sales.data.summary.totalRevenue, kpi.revenueThisMonth.current);
  // Cancelled booking D appears in table but with revenue 0
  const dRow = sales.data.data.find((r: any) => r.bookingId === "bk_D");
  assert("cancelled D shown in sales table", Boolean(dRow), true);
  assert("cancelled D revenue == 0", dRow?.financial.revenue, 0);

  const collection = await call(GetCollectionReport, range);
  const cs = collection.data?.summary ?? collection.summary;
  assert("collection grand total (cash 10000 + gateway 5000)", cs.grandTotalCollected, 15000);
  assert("collection total cash", cs.totalCash, 10000);
  assert("collection total gateway (razorpay)", cs.totalGateway, 5000);
  assert("collection total upi", cs.totalUpi, 0);

  const receipt = await call(GetReceiptReport, range);
  const rs = receipt.data?.summary ?? receipt.summary;
  const receiptTotal = rs?.totalAmountReceived ?? rs?.totalReceived ?? rs?.grandTotal;
  assert("INVARIANT receipt total == collection total", receiptTotal, 15000);

  console.log(`\n${failures === 0 ? "ALL NUMERIC CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
