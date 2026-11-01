/**
 * Credit Card counter payment method (Nov 2026, client TODO 3): how it is
 * recognised, validated and classified everywhere. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_GATEWAY,
  COUNTER_PAYMENT_METHODS,
  COUNTER_PAYMENT_METHOD_LABELS,
  clearCreditSchema,
  isCardGateway,
  recordPaymentSchema,
  recordSettlementPaymentSchema,
} from "@repo/schemas";
import { isCounterCardPayment, isGatewayPayment, paymentModeLabel } from "../financials/payment-type.js";
import { modeLabelOf, modeSplitOf } from "../reporting/finance/booking-finance.js";
import { classifyOnline } from "../../utils/reporting/payments.js";
import { normalizeProofIdList } from "./payment-proof-list.js";

test("Credit Card is its own counter method, apart from Credit", () => {
  assert.ok(COUNTER_PAYMENT_METHODS.includes("CARD"));
  assert.ok(COUNTER_PAYMENT_METHODS.includes("CREDIT"));
  assert.equal(COUNTER_PAYMENT_METHOD_LABELS.CARD, "Credit Card");
  assert.equal(COUNTER_PAYMENT_METHOD_LABELS.CREDIT, "Credit");
  assert.equal(CARD_GATEWAY, "CARD");
});

test("isCardGateway / isCounterCardPayment: exactly CARD (any case), nothing else", () => {
  for (const g of ["CARD", "card", " Card "]) {
    assert.equal(isCardGateway(g), true, g);
    assert.equal(isCounterCardPayment(g), true, g);
  }
  for (const g of [null, undefined, "", "UPI", "RAZORPAY", "credit card via razorpay", "BANK_TRANSFER"]) {
    assert.equal(isCardGateway(g), false, String(g));
    assert.equal(isCounterCardPayment(g), false, String(g));
  }
});

test("a counter card row is not a gateway row; older free text mentioning card still is", () => {
  assert.equal(isGatewayPayment("CARD"), false);
  assert.equal(isGatewayPayment("razorpay"), true);
  assert.equal(isGatewayPayment("card via razorpay"), true);
  assert.equal(classifyOnline("CARD"), "Card");
  assert.equal(classifyOnline("card via razorpay"), "Gateway");
  assert.equal(classifyOnline("UPI"), "UPI");
  assert.equal(classifyOnline(null), "UPI");
});

test("BM Financials mode label", () => {
  assert.equal(paymentModeLabel({ cash: 0, online: 500, onlineGateway: "CARD" }), "Credit Card");
  assert.equal(paymentModeLabel({ cash: 100, online: 400, onlineGateway: "CARD" }), "Cash + Credit Card");
  assert.equal(paymentModeLabel({ cash: 0, online: 500, onlineGateway: "UPI" }), "UPI");
  assert.equal(paymentModeLabel({ cash: 0, online: 500, onlineGateway: "RAZORPAY" }), "Online (Razorpay)");
});

test("Admin reports mode split: card has its own bucket; UPI / gateway unchanged", () => {
  const card = modeSplitOf({ method: "ONLINE", totalAmount: 750, cashAmount: 0, onlineAmount: 750, onlineGateway: "CARD" });
  assert.deepEqual(card, { CASH: 0, UPI: 0, CARD: 750, BANK_TRANSFER: 0, GATEWAY: 0 });
  assert.equal(modeLabelOf(card), "Credit card");
  const upi = modeSplitOf({ method: "ONLINE", totalAmount: 750, cashAmount: 0, onlineAmount: 750, onlineGateway: "UPI" });
  assert.equal(upi.UPI, 750);
  assert.equal(upi.CARD, 0);
  const rzp = modeSplitOf({ method: "ONLINE", totalAmount: 750, cashAmount: 0, onlineAmount: 750, onlineGateway: "RAZORPAY" });
  assert.equal(rzp.GATEWAY, 750);
});

test("record-payment schemas: card needs its receipt photo (counter), not in settlements", () => {
  const base = { bookingPublicId: "bk", purpose: "REMAINING_BALANCE", method: "ONLINE", totalAmount: 500, onlineAmount: 500, onlineGateway: "CARD", idempotencyKey: "k" };
  assert.equal(recordPaymentSchema.safeParse(base).success, false);
  assert.equal(recordPaymentSchema.safeParse({ ...base, proof_file_ids: ["f1", "f2"] }).success, true);
  assert.equal(recordSettlementPaymentSchema.safeParse(base).success, true);
  // another gateway still needs its reference in settlements
  assert.equal(recordSettlementPaymentSchema.safeParse({ ...base, onlineGateway: "RAZORPAY" }).success, false);
});

test("credit clearance by card needs a receipt photo; a typed reference is not enough", () => {
  const base = { sectionKeys: ["s1"], paymentMethod: "CARD" };
  assert.equal(clearCreditSchema.safeParse(base).success, false);
  assert.equal(clearCreditSchema.safeParse({ ...base, transactionRef: "123456" }).success, false);
  assert.equal(clearCreditSchema.safeParse({ ...base, proof_file_ids: ["f1"] }).success, true);
});

test("card receipts use the UPI photo list rules (1–3, no duplicates)", () => {
  assert.deepEqual(normalizeProofIdList(undefined, ["a", "b"]), { ok: true, ids: ["a", "b"] });
  assert.equal(normalizeProofIdList(undefined, ["a", "b", "c", "d"]).ok, false);
  assert.equal(normalizeProofIdList(undefined, ["a", "a"]).ok, false);
});
