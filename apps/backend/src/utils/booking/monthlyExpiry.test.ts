/**
 * Monthly rental expiry reminder (client TODO item 6): the 5-day window, the
 * dedupe key, the scan loop's once-only behaviour and a renewal re-arming it.
 * No database — the scan runs against an in-memory notification store that
 * enforces the (userId, dedupeKey) unique key like Postgres does.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONTHLY_EXPIRY_NOTICE_MS,
  isMonthlyExpiryDue,
  isMonthlyExpiryStatus,
  monthlyExpiryCandidateWhere,
  monthlyExpiryDedupeKey,
  monthlyExpiryMessage,
  monthlyExpiryVehicleLabel,
  needsMonthlyExpiryReminder,
  scanMonthlyExpiry,
  type MonthlyExpiryBooking,
} from "./monthlyExpiry.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-23T04:30:00.000Z"); // 10:00 IST

test("window: endAt − now ≤ 5 days and endAt > now", () => {
  assert.equal(MONTHLY_EXPIRY_NOTICE_MS, 5 * DAY);
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() + 5 * DAY), NOW), true, "exactly 5 days");
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() + 5 * DAY + 1), NOW), false, "just over 5 days");
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() + 4 * DAY), NOW), true, "4 days (after downtime)");
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() + 1000), NOW), true, "a second left");
  assert.equal(isMonthlyExpiryDue(NOW, NOW), false, "ends now");
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() - HOUR), NOW), false, "already ended");
  assert.equal(isMonthlyExpiryDue(new Date(NOW.getTime() + 20 * DAY), NOW), false, "far away");
});

test("candidate where mirrors the window, statuses and the monthly rule", () => {
  const where = monthlyExpiryCandidateWhere(NOW);
  assert.equal(where.rentalPeriodType, "MONTHLY");
  assert.equal(where.deletedAt, null);
  assert.deepEqual(where.endAt, { gt: NOW, lte: new Date(NOW.getTime() + 5 * DAY) });
  assert.deepEqual(where.OR, [
    { status: "CONFIRMED" },
    { status: "PICKED_UP", requiresManagerConfirmation: false },
  ]);
});

test("statuses: CONFIRMED and PICKED_UP still out; never a car handed back or closed", () => {
  assert.equal(isMonthlyExpiryStatus("CONFIRMED", false), true);
  assert.equal(isMonthlyExpiryStatus("CONFIRMED", true), true, "pickup awaiting manager");
  assert.equal(isMonthlyExpiryStatus("PICKED_UP", false), true);
  assert.equal(isMonthlyExpiryStatus("PICKED_UP", true), false, "drop awaiting manager");
  for (const s of ["RETURNED", "CANCELLED", "HOLD", "PENDING"]) assert.equal(isMonthlyExpiryStatus(s, false), false, s);
});

const booking = (over: Partial<MonthlyExpiryBooking> = {}): MonthlyExpiryBooking => ({
  id: 1,
  publicId: "bk_monthly_1",
  endAt: new Date(NOW.getTime() + 5 * DAY - HOUR),
  status: "PICKED_UP",
  rentalPeriodType: "MONTHLY",
  requiresManagerConfirmation: false,
  ...over,
});

test("needsMonthlyExpiryReminder: monthly only — a 30-day standard booking never", () => {
  assert.equal(needsMonthlyExpiryReminder(booking(), NOW), true);
  assert.equal(needsMonthlyExpiryReminder(booking({ rentalPeriodType: "MULTI_DAY" }), NOW), false);
  assert.equal(needsMonthlyExpiryReminder(booking({ rentalPeriodType: null }), NOW), false);
  assert.equal(needsMonthlyExpiryReminder(booking({ status: "RETURNED" }), NOW), false);
  assert.equal(needsMonthlyExpiryReminder(booking({ endAt: new Date(NOW.getTime() + 6 * DAY) }), NOW), false);
});

test("dedupe key carries the endAt it was for", () => {
  const end = new Date("2026-10-28T04:30:00.000Z");
  assert.equal(monthlyExpiryDedupeKey("bk1", end), "monthly-expiry:bk1:2026-10-28T04:30:00.000Z");
  assert.notEqual(
    monthlyExpiryDedupeKey("bk1", end),
    monthlyExpiryDedupeKey("bk1", new Date(end.getTime() + 30 * DAY)),
  );
  assert.notEqual(monthlyExpiryDedupeKey("bk1", end), monthlyExpiryDedupeKey("bk2", end));
});

test("message text", () => {
  const vehicleLabel = monthlyExpiryVehicleLabel({ make: "Maruti", model: "Swift", regNo: "KA01AB1234" });
  assert.equal(vehicleLabel, "Maruti Swift (KA01AB1234)");
  assert.equal(monthlyExpiryVehicleLabel(null), "the vehicle");
  const msg = monthlyExpiryMessage({ vehicleLabel, customerName: "Asha Rao", endAtLabel: "28 Oct 2026, 10:00 AM" });
  assert.equal(
    msg.body,
    "The monthly rental for Maruti Swift (KA01AB1234) booked by Asha Rao expires on 28 Oct 2026, 10:00 AM. Please contact the customer regarding renewal.",
  );
  assert.ok(msg.title.length > 0);
});

/**
 * In-memory stand-in for notify(): one row per (userId, dedupeKey), extra
 * inserts skipped (createMany skipDuplicates). Branch → recipient users.
 */
