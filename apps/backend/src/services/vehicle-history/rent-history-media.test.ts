/**
 * Pure checks of the rent-history media rules and the vehicle delete guard
 * (Nov 14 2026). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { damageNoteView, damagePaymentStatus, vehicleMediaScope } from "./rent-history-media.js";
import { bookingsBlockingDelete, vehicleDeleteBlockedMessage } from "./vehicle-delete.js";

const at = (h: number) => new Date(Date.UTC(2026, 10, 14, h));

test("no swap: the booking's car has the pickup photos, and the drop photos once returned", () => {
  assert.deepEqual(vehicleMediaScope({ vehicleId: 1, itemVehicleIds: [1], midSwaps: [], returned: true }), {
    pickup: true,
    swapIds: [],
    drop: true,
  });
  assert.deepEqual(vehicleMediaScope({ vehicleId: 1, itemVehicleIds: [1], midSwaps: [], returned: false }), {
    pickup: true,
    swapIds: [],
    drop: false,
  });
});

test("one mid-rental swap: the old car keeps the pickup photos, the new car the swap photos and the drop", () => {
  const midSwaps = [{ id: 9, originalVehicleId: 1, newVehicleId: 2, swappedAt: at(10) }];
  assert.deepEqual(vehicleMediaScope({ vehicleId: 1, itemVehicleIds: [2], midSwaps, returned: true }), {
    pickup: true,
    swapIds: [],
    drop: false,
  });
  assert.deepEqual(vehicleMediaScope({ vehicleId: 2, itemVehicleIds: [2], midSwaps, returned: true }), {
    pickup: false,
    swapIds: [9],
    drop: true,
  });
});

test("two swaps: the middle car has only its swap photos; swapped back = both handovers and the drop", () => {
  const midSwaps = [
    { id: 12, originalVehicleId: 2, newVehicleId: 3, swappedAt: at(12) },
    { id: 11, originalVehicleId: 1, newVehicleId: 2, swappedAt: at(10) },
  ];
  assert.deepEqual(vehicleMediaScope({ vehicleId: 2, itemVehicleIds: [3], midSwaps, returned: true }), {
    pickup: false,
    swapIds: [11],
    drop: false,
  });
  const back = [
    { id: 21, originalVehicleId: 1, newVehicleId: 2, swappedAt: at(10) },
    { id: 22, originalVehicleId: 2, newVehicleId: 1, swappedAt: at(12) },
  ];
  assert.deepEqual(vehicleMediaScope({ vehicleId: 1, itemVehicleIds: [1], midSwaps: back, returned: true }), {
    pickup: true,
    swapIds: [22],
    drop: true,
  });
});

test("damageNoteView reads drop-damage notes, plain strings and junk", () => {
  assert.deepEqual(
    damageNoteView({
      area: "Front bumper",
      description: "Scratch",
      source: "DROP",
      damages: [{ area: "Front bumper", severity: "Minor", description: "Scratch", photos: [] }, null, {}],
    }),
    { area: "Front bumper", description: "Scratch", items: [{ area: "Front bumper", severity: "Minor", description: "Scratch" }] },
  );
  assert.deepEqual(damageNoteView("dent on door"), { area: null, description: "dent on door", items: [] });
  assert.deepEqual(damageNoteView(null), { area: null, description: null, items: [] });
  assert.deepEqual(damageNoteView([1, 2]), { area: null, description: null, items: [] });
  assert.equal(damageNoteView({ notes: " old style " }).description, "old style");
});

test("damagePaymentStatus", () => {
  const base = { status: "PENDING" as const, amount: 500, billedOnCompletedDrop: false };
  assert.equal(damagePaymentStatus({ ...base, billing: "COMPANY" }), "COMPANY_EXPENSE");
  assert.equal(damagePaymentStatus({ ...base, billing: "DROP" }), "ON_DROP_BILL");
  assert.equal(damagePaymentStatus({ ...base, billing: "DROP", billedOnCompletedDrop: true }), "PAID");
  assert.equal(damagePaymentStatus({ ...base, billing: "MANAGER" }), "AWAITING_REVIEW");
  assert.equal(damagePaymentStatus({ ...base, billing: null, status: "APPROVED" }), "CHARGED");
  assert.equal(damagePaymentStatus({ ...base, billing: null, status: "APPROVED", amount: 0 }), "NOT_CHARGED");
  assert.equal(damagePaymentStatus({ ...base, billing: "MANAGER", status: "REJECTED" }), "NOT_CHARGED");
});

test("delete guard: live holds, confirmed and picked-up bookings block; expired holds don't", () => {
  const now = at(12);
  const rows = [
    { publicId: "aaaaaaaaHOLDLIVE", status: "HOLD" as const, holdExpiresAt: at(13) },
    { publicId: "aaaaaaaaHOLDGONE", status: "HOLD" as const, holdExpiresAt: at(11) },
    { publicId: "aaaaaaaaHOLDNULL", status: "HOLD" as const, holdExpiresAt: null },
    { publicId: "bbbbbbbbconfirm1", status: "CONFIRMED" as const, holdExpiresAt: null },
    { publicId: "ccccccccpickedup", status: "PICKED_UP" as const, holdExpiresAt: null },
  ];
  const blocking = bookingsBlockingDelete(rows, now);
  assert.deepEqual(
    blocking.map((b) => b.publicId),
    ["aaaaaaaaHOLDLIVE", "aaaaaaaaHOLDNULL", "bbbbbbbbconfirm1", "ccccccccpickedup"],
  );
  assert.equal(vehicleDeleteBlockedMessage("KA01AB1234", []), null);
  const msg = vehicleDeleteBlockedMessage("KA01AB1234", blocking)!;
  assert.match(msg, /^Can't delete KA01AB1234: it is out on rent \(#PICKEDUP\) and it has 3 upcoming bookings/);
  assert.match(msg, /those bookings/);
  const one = vehicleDeleteBlockedMessage("KA01", [rows[3]!])!;
  assert.equal(
    one,
    "Can't delete KA01: it has 1 upcoming booking (#CONFIRM1). Complete, cancel or swap that booking to another vehicle first.",
  );
});
