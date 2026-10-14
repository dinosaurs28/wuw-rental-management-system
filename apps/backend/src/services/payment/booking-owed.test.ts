/**
 * Pure checks of what a booking owes with edits to a completed pickup / drop
 * (client item 1, full edit): an unsettled deposit change isn't held, an open
 * difference is the counter's (not Settlements'), and an over-payment is
 * listed for refund. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { tallyOwedEntries, type OwedLedgerEntry } from "./booking-owed.service.js";
import { overpaymentToRefund } from "./settlement-engine.service.js";

const d = (n: number | string) => new Decimal(n);
const entry = (
  sessionType: string,
  status: string,
  entryType: string,
  classification: string,
  amount: number,
): OwedLedgerEntry => ({
  entryType,
  classification,
  amount,
  gstAmount: 0,
  referenceType: null,
  referenceId: null,
  session: { sessionType, status },
});

test("a deposit raised by an edit isn't held until that difference is collected", () => {
  // ₹5,000 deposit paid at pickup, raised to ₹7,000 and left to settle later
  const pickup = entry("PICKUP", "COMPLETED", "DEPOSIT", "NON_TAXABLE", 5000);
  const raise = (status: string) => entry("ADJUSTMENT", status, "DEPOSIT", "NON_TAXABLE", 2000);
  const open = tallyOwedEntries([pickup, raise("AWAITING_PAYMENT")]);
  assert.equal(open.safetyDepositCharged.toFixed(2), "5000.00");
  // Not a drop correction either: Settlements has nothing to leave out for it
  assert.equal(open.adjustmentPending.toFixed(2), "0.00");
  // Collected: held
  assert.equal(tallyOwedEntries([pickup, raise("COMPLETED")]).safetyDepositCharged.toFixed(2), "7000.00");
  // Abandoned sessions never reach the tally (filtered by the query); a lowered deposit refunded is released
  const lowered = entry("ADJUSTMENT", "COMPLETED", "DEPOSIT", "NON_TAXABLE", -1000);
  assert.equal(tallyOwedEntries([pickup, lowered]).safetyDepositCharged.toFixed(2), "4000.00");
});

test("an open drop correction is owed, and reported as the counter's to settle", () => {
  const drop = entry("RETURN", "COMPLETED", "EXTRA_KM", "NON_TAXABLE", 1000);
  const fix = entry("ADJUSTMENT", "AWAITING_PAYMENT", "EXTRA_KM", "NON_TAXABLE", 500);
  const out = tallyOwedEntries([drop, fix]);
  assert.equal(out.dropBillCharges.toFixed(2), "1500.00");
  assert.equal(out.adjustmentPending.toFixed(2), "500.00");
  // Lower bill with ₹3,000 taken off credit: the counter refunds only the rest
  const lower = tallyOwedEntries([
    entry("RETURN", "COMPLETED", "EXTRA_KM", "NON_TAXABLE", 5000),
    entry("ADJUSTMENT", "AWAITING_PAYMENT", "EXTRA_KM", "NON_TAXABLE", -4000),
    entry("ADJUSTMENT", "AWAITING_PAYMENT", "CREDIT", "PAYMENT", 3000),
  ]);
  assert.equal(lower.dropBillCharges.toFixed(2), "1000.00");
  assert.equal(lower.adjustmentPending.toFixed(2), "-1000.00");
  // Settled: nothing open
  assert.equal(tallyOwedEntries([drop, { ...fix, session: { sessionType: "ADJUSTMENT", status: "COMPLETED" } }]).adjustmentPending.toFixed(2), "0.00");
});

test("an over-payment (charges lowered after they were collected) is listed for refund", () => {
  assert.equal(overpaymentToRefund({ safetyDepositHandling: null }, d(-1000), d(0)).toFixed(2), "1000.00");
  assert.equal(overpaymentToRefund({ safetyDepositHandling: null }, d(250), d(0)).toFixed(2), "0.00");
  // Legacy SET_OFF: the deposit refund already covers part of it
  assert.equal(overpaymentToRefund({ safetyDepositHandling: "SET_OFF" }, d(-3000), d(2000)).toFixed(2), "1000.00");
  assert.equal(overpaymentToRefund({ safetyDepositHandling: "SET_OFF" }, d(-2000), d(2000)).toFixed(2), "0.00");
  // REFUND_IN_FULL: the deposit is still owed until refunded, so it isn't in the over-payment
  assert.equal(overpaymentToRefund({ safetyDepositHandling: "REFUND_IN_FULL" }, d(-500), d(2000)).toFixed(2), "500.00");
});
