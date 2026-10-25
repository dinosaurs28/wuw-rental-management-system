/**
 * Refund payment-success photo rules (Oct 25 2026). No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REFUND_PROOF_REQUIRED_CODE,
  REFUND_PROOF_REQUIRED_MESSAGE,
  isGatewayRefundRef,
  refundNeedsProof,
  refundProofRefusal,
} from "./refund-proof-rules.js";

test("UPI, bank transfer and counter ONLINE refunds need the photo", () => {
  for (const m of ["UPI", "BANK_TRANSFER", "ONLINE", "upi", " bank_transfer "]) {
    assert.equal(refundNeedsProof(m), true, m);
  }
});

test("cash, original online payment and unknown methods don't", () => {
  for (const m of ["CASH", "ORIGINAL_PAYMENT", "LATER", "", null, undefined]) {
    assert.equal(refundNeedsProof(m as any), false, String(m));
  }
});

test("a Razorpay gateway refund is exempt whatever the method", () => {
  assert.equal(refundNeedsProof("ONLINE", "RAZORPAY"), false);
  assert.equal(refundNeedsProof("ONLINE", "razorpay"), false);
  assert.equal(refundNeedsProof("ONLINE", "UPI"), true);
  assert.equal(refundNeedsProof("ONLINE", "BANK_TRANSFER"), true);
});

test("refusal: 400 REFUND_PROOF_REQUIRED only for a transfer without a photo", () => {
  const r = refundProofRefusal("UPI", false);
  assert.ok(r);
  assert.equal(r!.status, 400);
  assert.equal(r!.code, REFUND_PROOF_REQUIRED_CODE);
  assert.equal(r!.message, REFUND_PROOF_REQUIRED_MESSAGE);
  assert.equal(r!.field, "proofFileId");
  assert.equal(refundProofRefusal("BANK_TRANSFER", false, { field: "refund.proofFileId" })!.field, "refund.proofFileId");
  assert.equal(refundProofRefusal("UPI", true), null);
  assert.equal(refundProofRefusal("CASH", false), null);
  assert.equal(refundProofRefusal("ORIGINAL_PAYMENT", false), null);
  assert.equal(refundProofRefusal("ONLINE", false, { gateway: "RAZORPAY" }), null);
});

test("Razorpay refund ids are recognised", () => {
  assert.equal(isGatewayRefundRef("rfnd_ABC123"), true);
  assert.equal(isGatewayRefundRef(" RFND_x "), true);
  assert.equal(isGatewayRefundRef("123456789012"), false);
  assert.equal(isGatewayRefundRef(null), false);
});
