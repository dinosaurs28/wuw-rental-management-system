/**
 * Pure checks of the manual pickup discount: amount / reason validation, the cap
 * (rent payable at pickup after a counter coupon, never the deposit), the GST
 * split of the discounted rent (item-17 rent rule and GST-on-top bookings), the
 * bill read, the Edit Pickup delta line and how an edit's change counts in what
 * the booking owes. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import {
  PICKUP_DISCOUNT_REF,
  PickupDiscountError,
  ZERO_SPLIT,
  assertPickupDiscountWithinCap,
  parsePickupDiscountAmount,
  parsePickupDiscountReason,
  pendingPickupDiscountChange,
  pickupBillRent,
  pickupDiscountAdjustmentLine,
  pickupDiscountCap,
  readPickupDiscount,
  recordSplit,
  splitPickupDiscount,
  subtractSplit,
} from "./pickup-discount-rules.js";
import { tallyOwedEntries } from "../payment/booking-owed.service.js";

const d = (n: number | string) => new Decimal(n);
const rates = { cgstRate: 9, sgstRate: 9, rate: 18 };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof PickupDiscountError);
    return { code: err.code, status: err.status, ...err.extra };
  }
  assert.fail("expected a PickupDiscountError");
};

test("the amount is a flat ₹ above 0 with at most 2 decimals", () => {
  assert.equal(parsePickupDiscountAmount(250).toFixed(2), "250.00");
  assert.equal(parsePickupDiscountAmount("99.5").toFixed(2), "99.50");
  assert.equal(parsePickupDiscountAmount(" 10.25 ").toFixed(2), "10.25");
  for (const bad of [0, "0", "0.00", -5, "-5", "10.255", "abc", "", null, undefined, "1e3", NaN, "10%"]) {
    assert.deepEqual(code(() => parsePickupDiscountAmount(bad)), { code: "PICKUP_DISCOUNT_INVALID", status: 400 });
  }
});

test("the reason is optional and bounded", () => {
  assert.equal(parsePickupDiscountReason(undefined), null);
  assert.equal(parsePickupDiscountReason("   "), null);
  assert.equal(parsePickupDiscountReason(" Regular customer "), "Regular customer");
  assert.equal(code(() => parsePickupDiscountReason("x".repeat(201)))?.code, "PICKUP_DISCOUNT_INVALID");
  assert.equal(code(() => parsePickupDiscountReason(42))?.code, "PICKUP_DISCOUNT_INVALID");
});

test("the cap is the rent payable at pickup less a counter coupon", () => {
  assert.equal(pickupDiscountCap(d(3000)).toFixed(2), "3000.00");
  assert.equal(pickupDiscountCap(d(3000), d(500)).toFixed(2), "2500.00");
  // A coupon line is negative on the ledger — same cap
  assert.equal(pickupDiscountCap(d(3000), d(-500)).toFixed(2), "2500.00");
  assert.equal(pickupDiscountCap(d(400), d(500)).toFixed(2), "0.00");

  assertPickupDiscountWithinCap(d(2500), d(2500));
  assert.deepEqual(code(() => assertPickupDiscountWithinCap(d("2500.01"), d(2500))), {
    code: "PICKUP_DISCOUNT_EXCEEDS",
    status: 400,
    maxAmount: "2500.00",
  });
  // Nothing payable (paid in full / balance paid already): nothing to discount
  assert.deepEqual(code(() => assertPickupDiscountWithinCap(d(1), d(0))), {
    code: "PICKUP_DISCOUNT_EXCEEDS",
    status: 400,
    maxAmount: "0.00",
  });
});

test("the discount comes off the GST-inclusive rent and its GST is split by the rent rule", () => {
  // Item 17: GST = rate% of the amount
  const s = splitPickupDiscount(d(500), rates, false);
  assert.equal(s.total.toFixed(2), "500.00");
  assert.equal(s.cgst.toFixed(2), "45.00");
  assert.equal(s.sgst.toFixed(2), "45.00");
  assert.equal(s.gst.toFixed(2), "90.00");
  assert.equal(s.discount.toFixed(2), "410.00");
  // Paise round per part and still add up
  const odd = splitPickupDiscount(d("333.33"), rates, false);
  assert.equal(odd.discount.add(odd.gst).toFixed(2), "333.33");
  assert.equal(odd.cgst.add(odd.sgst).toFixed(2), odd.gst.toFixed(2));
});

test("a booking priced with GST on top splits the discount backwards", () => {
  const s = splitPickupDiscount(d(590), rates, true);
  assert.equal(s.discount.toFixed(2), "500.00");
  assert.equal(s.gst.toFixed(2), "90.00");
  assert.equal(s.total.toFixed(2), "590.00");
});

test("the GST left on the rent after the discount matches the rent rule on the discounted rent", () => {
  // Remaining balance ₹3,000 (GST-inclusive), ₹500 off → ₹2,500 payable
  const before = splitPickupDiscount(d(3000), rates, false);
  const off = splitPickupDiscount(d(500), rates, false);
  const after = splitPickupDiscount(d(2500), rates, false);
  assert.equal(before.gst.sub(off.gst).toFixed(2), after.gst.toFixed(2));
  assert.equal(before.discount.sub(off.discount).toFixed(2), after.discount.toFixed(2));
});

test("the bill read: rental balance (extension apart), coupon and manual discount", () => {
  const bill = pickupBillRent(
    [
      { entryType: "BOOKING_BASE", classification: "TAXABLE", referenceType: "BOOKING_REMAINING", amount: "3000.00", gstAmount: "0.00" },
      { entryType: "EXTENSION", classification: "TAXABLE", referenceType: "BOOKING_EXTENSION", amount: "1000.00", gstAmount: "180.00" },
      { entryType: "DEPOSIT", classification: "NON_TAXABLE", referenceType: "SAFETY_DEPOSIT", amount: "5000.00", gstAmount: "0" },
      { entryType: "DISCOUNT", classification: "DISCOUNT", referenceType: "DISCOUNT_RULE", amount: "-418.00", gstAmount: "-75.24" },
      { entryType: "DISCOUNT", classification: "DISCOUNT", referenceType: PICKUP_DISCOUNT_REF, amount: "-200.00", gstAmount: "-36.00" },
      { entryType: "DISCOUNT", classification: "DISCOUNT", referenceType: PICKUP_DISCOUNT_REF, amount: "-999.00", gstAmount: "0", isVoided: true },
    ],
    "DISCOUNT_RULE",
  );
  // The deposit is never part of it, nor the extension (only the rental balance is discounted)
  assert.equal(bill.rentDue.toFixed(2), "3000.00");
  assert.equal(bill.extension.toFixed(2), "1180.00");
  assert.equal(bill.coupon.toFixed(2), "418.00");
  assert.equal(bill.manual.toFixed(2), "200.00");
  assert.equal(bill.cap.toFixed(2), "2582.00");
  // Nothing due (paid in full): cap 0
  assert.equal(pickupBillRent([], "DISCOUNT_RULE").cap.toFixed(2), "0.00");
});

test("Edit Pickup: the discount line from the settled discount to the edited one", () => {
  const was = splitPickupDiscount(d(500), rates, false);
  const now = splitPickupDiscount(d(800), rates, false);
  const raise = pickupDiscountAdjustmentLine({ settled: was, target: now })!;
  assert.equal(raise.part, "PICKUP");
  assert.equal(raise.entryType, "DISCOUNT");
  assert.equal(raise.referenceType, PICKUP_DISCOUNT_REF);
  assert.equal(raise.oldAmount.toFixed(2), "-500.00");
  assert.equal(raise.newAmount.toFixed(2), "-800.00");
  // More discount: ₹300 back to the customer, ₹54 of it GST
  assert.equal(raise.delta.toFixed(2), "-300.00");
  assert.equal(raise.gstDelta.toFixed(2), "-54.00");
  assert.equal(raise.baseDelta.toFixed(2), "-246.00");
  // Removed: ₹500 more to collect
  const removed = pickupDiscountAdjustmentLine({ settled: was, target: ZERO_SPLIT })!;
  assert.equal(removed.delta.toFixed(2), "500.00");
  assert.equal(removed.newAmount.toFixed(2), "0.00");
  // Unchanged: no line
  assert.equal(pickupDiscountAdjustmentLine({ settled: was, target: was }), null);
});

test("Edit Pickup: a replaced unsettled difference counts from the discount as last settled", () => {
  // Settled ₹500; an unsettled edit raised it to ₹800 (booking holds ₹800 already)
  const settled = splitPickupDiscount(d(500), rates, false);
  const held = splitPickupDiscount(d(800), rates, false);
  const pendingLine = pickupDiscountAdjustmentLine({ settled, target: held })!;
  const pending = pendingPickupDiscountChange([
    { referenceType: PICKUP_DISCOUNT_REF, amount: pendingLine.delta, gstAmount: pendingLine.gstDelta, baseAmount: pendingLine.baseDelta },
    { referenceType: "SAFETY_DEPOSIT", amount: d(1000) },
  ]);
  assert.equal(pending.total.toFixed(2), "300.00");
  const back = subtractSplit(held, pending);
  assert.equal(back.total.toFixed(2), "500.00");
  assert.equal(back.gst.toFixed(2), "90.00");
  // The new edit sets ₹600: one line ₹500 → ₹600
  const line = pickupDiscountAdjustmentLine({ settled: back, target: splitPickupDiscount(d(600), rates, false) })!;
  assert.equal(line.delta.toFixed(2), "-100.00");
});

test("the recorded discount reads back, and an empty or zero one is none", () => {
  assert.equal(readPickupDiscount(null), null);
  assert.equal(readPickupDiscount({ pickupDiscount: null }), null);
  assert.equal(readPickupDiscount({ pickupDiscount: { amount: "0.00" } }), null);
  const record = readPickupDiscount({
    pickupDiscount: { amount: "500.00", discount: "410.00", cgst: "45.00", sgst: "45.00", gst: "90.00", reason: null, cap: "3000.00", source: "SESSION", appliedAt: "" },
  });
  assert.equal(recordSplit(record).total.toFixed(2), "500.00");
  assert.equal(recordSplit(record).gst.toFixed(2), "90.00");
  assert.equal(recordSplit(null).total.toFixed(2), "0.00");
});

test("an edit's pickup discount change is already in totalFinal: owed only reports what is open on it", () => {
  const line = (status: string, amount: number) => ({
    entryType: "DISCOUNT",
    classification: "DISCOUNT",
    amount,
    gstAmount: 0,
    referenceType: PICKUP_DISCOUNT_REF,
    referenceId: null,
    session: { sessionType: "ADJUSTMENT", status },
  });
  const open = tallyOwedEntries([line("AWAITING_PAYMENT", -300)]);
  assert.equal(open.dropBillCharges.toFixed(2), "0.00");
  // Settlements leaves the refund to the counter
  assert.equal(open.adjustmentPending.toFixed(2), "-300.00");
  const settled = tallyOwedEntries([line("COMPLETED", -300)]);
  assert.equal(settled.dropBillCharges.toFixed(2), "0.00");
  assert.equal(settled.adjustmentPending.toFixed(2), "0.00");
  // A pickup session's discount line is not a drop charge either
  const pickup = tallyOwedEntries([{ ...line("COMPLETED", -500), session: { sessionType: "PICKUP", status: "COMPLETED" } }]);
  assert.equal(pickup.dropBillCharges.toFixed(2), "0.00");
});

test("a return edit replacing an unsettled pickup discount change carries it (₹0 → ₹500 pending, fuel +₹200 → refund ₹300)", () => {
  // Edit Pickup gave ₹500 (booking already holds it), its −₹500 difference is unsettled
  const held = splitPickupDiscount(d(500), rates, false);
  const pendingLine = pickupDiscountAdjustmentLine({ settled: ZERO_SPLIT, target: held })!;
  const pending = pendingPickupDiscountChange([
    { referenceType: PICKUP_DISCOUNT_REF, amount: pendingLine.delta, gstAmount: pendingLine.gstDelta, baseAmount: pendingLine.baseDelta },
  ]);
  // The return edit abandons it: the carried line runs from the settled ₹0 to the held ₹500
  const carried = pickupDiscountAdjustmentLine({ settled: subtractSplit(held, pending), target: held })!;
  assert.equal(carried.delta.toFixed(2), "-500.00");
  assert.equal(carried.gstDelta.toFixed(2), "-90.00");
  const fuel = d(200);
  assert.equal(fuel.add(carried.delta).toFixed(2), "-300.00");
  // Nothing pending: nothing carried
  assert.equal(pickupDiscountAdjustmentLine({ settled: subtractSplit(held, ZERO_SPLIT), target: held }), null);
});