function fakeStore(recipientsByBooking: Record<number, number[]>) {
  const rows = new Map<string, { userId: number; bookingId: number; dedupeKey: string }>();
  const pushes: Array<{ userId: number; dedupeKey: string }> = [];
  let bookings: MonthlyExpiryBooking[] = [];
  const deps = {
    findCandidates: async (now: Date) => bookings.filter((b) => needsMonthlyExpiryReminder(b, now)),
    alreadyNotified: async (bookingId: number, dedupeKey: string) =>
      [...rows.values()].some((r) => r.bookingId === bookingId && r.dedupeKey === dedupeKey),
    send: async (b: MonthlyExpiryBooking) => {
      const dedupeKey = monthlyExpiryDedupeKey(b.publicId, b.endAt);
      let created = 0;
      for (const userId of recipientsByBooking[b.id] ?? []) {
        const k = `${userId}|${dedupeKey}`;
        if (rows.has(k)) continue;
        rows.set(k, { userId, bookingId: b.id, dedupeKey });
        pushes.push({ userId, dedupeKey });
        created++;
      }
      return created;
    },
  };
  return {
    deps,
    rows,
    pushes,
    setBookings: (next: MonthlyExpiryBooking[]) => {
      bookings = next;
    },
  };
}

test("scan: sends once, a second run (or restart) sends nothing", async () => {
  const store = fakeStore({ 1: [10, 11, 20] }); // 2 FEs + 1 BM of branch A
  store.setBookings([booking()]);
  const first = await scanMonthlyExpiry(NOW, store.deps);
  assert.deepEqual(first.notified, ["bk_monthly_1"]);
  assert.equal(store.rows.size, 3);
  assert.equal(store.pushes.length, 3);

  const second = await scanMonthlyExpiry(new Date(NOW.getTime() + 15 * 60 * 1000), store.deps);
  assert.deepEqual(second.notified, []);
  assert.equal(second.alreadySent, 1);
  assert.equal(store.rows.size, 3);
  assert.equal(store.pushes.length, 3);
});

test("scan: two instances racing still create one row per recipient", async () => {
  const store = fakeStore({ 1: [10, 20] });
  store.setBookings([booking()]);
  await Promise.all([scanMonthlyExpiry(NOW, store.deps), scanMonthlyExpiry(NOW, store.deps)]);
  assert.equal(store.rows.size, 2);
  assert.equal(store.pushes.length, 2);
});

test("scan: nothing before the window, sent after downtime inside it, nothing once ended", async () => {
  const end = new Date(NOW.getTime() + 8 * DAY);
  const store = fakeStore({ 1: [10] });
  store.setBookings([booking({ endAt: end })]);
  assert.deepEqual((await scanMonthlyExpiry(NOW, store.deps)).notified, []);
  // The job was down until 2 days before the end: still reminded, once
  const late = new Date(end.getTime() - 2 * DAY);
  assert.deepEqual((await scanMonthlyExpiry(late, store.deps)).notified, ["bk_monthly_1"]);
  assert.deepEqual((await scanMonthlyExpiry(new Date(late.getTime() + HOUR), store.deps)).notified, []);
  // A rental that already ended without a reminder is not reminded
  const ended = fakeStore({ 1: [10] });
  ended.setBookings([booking({ endAt: end })]);
  assert.deepEqual((await scanMonthlyExpiry(new Date(end.getTime() + HOUR), ended.deps)).notified, []);
});

test("scan: a renewal that moves endAt re-arms the reminder for the new end", async () => {
  const store = fakeStore({ 1: [10, 20] });
  const firstEnd = new Date(NOW.getTime() + 4 * DAY);
  store.setBookings([booking({ endAt: firstEnd })]);
  await scanMonthlyExpiry(NOW, store.deps);
  assert.equal(store.pushes.length, 2);

  // Renewed for another month: nothing until the new end is 5 days away
  const renewedEnd = new Date(firstEnd.getTime() + 30 * DAY);
  store.setBookings([booking({ endAt: renewedEnd })]);
  assert.deepEqual((await scanMonthlyExpiry(new Date(NOW.getTime() + DAY), store.deps)).notified, []);
  const nearNewEnd = new Date(renewedEnd.getTime() - 5 * DAY);
  assert.deepEqual((await scanMonthlyExpiry(nearNewEnd, store.deps)).notified, ["bk_monthly_1"]);
  assert.equal(store.pushes.length, 4);
  assert.deepEqual(
    [...new Set(store.pushes.map((p) => p.dedupeKey))],
    [monthlyExpiryDedupeKey("bk_monthly_1", firstEnd), monthlyExpiryDedupeKey("bk_monthly_1", renewedEnd)],
  );
  // and only once for the new end too
  assert.deepEqual((await scanMonthlyExpiry(new Date(nearNewEnd.getTime() + HOUR), store.deps)).notified, []);
});

test("scan: daily bookings and other statuses are ignored even if a query returned them", async () => {
  const store = fakeStore({ 1: [10], 2: [10], 3: [10] });
  const deps = {
    ...store.deps,
    findCandidates: async () => [
      booking({ id: 2, publicId: "bk_daily", rentalPeriodType: "MULTI_DAY" }),
      booking({ id: 3, publicId: "bk_returned", status: "RETURNED" }),
    ],
  };
  const result = await scanMonthlyExpiry(NOW, deps);
  assert.deepEqual(result.notified, []);
  assert.equal(store.rows.size, 0);
});
