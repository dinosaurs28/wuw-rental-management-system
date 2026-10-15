/**
 * Pure checks of the pickup guard taken under the booking row lock shared with
 * the branch manager's manual cancel: only a CONFIRMED booking is handed over;
 * one cancelled meanwhile is refused with 409 BOOKING_CANCELLED. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PickupStateError, cancelledPickupRefusal, pickupStateRefusal } from "./booking-row-lock.js";

test("a CONFIRMED booking can be handed over", () => {
  assert.equal(pickupStateRefusal({ status: "CONFIRMED", cancellationSource: null }), null);
});

test("cancelled by the branch manager → 409 BOOKING_CANCELLED 'cancelled by the branch'", () => {
  const err = pickupStateRefusal({ status: "CANCELLED", cancellationSource: "MANUAL_BM" });
  assert.ok(err instanceof PickupStateError);
  assert.equal(err.status, 409);
  assert.equal(err.code, "BOOKING_CANCELLED");
  assert.equal(err.message, "This booking was cancelled by the branch.");
  assert.deepEqual(err.toJSON(), {
    success: false,
    code: "BOOKING_CANCELLED",
    message: "This booking was cancelled by the branch.",
    bookingStatus: "CANCELLED",
  });
});

test("cancelled another way (no-show, displaced) → BOOKING_CANCELLED without 'by the branch'", () => {
  const err = pickupStateRefusal({ status: "CANCELLED", cancellationSource: null });
  assert.equal(err?.code, "BOOKING_CANCELLED");
  assert.equal(err?.message, "This booking was cancelled.");
});

test("already picked up, or any other status → 409 BOOKING_NOT_CONFIRMED", () => {
  const picked = pickupStateRefusal({ status: "PICKED_UP", cancellationSource: null });
  assert.equal(picked?.status, 409);
  assert.equal(picked?.code, "BOOKING_NOT_CONFIRMED");
  assert.match(picked!.message, /already been picked up/);
  for (const status of ["HOLD", "RETURNED", "HOLD_EXPIRED"]) {
    const err = pickupStateRefusal({ status, cancellationSource: null });
    assert.equal(err?.code, "BOOKING_NOT_CONFIRMED", status);
    assert.equal(err?.bookingStatus, status);
  }
});

test("a missing row is refused too", () => {
  const err = pickupStateRefusal(null);
  assert.equal(err?.code, "BOOKING_NOT_CONFIRMED");
  assert.equal(err?.bookingStatus, null);
});

test("up-front check: only a cancelled booking is answered with BOOKING_CANCELLED", () => {
  assert.equal(cancelledPickupRefusal({ status: "CANCELLED", cancellationSource: "MANUAL_BM" })?.code, "BOOKING_CANCELLED");
  for (const status of ["CONFIRMED", "PICKED_UP", "HOLD", "RETURNED"]) {
    assert.equal(cancelledPickupRefusal({ status, cancellationSource: null }), null, status);
  }
});
