/**
 * Pure checks of the completed pickups / returns kept in the Fleet queues
 * (client item 1): queue state, the includeCompleted flag, which day / tab a
 * completed row belongs to, who completed it and when, and the order.
 * No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityMarkerKind,
  completedPickupWhere,
  completedReturnWhere,
  onQueueDay,
  parseIncludeCompleted,
  pendingOnlyWhere,
  pickCompletion,
  pickupQueueState,
  returnQueueState,
  sortCompletedQueue,
  type CompletionMarker,
} from "./completedQueue.js";

const at = (iso: string) => new Date(iso);

test("pickup queue state", () => {
  assert.equal(pickupQueueState({ status: "CONFIRMED", requiresManagerConfirmation: false }), "PENDING");
  assert.equal(pickupQueueState({ status: "CONFIRMED", requiresManagerConfirmation: true }), "AWAITING_MANAGER");
  assert.equal(pickupQueueState({ status: "PICKED_UP", requiresManagerConfirmation: false }), "COMPLETED");
  // A drop awaiting the manager doesn't undo the pickup
  assert.equal(pickupQueueState({ status: "PICKED_UP", requiresManagerConfirmation: true }), "COMPLETED");
  assert.equal(pickupQueueState({ status: "RETURNED", requiresManagerConfirmation: false }), "COMPLETED");
  assert.equal(pickupQueueState({ status: "CANCELLED", requiresManagerConfirmation: false }), null);
  assert.equal(pickupQueueState({ status: "HOLD", requiresManagerConfirmation: false }), null);
});

test("return queue state", () => {
  assert.equal(returnQueueState({ status: "PICKED_UP", requiresManagerConfirmation: false }), "PENDING");
  assert.equal(returnQueueState({ status: "PICKED_UP", requiresManagerConfirmation: true }), "AWAITING_MANAGER");
  assert.equal(returnQueueState({ status: "RETURNED", requiresManagerConfirmation: false }), "COMPLETED");
  assert.equal(returnQueueState({ status: "CONFIRMED", requiresManagerConfirmation: true }), null);
  assert.equal(returnQueueState({ status: "CANCELLED", requiresManagerConfirmation: false }), null);
});

test("includeCompleted is opt-in; old builds never send it", () => {
  for (const on of ["1", "true", "TRUE", " yes "]) assert.equal(parseIncludeCompleted(on), true, on);
  for (const off of [undefined, null, "", "0", "false", "no", 1, ["1"]]) assert.equal(parseIncludeCompleted(off), false, String(off));
  assert.deepEqual(pendingOnlyWhere(false), {});
  assert.deepEqual(pendingOnlyWhere(true), { requiresManagerConfirmation: false });
});

test("completed rows: the day and tab they belong to", () => {
  const day = { gte: at("2026-10-13T18:30:00Z"), lte: at("2026-10-14T18:29:59.999Z") };

  const dailyPickup = completedPickupWhere(7, "DAILY", day, ["bk1"]) as any;
  assert.equal(dailyPickup.branchId, 7);
  // Daily = not MONTHLY (NULL included), and done or waiting on a manager
  assert.equal(dailyPickup.AND[0].OR.length, 2);
  assert.deepEqual(dailyPickup.AND[1].OR, [
    { status: { in: ["PICKED_UP", "RETURNED"] } },
    { status: "CONFIRMED", requiresManagerConfirmation: true },
  ]);
  // Scheduled that day, or picked up that day (readings, settled bill, activity entry)
  const when = dailyPickup.AND[2].OR;
  assert.deepEqual(when[0], { startAt: day });
  assert.deepEqual(when[1], { licenseCollectedAt: day });
  assert.deepEqual(when[2], { fuelRecord: { pickupAt: day } });
  assert.deepEqual(when[3].paymentSessions.some, { sessionType: "PICKUP", status: "COMPLETED", completedAt: day });
  assert.deepEqual(when[4], { publicId: { in: ["bk1"] } });
  assert.equal((completedPickupWhere(7, "DAILY", day) as any).AND[2].OR.length, 4);

  const monthlyPickup = completedPickupWhere(7, "MONTHLY", day) as any;
  assert.deepEqual(monthlyPickup.AND[0], { rentalPeriodType: "MONTHLY" });

  // Returns: due that day, or actually returned that day — both tabs
  for (const type of ["DAILY", "MONTHLY", undefined] as const) {
    const where = completedReturnWhere(7, type, day) as any;
    assert.deepEqual(where.AND[2], { OR: [{ endAt: day }, { returnedAt: day }] });
    assert.deepEqual(where.AND[1].OR, [
      { status: "RETURNED" },
      { status: "PICKED_UP", requiresManagerConfirmation: true },
    ]);
  }
  assert.deepEqual((completedReturnWhere(7, undefined, day) as any).AND[0], {});
});

test("onQueueDay: listed on the scheduled day and on the day it was actually done", () => {
  const day = { gte: at("2026-10-13T18:30:00Z"), lte: at("2026-10-14T18:29:59.999Z") }; // 14 Oct IST
  // Overdue return due 12 Oct, returned 14 Oct: listed on the 14th
  assert.equal(onQueueDay(at("2026-10-12T05:00:00Z"), at("2026-10-14T06:00:00Z"), day), true);
  // Monthly rental starting 13 Oct, picked up 14 Oct: listed on the 14th
  assert.equal(onQueueDay(at("2026-10-13T05:00:00Z"), at("2026-10-14T04:00:00Z"), day), true);
  // Due today, returned early yesterday: still on its scheduled day
  assert.equal(onQueueDay(at("2026-10-14T10:00:00Z"), at("2026-10-13T10:00:00Z"), day), true);
  // Neither on the day (an event that day that didn't complete it)
  assert.equal(onQueueDay(at("2026-10-12T05:00:00Z"), at("2026-10-15T05:00:00Z"), day), false);
  assert.equal(onQueueDay(at("2026-10-12T05:00:00Z"), null, day), false);
  // Day bounds are inclusive
  assert.equal(onQueueDay(at("2026-10-14T18:29:59.999Z"), null, day), true);
});

test("activityMarkerKind reads the pickup / drop activity entries", () => {
  const ref = "PICKUPreturn1x";
  assert.equal(activityMarkerKind("PICKUP", { actionType: "CONFIRMED", description: `Vehicle pickup confirmed for booking ${ref}` }), "COMPLETED");
  assert.equal(activityMarkerKind("PICKUP", { actionType: "CONFIRMED", description: `Manager confirmed vehicle pickup for booking ${ref}` }), "MANAGER_CONFIRMED");
  assert.equal(activityMarkerKind("PICKUP", { actionType: "INITIATED", description: `Pickup approval requested for booking ${ref}` }), "SENT_TO_MANAGER");
  assert.equal(activityMarkerKind("RETURN", { actionType: "COMPLETED", description: `Vehicle return completed for booking ${ref}` }), "COMPLETED");
  assert.equal(activityMarkerKind("RETURN", { actionType: "CONFIRMED", description: `Manager confirmed vehicle return for booking ${ref}` }), "MANAGER_CONFIRMED");
  assert.equal(activityMarkerKind("RETURN", { actionType: "INITIATED", description: `Return approval requested for booking ${ref}` }), "SENT_TO_MANAGER");
  // The other phase's entries — even with a booking id that spells the word
  assert.equal(activityMarkerKind("RETURN", { actionType: "CONFIRMED", description: `Vehicle pickup confirmed for booking ${ref}` }), null);
  assert.equal(activityMarkerKind("PICKUP", { actionType: "INITIATED", description: `Return approval requested for booking ${ref}` }), null);
  assert.equal(activityMarkerKind("PICKUP", { actionType: "COMPLETED", description: `Vehicle return completed for booking ${ref}` }), null);
});

test("pickCompletion: the event that completed it, else the readings written at it", () => {
  const recorded: CompletionMarker[] = [
    { kind: "RECORDED", at: at("2026-10-14T04:00:00Z"), byName: null },
    { kind: "RECORDED", at: at("2026-10-14T04:05:00Z"), byName: "Asha" },
  ];
  // Legacy pickup submitted by Ravi
  assert.deepEqual(
    pickCompletion("COMPLETED", [...recorded, { kind: "COMPLETED", at: at("2026-10-14T04:06:00Z"), byName: "Ravi" }]),
    { at: at("2026-10-14T04:06:00Z"), byName: "Ravi" },
  );
  // Sent to the manager, then confirmed: completed when the manager confirmed it
  const sent: CompletionMarker = { kind: "SENT_TO_MANAGER", at: at("2026-10-14T04:06:00Z"), byName: "Ravi" };
  const confirmed: CompletionMarker = { kind: "MANAGER_CONFIRMED", at: at("2026-10-14T05:00:00Z"), byName: "Meera (BM)" };
  assert.deepEqual(pickCompletion("COMPLETED", [sent, confirmed]), { at: confirmed.at, byName: "Meera (BM)" });
  // Still waiting on the manager: when Fleet sent it
  assert.deepEqual(pickCompletion("AWAITING_MANAGER", [sent, ...recorded]), { at: sent.at, byName: "Ravi" });
  // Old row with no event: latest reading, with whoever recorded one
  assert.deepEqual(pickCompletion("COMPLETED", recorded), { at: at("2026-10-14T04:05:00Z"), byName: "Asha" });
  // Settled bill
  assert.deepEqual(
    pickCompletion("COMPLETED", [{ kind: "SESSION", at: at("2026-10-14T06:00:00Z"), byName: "Kiran" }]),
    { at: at("2026-10-14T06:00:00Z"), byName: "Kiran" },
  );
  assert.deepEqual(pickCompletion("COMPLETED", []), { at: null, byName: null });
  assert.deepEqual(pickCompletion("PENDING", recorded), { at: null, byName: null });
});

test("sortCompletedQueue: in the order they were done, unknown times last", () => {
  const rows = [
    { id: "late", completedAt: at("2026-10-14T10:00:00Z"), scheduledAt: at("2026-10-14T04:00:00Z") },
    { id: "unknown-b", completedAt: null, scheduledAt: at("2026-10-14T09:00:00Z") },
    { id: "early", completedAt: at("2026-10-14T05:00:00Z"), scheduledAt: at("2026-10-14T08:00:00Z") },
    { id: "unknown-a", completedAt: null, scheduledAt: at("2026-10-14T03:00:00Z") },
  ];
  assert.deepEqual(
    sortCompletedQueue(rows, (r) => r).map((r) => r.id),
    ["early", "late", "unknown-a", "unknown-b"],
  );
});
