/**
 * Cash shift auto-close at the end of the IST day (Nov 2026): the cutoff
 * (IST, whatever the server timezone), which shifts are due, what the close
 * writes (cash-free → final; with cash → awaiting the manager's verify), and
 * that the manager can still verify & close an auto-closed shift. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  CashShiftError,
  autoCloseCutoff,
  autoClosePlan,
  decideClose,
  isAwaitingVerification,
  isDueForAutoClose,
  parseAutoCloseTime,
  shiftFigures,
} from "./cash-shift-rules.js";

const row = (purpose: string, status: string, cash: number, online = 0) => ({
  purpose,
  status,
  cashAmount: cash.toFixed(2),
  onlineAmount: online.toFixed(2),
});

// ── Cutoff (IST) ─────────────────────────────────────────────────────────────

test("parseAutoCloseTime: HH:mm, else midnight", () => {
  assert.deepEqual(parseAutoCloseTime("23:30"), { hour: 23, minute: 30, label: "23:30" });
  assert.deepEqual(parseAutoCloseTime("3:05"), { hour: 3, minute: 5, label: "03:05" });
  assert.deepEqual(parseAutoCloseTime(undefined), { hour: 0, minute: 0, label: "00:00" });
  assert.deepEqual(parseAutoCloseTime(""), { hour: 0, minute: 0, label: "00:00" });
  assert.deepEqual(parseAutoCloseTime("24:00"), { hour: 0, minute: 0, label: "00:00" });
  assert.deepEqual(parseAutoCloseTime("10pm"), { hour: 0, minute: 0, label: "00:00" });
});

test("autoCloseCutoff: the last IST midnight, not UTC midnight", () => {
  // 26 Nov 2026 03:00 IST = 25 Nov 21:30 UTC → cutoff is 26 Nov 00:00 IST = 25 Nov 18:30 UTC
  assert.equal(autoCloseCutoff(new Date("2026-11-25T21:30:00Z")).toISOString(), "2026-11-25T18:30:00.000Z");
  // 26 Nov 2026 23:59 IST → still 26 Nov 00:00 IST
  assert.equal(autoCloseCutoff(new Date("2026-11-26T18:29:00Z")).toISOString(), "2026-11-25T18:30:00.000Z");
  // exactly midnight IST → that midnight
  assert.equal(autoCloseCutoff(new Date("2026-11-26T18:30:00Z")).toISOString(), "2026-11-26T18:30:00.000Z");
  // 26 Nov 04:00 UTC (09:30 IST) — UTC midnight would wrongly be 26 Nov 00:00 UTC
  assert.equal(autoCloseCutoff(new Date("2026-11-26T04:00:00Z")).toISOString(), "2026-11-25T18:30:00.000Z");
});

test("autoCloseCutoff: a configured time (23:30 IST)", () => {
  // 26 Nov 23:00 IST → cutoff is 25 Nov 23:30 IST (= 25 Nov 18:00 UTC)
  assert.equal(autoCloseCutoff(new Date("2026-11-26T17:30:00Z"), "23:30").toISOString(), "2026-11-25T18:00:00.000Z");
  // 26 Nov 23:45 IST → 26 Nov 23:30 IST
  assert.equal(autoCloseCutoff(new Date("2026-11-26T18:15:00Z"), "23:30").toISOString(), "2026-11-26T18:00:00.000Z");
});

test("isDueForAutoClose: OPEN and opened before the cutoff", () => {
  const cutoff = new Date("2026-11-25T18:30:00Z"); // 26 Nov 00:00 IST
  assert.equal(isDueForAutoClose({ status: "OPEN", openedAt: new Date("2026-11-25T03:30:00Z") }, cutoff), true); // 25 Nov 09:00 IST
  assert.equal(isDueForAutoClose({ status: "OPEN", openedAt: new Date("2026-11-25T18:29:59Z") }, cutoff), true); // 25 Nov 23:59:59 IST
  assert.equal(isDueForAutoClose({ status: "OPEN", openedAt: new Date("2026-11-25T18:30:00Z") }, cutoff), false); // opened at the cutoff = today's
  assert.equal(isDueForAutoClose({ status: "OPEN", openedAt: new Date("2026-11-26T03:30:00Z") }, cutoff), false); // today
  assert.equal(isDueForAutoClose({ status: "CLOSED", openedAt: new Date("2026-11-20T03:30:00Z") }, cutoff), false);
  assert.equal(isDueForAutoClose({ status: "DISCREPANCY_FLAGGED", openedAt: new Date("2026-11-20T03:30:00Z") }, cutoff), false);
  // A shift left open for days is still closed
  assert.equal(isDueForAutoClose({ status: "OPEN", openedAt: new Date("2026-11-01T03:30:00Z") }, cutoff), true);
});

// ── What the close writes ────────────────────────────────────────────────────

test("autoClosePlan: no cash at all → final close, all zeros", () => {
  const plan = autoClosePlan({ status: "OPEN", figures: shiftFigures(0, []) });
  assert.deepEqual(plan, {
    kind: "NO_CASH",
    status: "CLOSED",
    cashCollected: "0.00",
    cashRefunded: "0.00",
    expectedTotal: "0.00",
    actualTotal: "0.00",
    discrepancy: "0.00",
  });
});

test("autoClosePlan: only UPI / card money → final close (non-cash never blocks)", () => {
  const figs = shiftFigures(0, [row("REMAINING_BALANCE", "CONFIRMED", 0, 4000), row("EXTENSION", "COLLECTED", 0, 500)]);
  assert.equal(autoClosePlan({ status: "OPEN", figures: figs })?.kind, "NO_CASH");
});

test("autoClosePlan: a voided / rejected cash row counts nowhere → final close", () => {
  const figs = shiftFigures(0, [row("REMAINING_BALANCE", "VOIDED", 1500), row("REMAINING_BALANCE", "REJECTED", 800)]);
  assert.equal(autoClosePlan({ status: "OPEN", figures: figs })?.kind, "NO_CASH");
});

test("autoClosePlan: cash collected → awaiting the manager, expected snapshotted, nothing counted", () => {
  const figs = shiftFigures(1000, [
    row("REMAINING_BALANCE", "COLLECTED", 5000),
    row("EXTENSION", "CONFIRMED", 1200, 300),
    row("OVERPAYMENT_REFUND", "CONFIRMED", 200),
  ]);
  assert.deepEqual(autoClosePlan({ status: "OPEN", figures: figs }), {
    kind: "AWAITING_VERIFICATION",
    status: "DISCREPANCY_FLAGGED",
    cashCollected: "6200.00",
    cashRefunded: "200.00",
    expectedTotal: "7000.00",
    // never a made-up shortage: the system counted nothing
    actualTotal: "0.00",
    discrepancy: "0.00",
  });
});

test("autoClosePlan: an opening float or a cash refund alone still needs the manager", () => {
  assert.equal(autoClosePlan({ status: "OPEN", figures: shiftFigures(500, []) })?.kind, "AWAITING_VERIFICATION");
  assert.equal(
    autoClosePlan({ status: "OPEN", figures: shiftFigures(0, [row("CANCELLATION_REFUND", "CONFIRMED", 300)]) })?.expectedTotal,
    "-300.00",
  );
});

test("autoClosePlan: not OPEN any more → nothing to do", () => {
  assert.equal(autoClosePlan({ status: "CLOSED", figures: shiftFigures(0, []) }), null);
  assert.equal(autoClosePlan({ status: "DISCREPANCY_FLAGGED", figures: shiftFigures(100, []) }), null);
});

// ── Awaiting verification → the manager's verify & close ────────────────────

test("isAwaitingVerification: auto-closed, not OPEN, no manager yet", () => {
  const at = new Date("2026-11-25T18:35:00Z");
  assert.equal(isAwaitingVerification({ status: "DISCREPANCY_FLAGGED", autoClosedAt: at, closedById: null }), true);
  // verified by the manager since
  assert.equal(isAwaitingVerification({ status: "CLOSED", autoClosedAt: at, closedById: 7 }), false);
  assert.equal(isAwaitingVerification({ status: "DISCREPANCY_FLAGGED", autoClosedAt: at, closedById: 7 }), false);
  // never auto-closed (legacy executive close has closedById null too)
  assert.equal(isAwaitingVerification({ status: "DISCREPANCY_FLAGGED", autoClosedAt: null, closedById: null }), false);
  assert.equal(isAwaitingVerification({ status: "OPEN", autoClosedAt: null, closedById: null }), false);
  // A cash-free auto-close is CLOSED for good — nothing to verify
  assert.equal(isAwaitingVerification({ status: "CLOSED", autoClosedAt: at, closedById: null }), false);
});

test("decideClose: the manager verifies & closes an auto-closed shift like an open one", () => {
  const figs = shiftFigures(0, [row("REMAINING_BALANCE", "COLLECTED", 5000)]);
  const ok = decideClose({ status: "DISCREPANCY_FLAGGED", awaitingVerification: true, figures: figs, cashReceived: 5000 });
  assert.equal(ok.status, "CLOSED");
  assert.equal(ok.matched, true);
  const short = decideClose({
    status: "DISCREPANCY_FLAGGED",
    awaitingVerification: true,
    figures: figs,
    cashReceived: 4900,
    note: "₹100 short, will pay tomorrow",
  });
  assert.equal(short.status, "DISCREPANCY_FLAGGED");
  assert.ok(short.difference.eq(new Decimal(-100)));
});

test("decideClose: a closed shift that is not awaiting verification stays locked", () => {
  const figs = shiftFigures(0, [row("REMAINING_BALANCE", "CONFIRMED", 5000)]);
  assert.throws(
    () => decideClose({ status: "CLOSED", figures: figs, cashReceived: 5000 }),
    (e: unknown) => e instanceof CashShiftError && e.code === "SHIFT_NOT_OPEN",
  );
  assert.throws(
    () => decideClose({ status: "DISCREPANCY_FLAGGED", awaitingVerification: false, figures: figs, cashReceived: 5000 }),
    (e: unknown) => e instanceof CashShiftError && e.code === "SHIFT_NOT_OPEN",
  );
});
