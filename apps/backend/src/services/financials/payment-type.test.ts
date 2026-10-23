/**
 * BM Financials (Oct 2026): the six client payment types and the exact split of a
 * payment over them (payment-type.ts). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_PAYMENT_TYPES,
  CLIENT_PAYMENT_TYPE_LABELS,
  allocatePayment,
  chargeCaseSql,
  ledgerCaseSql,
  normaliseParts,
  paymentModeLabel,
  purposeCaseSql,
  sqlList,
  typeForChargeEntry,
  typeForLedgerLine,
  typeForPurpose,
  typeOrderCaseSql,
} from "./payment-type.js";

test("the six types, in the client's order and wording", () => {
  assert.deepEqual([...CLIENT_PAYMENT_TYPES], ["RENT", "SECURITY_DEPOSIT", "EXTENSION_FEE", "LATE_FEE", "EXTRA_CHARGES", "DAMAGES"]);
  assert.deepEqual(Object.values(CLIENT_PAYMENT_TYPE_LABELS), [
    "Rent",
    "Security deposit",
    "Extension fee",
    "Late fee",
    "Extra charges",
    "Damages",
  ]);
});

test("purpose → type; refunds are not collected money; remaining balance is allocated", () => {
  assert.equal(typeForPurpose("ADVANCE"), "RENT");
  assert.equal(typeForPurpose("FULL_PAYMENT"), "RENT");
  assert.equal(typeForPurpose("EXTENSION"), "EXTENSION_FEE");
  assert.equal(typeForPurpose("SAFETY_DEPOSIT"), "SECURITY_DEPOSIT");
  assert.equal(typeForPurpose("DAMAGE_FEE"), "DAMAGES");
  assert.equal(typeForPurpose("REMAINING_BALANCE"), "ALLOCATE");
  assert.equal(typeForPurpose("OVERPAYMENT_REFUND"), null);
  assert.equal(typeForPurpose("CANCELLATION_REFUND"), null);
});

test("drop-bill / ledger line → type", () => {
  assert.equal(typeForLedgerLine("BOOKING_BASE", null), "RENT");
  assert.equal(typeForLedgerLine("EXTENSION", null), "EXTENSION_FEE");
  assert.equal(typeForLedgerLine("EXTRA_TIME", "LATE_RETURN"), "LATE_FEE");
  assert.equal(typeForLedgerLine("GRACE_ADJUSTMENT", null), "LATE_FEE");
  assert.equal(typeForLedgerLine("EXTRA_KM", "EXTRA_KM"), "EXTRA_CHARGES");
  assert.equal(typeForLedgerLine("FUEL", "FUEL"), "EXTRA_CHARGES");
  assert.equal(typeForLedgerLine("FASTAG", "FASTAG"), "EXTRA_CHARGES");
  assert.equal(typeForLedgerLine("VEHICLE_SWAP", "VEHICLE_SWAP"), "EXTRA_CHARGES");
  assert.equal(typeForLedgerLine("DAMAGE", "DROP_DAMAGE"), "DAMAGES");
  assert.equal(typeForLedgerLine("DAMAGE", null), "DAMAGES");
  assert.equal(typeForLedgerLine("DAMAGE", "OTHER_CHARGE"), "EXTRA_CHARGES");
  for (const t of ["DEPOSIT", "DISCOUNT", "PAYMENT", "REFUND", "CREDIT"]) assert.equal(typeForLedgerLine(t, null), null);
});

test("legacy ChargeEntry → type (BASE and deposit never weigh a payment)", () => {
  assert.equal(typeForChargeEntry("EXTRA_TIME"), "LATE_FEE");
  assert.equal(typeForChargeEntry("FUEL_DEFICIT"), "EXTRA_CHARGES");
  assert.equal(typeForChargeEntry("FASTAG"), "EXTRA_CHARGES");
  assert.equal(typeForChargeEntry("EXTRA_KM"), "EXTRA_CHARGES");
  assert.equal(typeForChargeEntry("VEHICLE_SWAP"), "EXTRA_CHARGES");
  assert.equal(typeForChargeEntry("DAMAGE"), "DAMAGES");
  assert.equal(typeForChargeEntry("BASE"), null);
  assert.equal(typeForChargeEntry("SAFETY_DEPOSIT"), null);
});

test("a drop payment splits over its bill lines, exact to the paise", () => {
  // ₹700 cash for late ₹160 + extra km ₹500 + FASTag ₹40
  const parts = allocatePayment({ cash: 700, online: 0 }, [
    { type: "EXTRA_CHARGES", weight: 500 },
    { type: "LATE_FEE", weight: 160 },
    { type: "EXTRA_CHARGES", weight: 40 },
  ]);
  assert.deepEqual(parts, [
    { type: "LATE_FEE", amount: 160, cash: 160, online: 0 },
    { type: "EXTRA_CHARGES", amount: 540, cash: 540, online: 0 },
  ]);
});

test("a discounted / partly paid bill splits in proportion and adds back exactly", () => {
  // ₹100.01 split (cash 33.33 + UPI 66.68) over three equal lines
  const parts = allocatePayment({ cash: 33.33, online: 66.68 }, [
    { type: "LATE_FEE", weight: 1 },
    { type: "EXTRA_CHARGES", weight: 1 },
    { type: "DAMAGES", weight: 1 },
  ]);
  const cents = (k: "amount" | "cash" | "online") => Math.round(parts.reduce((s, p) => s + p[k], 0) * 100);
  assert.equal(cents("cash"), 3333);
  assert.equal(cents("online"), 6668);
  assert.equal(cents("amount"), 10001);
  for (const p of parts) assert.equal(Math.round(p.amount * 100), Math.round((p.cash + p.online) * 100));
  assert.deepEqual(parts.map((p) => p.type), ["LATE_FEE", "EXTRA_CHARGES", "DAMAGES"]);
});

test("no positive weight → the whole payment is rent (or the given fallback)", () => {
  assert.deepEqual(allocatePayment({ cash: 0, online: 1200 }, []), [{ type: "RENT", amount: 1200, cash: 0, online: 1200 }]);
  assert.deepEqual(allocatePayment({ cash: 50, online: 0 }, [{ type: "LATE_FEE", weight: 0 }], "DAMAGES"), [
    { type: "DAMAGES", amount: 50, cash: 50, online: 0 },
  ]);
});

test("cash / online parts are made consistent with the total", () => {
  assert.deepEqual(normaliseParts({ method: "CASH", total: 500, cash: 500, online: 0 }), { cash: 500, online: 0 });
  assert.deepEqual(normaliseParts({ method: "CASH", total: 500, cash: 0, online: 0 }), { cash: 500, online: 0 });
  assert.deepEqual(normaliseParts({ method: "ONLINE", total: 500, cash: 0, online: 0 }), { cash: 0, online: 500 });
  assert.deepEqual(normaliseParts({ method: "SPLIT", total: 500, cash: 200, online: 300 }), { cash: 200, online: 300 });
});

test("payment mode: split shows both modes; gateway vs counter UPI", () => {
  assert.equal(paymentModeLabel({ cash: 100, online: 0, onlineGateway: null }), "Cash");
  assert.equal(paymentModeLabel({ cash: 0, online: 100, onlineGateway: "UPI" }), "UPI");
  assert.equal(paymentModeLabel({ cash: 0, online: 100, onlineGateway: null }), "UPI");
  assert.equal(paymentModeLabel({ cash: 40, online: 60, onlineGateway: "UPI" }), "Cash + UPI");
  assert.equal(paymentModeLabel({ cash: 0, online: 100, onlineGateway: "razorpay" }), "Online (Razorpay)");
  assert.equal(paymentModeLabel({ cash: 0, online: 100, onlineGateway: "RAZORPAY" }), "Online (Razorpay)");
});

test("SQL CASE expressions are generated from the same tables", () => {
  const p = purposeCaseSql("x");
  assert.match(p, /WHEN 'ADVANCE' THEN 'RENT'/);
  assert.match(p, /WHEN 'SAFETY_DEPOSIT' THEN 'SECURITY_DEPOSIT'/);
  assert.match(p, /WHEN 'DAMAGE_FEE' THEN 'DAMAGES'/);
  assert.doesNotMatch(p, /REMAINING_BALANCE/);
  const l = ledgerCaseSql("e", "r");
  assert.match(l, /WHEN e = 'DAMAGE' AND COALESCE\(r, ''\) = 'OTHER_CHARGE' THEN 'EXTRA_CHARGES' WHEN e = 'DAMAGE' THEN 'DAMAGES'/);
  assert.match(l, /WHEN e = 'EXTRA_TIME' THEN 'LATE_FEE'/);
  assert.match(chargeCaseSql("c"), /WHEN 'FUEL_DEFICIT' THEN 'EXTRA_CHARGES'/);
  assert.match(typeOrderCaseSql("t"), /WHEN 'RENT' THEN 1 .* WHEN 'DAMAGES' THEN 6/);
  assert.throws(() => sqlList(["RENT'; DROP TABLE x; --"]));
});
