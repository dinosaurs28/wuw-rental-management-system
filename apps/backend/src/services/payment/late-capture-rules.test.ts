/**
 * Pure checks of the late-capture guard (Nov 2026): a Razorpay payment that
 * lands on a HOLD_EXPIRED booking confirms only when its cars are still free
 * and the customer hasn't booked again; otherwise it goes to the refund path.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lateCaptureLogReason, lateCaptureRefusal, needsLateCaptureCheck, rebookingsOf } from "./late-capture-rules.js";

test("only gateway payments on HOLD_EXPIRED bookings are re-checked", () => {
  assert.equal(needsLateCaptureCheck({ status: "HOLD_EXPIRED" }, true), true);
  // A live hold is its own reservation — unchanged
  assert.equal(needsLateCaptureCheck({ status: "HOLD" }, true), false);
  // Counter payments keep their own HOLD_EXPIRED rule (staff re-create)
  assert.equal(needsLateCaptureCheck({ status: "HOLD_EXPIRED" }, false), false);
  assert.equal(needsLateCaptureCheck({ status: "CANCELLED" }, true), false);
});

test("cars still free and no re-booking → confirm", () => {
  assert.equal(
    lateCaptureRefusal({ vehicleIds: [1, 2], blockedVehicleIds: new Set([9]), overlappingCustomerBookings: [] }),
    null,
  );
});

test("a car taken since the hold lapsed → refund, naming the car", () => {
  const r = lateCaptureRefusal({ vehicleIds: [1, 2], blockedVehicleIds: new Set([2]), overlappingCustomerBookings: [] });
  assert.deepEqual(r, { reason: "VEHICLE_TAKEN", vehicleIds: [2], bookingPublicIds: [] });
  assert.match(lateCaptureLogReason(r!), /vehicle\(s\) 2 no longer free/);
});

test("customer already re-booked the window → refund (wins over a taken car)", () => {
  const r = lateCaptureRefusal({ vehicleIds: [1], blockedVehicleIds: new Set([1]), overlappingCustomerBookings: ["bk_new"] });
  assert.equal(r?.reason, "CUSTOMER_REBOOKED");
  assert.deepEqual(r?.bookingPublicIds, ["bk_new"]);
  assert.match(lateCaptureLogReason(r!), /customer already re-booked \(bk_new\)/);
});

test("re-book = a LATER overlapping booking for the same kind of vehicle", () => {
  const t0 = new Date("2026-11-14T10:00:00Z");
  const later = new Date("2026-11-14T10:15:00Z");
  const earlier = new Date("2026-11-14T09:00:00Z");
  const car = { categoryId: 3, typeClass: "FOUR_WHEELER" };
  const otherCar = { categoryId: 4, typeClass: "FOUR_WHEELER" };
  const scooter = { categoryId: 7, typeClass: "TWO_WHEELER" };
  const mine = { createdAt: t0, vehicles: [car] };
  // Same category, booked after → re-book
  assert.deepEqual(rebookingsOf(mine, [{ publicId: "a", createdAt: later, vehicles: [car] }]), ["a"]);
  // Another car of the same type class, booked after → re-book
  assert.deepEqual(rebookingsOf(mine, [{ publicId: "b", createdAt: later, vehicles: [otherCar] }]), ["b"]);
  // Booked before this one (two cars at once) → not a re-book
  assert.deepEqual(rebookingsOf(mine, [{ publicId: "c", createdAt: earlier, vehicles: [car] }]), []);
  // A scooter alongside the car → not a re-book
  assert.deepEqual(rebookingsOf(mine, [{ publicId: "d", createdAt: later, vehicles: [scooter] }]), []);
  // OTHER type class only matches on the same category
  const misc = { createdAt: t0, vehicles: [{ categoryId: 9, typeClass: "OTHER" }] };
  assert.deepEqual(rebookingsOf(misc, [{ publicId: "e", createdAt: later, vehicles: [{ categoryId: 10, typeClass: "OTHER" }] }]), []);
  assert.deepEqual(rebookingsOf(misc, [{ publicId: "f", createdAt: later, vehicles: [{ categoryId: 9, typeClass: "OTHER" }] }]), ["f"]);
});
