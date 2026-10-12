/**
 * Pure checks of the typed coupon code (branch manager / admin enter the code
 * of a coupon they create): normalizeCouponCode / couponCodeIssue /
 * couponCodeSchema in @repo/schemas, the request schemas that use them, and
 * the branch prefix of generated codes. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUPON_CODE_MAX_LENGTH,
  couponCodeIssue,
  couponCodeSchema,
  createDiscountRuleSchema,
  createManagerCouponSchema,
  normalizeCouponCode,
  updateDiscountRuleSchema,
  updateManagerCouponSchema,
} from "@repo/schemas";
import { branchCouponPrefix } from "./coupon-code-generator.service.js";

test("normalizeCouponCode trims and uppercases", () => {
  assert.equal(normalizeCouponCode("  mani-ab12 "), "MANI-AB12");
  assert.equal(normalizeCouponCode("Summer25"), "SUMMER25");
});

test("couponCodeIssue accepts 4–20 of A–Z 0–9 and inner hyphens", () => {
  for (const ok of ["ABCD", "SUMMER25", "MANI-7KQ2XP", "A-B-C-D", "12345", "A".repeat(20)]) {
    assert.equal(couponCodeIssue(ok), null, ok);
  }
});

test("couponCodeIssue rejects bad codes with a readable reason", () => {
  assert.match(couponCodeIssue("ABC")!, /at least 4/);
  assert.match(couponCodeIssue("A".repeat(21))!, /longer than 20/);
  assert.match(couponCodeIssue("SUMMER 25")!, /letters, numbers and hyphens/);
  assert.match(couponCodeIssue("SUMMER_25")!, /letters, numbers and hyphens/);
  assert.match(couponCodeIssue("DIWALI%")!, /letters, numbers and hyphens/);
  assert.match(couponCodeIssue("-ABCD")!, /start or end with a hyphen/);
  assert.match(couponCodeIssue("ABCD-")!, /start or end with a hyphen/);
  // The helper takes the normalised form — lowercase only passes after normalizeCouponCode
  assert.notEqual(couponCodeIssue("summer"), null);
  assert.equal(couponCodeIssue(normalizeCouponCode("summer")), null);
});

test("couponCodeSchema normalises before checking", () => {
  assert.equal(couponCodeSchema.parse("  diwali-25 "), "DIWALI-25");
  assert.equal(couponCodeSchema.parse("abcd"), "ABCD");
  const short = couponCodeSchema.safeParse(" ab ");
  assert.equal(short.success, false);
  assert.match(short.error!.issues[0]!.message, /at least 4/);
  assert.equal(couponCodeSchema.safeParse("bad code").success, false);
});

const managerCoupon = {
  discountType: "PERCENTAGE" as const,
  value: 10,
  name: "Loyal customer",
  reason: "Returning customer",
};

test("manager coupon create: code is optional (older clients) and normalised when sent", () => {
  const without = createManagerCouponSchema.parse(managerCoupon);
  assert.equal(without.code, undefined);

  const typed = createManagerCouponSchema.parse({ ...managerCoupon, code: " friends-10 " });
  assert.equal(typed.code, "FRIENDS-10");

  const bad = createManagerCouponSchema.safeParse({ ...managerCoupon, code: "no" });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.error!.issues[0]!.path, ["code"]);
});

test("manager coupon update: code is optional and normalised", () => {
  assert.equal(updateManagerCouponSchema.parse({ name: "x" }).code, undefined);
  assert.equal(updateManagerCouponSchema.parse({ code: "new-code1" }).code, "NEW-CODE1");
  assert.equal(updateManagerCouponSchema.safeParse({ code: "NEW_CODE" }).success, false);
});

test("admin rule: same code rules on create and update", () => {
  const rule = {
    code: "festive-20",
    name: "Festive",
    discountType: "PERCENTAGE",
    value: 20,
    startDate: "2026-10-12T00:00:00+05:30",
    endDate: "2026-10-31T00:00:00+05:30",
  };
  assert.equal(createDiscountRuleSchema.parse(rule).code, "FESTIVE-20");
  assert.equal(createDiscountRuleSchema.safeParse({ ...rule, code: "FESTIVE_20" }).success, false);
  assert.equal(updateDiscountRuleSchema.parse({ code: "festive-21" }).code, "FESTIVE-21");
  assert.equal(updateDiscountRuleSchema.parse({ name: "Festive" }).code, undefined);
});

test("branchCouponPrefix: up to 4 of A–Z 0–9, so generated codes pass the typed-code rules", () => {
  assert.equal(branchCouponPrefix("Manipal"), "MANI");
  assert.equal(branchCouponPrefix("St. Mary's Road"), "STMA");
  assert.equal(branchCouponPrefix("Udupi 2"), "UDUP");
  assert.equal(branchCouponPrefix("A-1"), "A1");
  assert.equal(branchCouponPrefix(""), "BR");
  assert.equal(branchCouponPrefix(null), "BR");
  assert.equal(branchCouponPrefix("!!!"), "BR");

  for (const name of ["Manipal", "St. Mary's Road", "A-1", null]) {
    // Generator shape: PREFIX-XXXXXX, and on its (collision) fallback PREFIX-XXXXXX-<base36 ms>
    const code = `${branchCouponPrefix(name)}-7KQ2XP`;
    assert.equal(couponCodeIssue(code), null, code);
    const fallback = `${code}-${Date.now().toString(36).toUpperCase()}`;
    assert.ok(fallback.length <= COUPON_CODE_MAX_LENGTH, fallback);
    assert.equal(couponCodeIssue(fallback), null, fallback);
  }
});
