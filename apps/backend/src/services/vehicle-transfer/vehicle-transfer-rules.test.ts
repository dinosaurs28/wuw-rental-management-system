/**
 * Pure checks of the vehicle branch transfer (Nov 14 2026). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VehicleTransferError,
  isUpcomingBooking,
  parseTransferBody,
  transferRefusal,
  withoutId,
  type TransferState,
} from "./vehicle-transfer-rules.js";

const base = (over: Partial<TransferState> = {}): TransferState => ({
  vehicle: { branchId: 1, status: "AVAILABLE", deletedAt: null, odo: 1000 },
  actor: { role: "ADMIN", branchId: null },
  target: { id: 2, deletedAt: null },
  onRentBookingPublicId: null,
  upcomingBookings: [],
  openBillCount: 0,
  openDraftCount: 0,
  pendingDropDamage: false,
  odometer: null,
  ...over,
});

const code = (s: TransferState) => transferRefusal(s)?.code ?? null;

test("parseTransferBody: valid body, odometer optional", () => {
  assert.deepEqual(parseTransferBody({ toBranchId: " b2 ", reason: "  Demand at Manipal " }), {
    toBranchId: "b2",
    reason: "Demand at Manipal",
    odometer: null,
  });
  assert.deepEqual(parseTransferBody({ toBranchId: "b2", reason: "Move", odometer: "1500" }), {
    toBranchId: "b2",
    reason: "Move",
    odometer: 1500,
  });
  assert.equal((parseTransferBody({ toBranchId: "b2", reason: "Move", odometer: "" }) as any).odometer, null);
});

test("parseTransferBody: refuses missing branch, short reason, bad odometer", () => {
  for (const body of [
    {},
    { reason: "Long enough" },
    { toBranchId: "b2" },
    { toBranchId: "b2", reason: "ab" },
    { toBranchId: "b2", reason: "x".repeat(501) },
    { toBranchId: "b2", reason: "Move", odometer: -1 },
    { toBranchId: "b2", reason: "Move", odometer: 12.5 },
    { toBranchId: "b2", reason: "Move", odometer: "abc" },
    null,
  ]) {
    const r = parseTransferBody(body);
    assert.ok(r instanceof VehicleTransferError, JSON.stringify(body));
    assert.equal(r.status, 400);
    assert.equal(r.code, "INVALID_INPUT");
  }
});

test("transferRefusal: a free car can move (admin and own-branch manager)", () => {
  assert.equal(transferRefusal(base()), null);
  assert.equal(transferRefusal(base({ actor: { role: "MANAGER", branchId: 1 } })), null);
  assert.equal(transferRefusal(base({ vehicle: { branchId: 1, status: "INACTIVE", deletedAt: null, odo: 0 } })), null);
  assert.equal(transferRefusal(base({ odometer: 1000 })), null);
});

test("transferRefusal: access and target branch", () => {
  assert.equal(code(base({ vehicle: null })), "VEHICLE_NOT_FOUND");
  assert.equal(code(base({ vehicle: { branchId: 1, status: "AVAILABLE", deletedAt: new Date(), odo: 0 } })), "VEHICLE_NOT_FOUND");
  const other = transferRefusal(base({ actor: { role: "MANAGER", branchId: 9 } }));
  assert.equal(other?.code, "VEHICLE_NOT_IN_BRANCH");
  assert.equal(other?.status, 403);
  assert.equal(code(base({ target: null })), "TARGET_BRANCH_NOT_FOUND");
  assert.equal(code(base({ target: { id: 2, deletedAt: new Date() } })), "TARGET_BRANCH_INACTIVE");
  const same = transferRefusal(base({ target: { id: 1, deletedAt: null } }));
  assert.equal(same?.code, "SAME_BRANCH");
  assert.equal(same?.status, 409);
});

test("transferRefusal: busy car is refused with 409", () => {
  const cases: Array<[Partial<TransferState>, string]> = [
    [{ onRentBookingPublicId: "BK1" }, "VEHICLE_ON_RENT"],
    [{ vehicle: { branchId: 1, status: "OUT_FOR_RENTAL", deletedAt: null, odo: 0 } }, "VEHICLE_ON_RENT"],
    [{ upcomingBookings: [{ publicId: "BK2", status: "CONFIRMED", startAt: new Date("2026-11-20T04:30:00Z") }] }, "VEHICLE_HAS_BOOKINGS"],
    [{ vehicle: { branchId: 1, status: "MAINTENANCE", deletedAt: null, odo: 0 } }, "VEHICLE_IN_MAINTENANCE"],
    [{ vehicle: { branchId: 1, status: "MANAGER_REPORTED", deletedAt: null, odo: 0 } }, "DAMAGE_REVIEW_PENDING"],
    [{ pendingDropDamage: true }, "DAMAGE_REVIEW_PENDING"],
    [{ openBillCount: 1 }, "OPERATION_UNSETTLED"],
    [{ openDraftCount: 1 }, "OPERATION_UNSETTLED"],
  ];
  for (const [over, expected] of cases) {
    const r = transferRefusal(base(over));
    assert.equal(r?.code, expected, JSON.stringify(over));
    assert.equal(r?.status, 409);
  }
  const msg = transferRefusal(base({
    upcomingBookings: [
      { publicId: "BK2", status: "CONFIRMED", startAt: new Date("2026-11-20T04:30:00Z") },
      { publicId: "BK3", status: "HOLD", startAt: new Date("2026-11-22T04:30:00Z") },
    ],
  }));
  assert.match(msg!.message, /2 upcoming bookings \(next: BK2/);
  assert.deepEqual((msg!.toJSON() as Record<string, unknown>).bookingIds, ["BK2", "BK3"]);
});

test("transferRefusal: access is checked before the car's state; odometer last", () => {
  assert.equal(code(base({ actor: { role: "MANAGER", branchId: 9 }, onRentBookingPublicId: "BK1" })), "VEHICLE_NOT_IN_BRANCH");
  assert.equal(code(base({ target: { id: 1, deletedAt: null }, onRentBookingPublicId: "BK1" })), "SAME_BRANCH");
  assert.equal(code(base({ odometer: 999 })), "ODOMETER_BELOW_CURRENT");
  assert.equal(code(base({ odometer: 999, openBillCount: 1 })), "OPERATION_UNSETTLED");
});

test("isUpcomingBooking: HOLD not lapsed / CONFIRMED that hasn't ended", () => {
  const now = new Date("2026-11-14T06:00:00Z");
  const later = new Date("2026-11-15T06:00:00Z");
  const earlier = new Date("2026-11-13T06:00:00Z");
  assert.equal(isUpcomingBooking({ status: "CONFIRMED", endAt: later, holdExpiresAt: null }, now), true);
  assert.equal(isUpcomingBooking({ status: "CONFIRMED", endAt: earlier, holdExpiresAt: null }, now), false);
  assert.equal(isUpcomingBooking({ status: "HOLD", endAt: later, holdExpiresAt: null }, now), true);
  assert.equal(isUpcomingBooking({ status: "HOLD", endAt: later, holdExpiresAt: later }, now), true);
  assert.equal(isUpcomingBooking({ status: "HOLD", endAt: later, holdExpiresAt: earlier }, now), false);
  for (const status of ["PICKED_UP", "RETURNED", "CANCELLED", "HOLD_EXPIRED"]) {
    assert.equal(isUpcomingBooking({ status, endAt: later, holdExpiresAt: null }, now), false);
  }
});

test("withoutId", () => {
  assert.deepEqual(withoutId([1, 2, 3], 2), [1, 3]);
  assert.equal(withoutId([1, 3], 2), null);
});
