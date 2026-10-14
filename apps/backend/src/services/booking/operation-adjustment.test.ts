/**
 * Pure checks of the money difference of an edit to a completed pickup / drop
 * (client item 1, full edit): line-by-line delta, unchanged lines kept, the
 * collect / refund / no-change outcome and how it can be settled, deposit
 * handling at drop, the pickup → drop cross-effect, the discount cap, credit
 * taken off before a refund, the stored GST of taxed bills, replacing an
 * unsettled difference and the billed late policy. No database.
 *   cd apps/backend && pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import type { OdometerSegments } from "../charges/km-allowance.service.js";
import {
  adjustmentLineKey,
  adjustmentSettleProblem,
  billedLatePolicy,
  capDropDiscount,
  creditOffset,
  creditReductionLine,
  depositAdjustmentLine,
  depositOutcome,
  diffAdjustmentLines,
  dropNet,
  keepUnchangedLines,
  netDropEntries,
  settlementMethods,
  settlementOf,
  withStoredTax,
  type AdjustmentLine,
} from "./operation-adjustment.js";
import { billedKmAllowance, billedKmCharge, withPickupOdometer } from "./operation-edit-guard.js";

const d = (n: number | string) => new Decimal(n);
const line = (entryType: string, amount: number, extra: Partial<AdjustmentLine> = {}): AdjustmentLine => ({
  part: "DROP",
  entryType,
  classification: entryType === "DISCOUNT" ? "DISCOUNT" : "NON_TAXABLE",
  referenceType: null,
  referenceId: null,
  label: entryType,
  amount: d(amount),
  ...extra,
});

test("charges up: the extra km grew — collect the difference", () => {
  const before = [line("EXTRA_KM", 500), line("FUEL", 200)];
  const after = [line("EXTRA_KM", 750, { label: "Extra km: 75 km × ₹10.00" }), line("FUEL", 200)];
  const out = diffAdjustmentLines(before, after);
  assert.equal(out.delta.toFixed(2), "250.00");
  assert.equal(out.oldTotal.toFixed(2), "700.00");
  assert.equal(out.newTotal.toFixed(2), "950.00");
  const km = out.lines.find((l) => l.entryType === "EXTRA_KM")!;
  assert.equal(km.delta.toFixed(2), "250.00");
  assert.equal(km.label, "Extra km: 75 km × ₹10.00");
  assert.equal(out.lines.find((l) => l.entryType === "FUEL")!.delta.toFixed(2), "0.00");
  assert.deepEqual(settlementOf(out.delta), { action: "COLLECT", amount: d("250.00") });
});

test("charges down: fuel line removed, discount added — refund", () => {
  const before = [line("EXTRA_KM", 500), line("FUEL", 200)];
  const after = [line("EXTRA_KM", 500), line("DISCOUNT", -100, { referenceType: "DROP_DISCOUNT" })];
  const out = diffAdjustmentLines(before, after);
  assert.equal(out.delta.toFixed(2), "-300.00");
  assert.equal(out.lines.find((l) => l.entryType === "FUEL")!.newAmount.toFixed(2), "0.00");
  assert.equal(out.lines.find((l) => l.entryType === "DISCOUNT")!.oldAmount.toFixed(2), "0.00");
  assert.deepEqual(settlementOf(out.delta), { action: "REFUND", amount: d("300.00") });
});

test("unchanged: same bill (even split across the original and an earlier edit) — no money", () => {
  const before = [line("EXTRA_KM", 500), line("EXTRA_KM", -100, { label: "Extra km (edited)" })];
  const after = [line("EXTRA_KM", 400)];
  const out = diffAdjustmentLines(before, after);
  assert.equal(out.delta.toFixed(2), "0.00");
  assert.deepEqual(settlementOf(out.delta), { action: "NONE", amount: d(0) });
  assert.deepEqual(settlementOf(d("0.004")), { action: "NONE", amount: d(0) });
});

test("lines are matched by type and reference; other charges compare as one line", () => {
  const dmgA = { referenceType: "DROP_DAMAGE", referenceId: "dmgA" };
  const dmgB = { referenceType: "DROP_DAMAGE", referenceId: "dmgB" };
  assert.notEqual(adjustmentLineKey({ part: "DROP", entryType: "DAMAGE", ...dmgA }), adjustmentLineKey({ part: "DROP", entryType: "DAMAGE", ...dmgB }));
  const other = (label: string, amount: number) => line("DAMAGE", amount, { referenceType: "OTHER_CHARGE", label });
  const out = diffAdjustmentLines(
    [other("Cleaning", 100), other("Towing", 300), line("DAMAGE", 1000, dmgA)],
    [other("Cleaning", 150), other("Key cover", 50), line("DAMAGE", 800, dmgA)],
  );
  const others = out.lines.find((l) => l.referenceType === "OTHER_CHARGE")!;
  assert.equal(others.oldAmount.toFixed(2), "400.00");
  assert.equal(others.newAmount.toFixed(2), "200.00");
  assert.equal(others.label, "Cleaning, Key cover");
  assert.equal(out.lines.find((l) => l.referenceId === "dmgA")!.delta.toFixed(2), "-200.00");
  assert.equal(out.delta.toFixed(2), "-400.00");
});

test("keepUnchangedLines: lines whose inputs didn't change keep their billed amount", () => {
  // Billed late charge ₹300 at a rate since changed; only the fuel input was edited
  const before = [line("EXTRA_TIME", 300), line("FUEL", 200)];
  const recomputed = [line("EXTRA_TIME", 450), line("FUEL", 250)];
  const kept = keepUnchangedLines(before, recomputed, (l) => l.entryType === "FUEL");
  assert.deepEqual(
    kept.map((l) => [l.entryType, l.amount.toFixed(2)]),
    [["EXTRA_TIME", "300.00"], ["FUEL", "250.00"]],
  );
  assert.equal(diffAdjustmentLines(before, kept).delta.toFixed(2), "50.00");
});

test("deposit handling at drop: switching set-off / refund-in-full moves no money", () => {
  for (const [held, charges] of [[2000, 500], [500, 2000], [1000, 1000], [0, 300]] as const) {
    const setOff = depositOutcome("SET_OFF", d(held), d(charges));
    const refundAll = depositOutcome("REFUND_IN_FULL", d(held), d(charges));
    assert.equal(dropNet(setOff).toFixed(2), dropNet(refundAll).toFixed(2), `${held}/${charges}`);
    assert.equal(dropNet(setOff).toFixed(2), d(charges).minus(held).toFixed(2));
  }
  assert.deepEqual(depositOutcome("SET_OFF", d(2000), d(500)), { setOff: d(500), refund: d(1500), toCollect: d(0) });
  assert.deepEqual(depositOutcome("REFUND_IN_FULL", d(2000), d(500)), { setOff: d(0), refund: d(2000), toCollect: d(500) });
});

test("pickup deposit raised / lowered while the car is out", () => {
  const dep = (amount: number): AdjustmentLine => ({ ...line("DEPOSIT", amount), part: "PICKUP", referenceType: "SAFETY_DEPOSIT" });
  const up = diffAdjustmentLines([dep(2000)], [dep(3000)]);
  assert.deepEqual(settlementOf(up.delta), { action: "COLLECT", amount: d("1000.00") });
  const down = diffAdjustmentLines([dep(2000)], [dep(500)]);
  assert.deepEqual(settlementOf(down.delta), { action: "REFUND", amount: d("1500.00") });
});

test("cross-effect: a corrected pickup reading re-prices the completed drop's km", () => {
  const segments: OdometerSegments = {
    swapCount: 0, swapsMissingReadings: 0, complete: true, priorKm: 0,
    currentStartOdometer: 1000, currentStartFuelLevel: null, segments: [],
  };
  const billed = billedKmAllowance({
    billKm: { includedKm: 100, extraKmRate: "10.00", extraKmEnabled: true },
    freeKmLimit: 100,
    extraKmCharged: 50,
    legacyExtraKmRate: null,
  });
  const kmLine = (segs: OdometerSegments) => line("EXTRA_KM", billedKmCharge(billed, segs, 1150).charge!.toNumber());
  // Pickup reading 1000 → 1100: 50 km instead of 150 → ₹0 instead of ₹500
  const out = diffAdjustmentLines([kmLine(segments)], [kmLine(withPickupOdometer(segments, 1100))]);
  assert.equal(out.delta.toFixed(2), "-500.00");
  // Folded with a pickup deposit raise in the same edit
  const dep = (amount: number): AdjustmentLine => ({ ...line("DEPOSIT", amount), part: "PICKUP" });
  const both = diffAdjustmentLines([kmLine(segments), dep(1000)], [kmLine(withPickupOdometer(segments, 1100)), dep(1200)]);
  assert.equal(both.delta.toFixed(2), "-300.00");
  assert.equal(both.lines.length, 2);
});

test("settlement methods: cash / UPI / split / credit to collect, cash / UPI to refund", () => {
  assert.deepEqual(settlementMethods({ action: "COLLECT", depositIncrease: false, settledByBranchManager: false }), {
    collect: ["CASH", "UPI", "SPLIT", "CREDIT"],
    refund: [],
  });
  // A safety deposit is never taken on credit
  assert.deepEqual(settlementMethods({ action: "COLLECT", depositIncrease: true, settledByBranchManager: false }).collect, ["CASH", "UPI", "SPLIT"]);
  assert.deepEqual(settlementMethods({ action: "REFUND", depositIncrease: false, settledByBranchManager: false }), {
    collect: [],
    refund: ["CASH", "UPI"],
  });
  assert.deepEqual(settlementMethods({ action: "NONE", depositIncrease: false, settledByBranchManager: false }), { collect: [], refund: [] });
  // Legacy drop: the branch manager settles return charges in Settlements
  assert.deepEqual(settlementMethods({ action: "COLLECT", depositIncrease: false, settledByBranchManager: true }), { collect: [], refund: [] });
});

test("netDropEntries: the invoice reads the drop bill as edited", () => {
  const row = (publicId: string, entryType: string, amount: number, extra: Record<string, unknown> = {}) => ({
    publicId,
    entryType,
    classification: entryType === "DISCOUNT" ? "DISCOUNT" : entryType === "PAYMENT" ? "PAYMENT" : "NON_TAXABLE",
    referenceType: null as string | null,
    referenceId: null as string | null,
    description: `${entryType} line`,
    amount: String(amount),
    gstAmount: "0",
    ...extra,
  });
  const original = [
    row("km1", "EXTRA_KM", 500, { referenceType: "EXTRA_KM" }),
    row("fuel1", "FUEL", 200, { referenceType: "FUEL" }),
    row("oth1", "DAMAGE", 100, { referenceType: "OTHER_CHARGE", description: "Cleaning" }),
    row("pay1", "PAYMENT", -800),
  ];
  // No edit: unchanged
  assert.equal(netDropEntries(original, []).length, 4);

  const adjustments = [
    row("a1", "EXTRA_KM", 250, { referenceType: "EXTRA_KM", metadata: { part: "DROP", label: "Extra km: 75 km × ₹10.00" } }),
    row("a2", "FUEL", -200, { referenceType: "FUEL", metadata: { part: "DROP", label: "Fuel deficit charge" } }),
    row("a3", "DISCOUNT", -50, { referenceType: "DROP_DISCOUNT", metadata: { part: "DROP", label: "Drop discount: goodwill" } }),
    row("a4", "DEPOSIT", 300, { metadata: { part: "PICKUP" } }), // not a drop line
  ];
  const net = netDropEntries(original, adjustments);
  const byId = new Map(net.map((e) => [e.publicId, e]));
  assert.equal(byId.get("km1")!.amount, "750.00");
  assert.equal(byId.get("km1")!.description, "Extra km: 75 km × ₹10.00");
  assert.equal(byId.has("fuel1"), false); // netted to ₹0
  assert.equal(byId.get("a3")!.amount, "-50.00"); // a new discount line
  assert.equal(byId.get("oth1")!.amount, "100"); // other charges untouched by the edit stay as they were
  assert.equal(byId.get("pay1")!.amount, "-800"); // money rows pass through
  assert.equal(byId.has("a4"), false);
});

// ── Money review fixes ──────────────────────────────────────────────────────

const discount = (amount: number, extra: Partial<AdjustmentLine> = {}) =>
  line("DISCOUNT", amount, { referenceType: "DROP_DISCOUNT", label: "Drop discount: goodwill", ...extra });

test("discount re-capped when the charges fall: ₹1,000 km − ₹500 discount, km edited to ₹0 → refund ₹500", () => {
  const billed = [line("EXTRA_KM", 1000, { referenceType: "EXTRA_KM" }), discount(-500)];
  // Km worked out again to ₹0 (no line); the discount was kept as billed
  const kept = keepUnchangedLines(billed, [], (l) => l.entryType === "EXTRA_KM");
  const capped = capDropDiscount(kept, d(500));
  assert.equal(capped.some((l) => l.entryType === "DISCOUNT"), false);
  const out = diffAdjustmentLines(billed, capped);
  assert.equal(out.delta.toFixed(2), "-500.00");
  assert.deepEqual(settlementOf(out.delta), { action: "REFUND", amount: d("500.00") });

  // Cut to ₹300 of charges, then back up to what staff gave when the charges return
  const cut = capDropDiscount([line("EXTRA_KM", 300, { referenceType: "EXTRA_KM" }), discount(-500)], d(500));
  assert.equal(cut.find((l) => l.entryType === "DISCOUNT")!.amount.toFixed(2), "-300.00");
  const back = capDropDiscount([line("EXTRA_KM", 900, { referenceType: "EXTRA_KM" }), discount(-300)], d(500));
  assert.equal(back.find((l) => l.entryType === "DISCOUNT")!.amount.toFixed(2), "-500.00");
  // A discount within the charges stands as billed
  const kept2 = [line("EXTRA_KM", 900), discount(-500)];
  assert.equal(capDropDiscount(kept2, d(500)), kept2);
  // A discount that reversed GST keeps its split in proportion
  const taxed = capDropDiscount(
    [line("EXTRA_KM", 590, { classification: "TAXABLE", gst: d(90) }), discount(-1180, { gst: d(-180), base: d(-1000) })],
    d(1000),
  ).find((l) => l.entryType === "DISCOUNT")!;
  assert.equal(taxed.amount.toFixed(2), "-590.00");
  assert.equal(taxed.gst!.toFixed(2), "-90.00");
  assert.equal(taxed.base!.toFixed(2), "-500.00");
});

test("credit taken off before a refund: ₹3,000 on credit, charges lowered ₹4,000 → clear ₹3,000 + refund ₹1,000", () => {
  assert.deepEqual(creditOffset(d(-4000), d(3000)), { reduction: d(3000), net: d(-1000) });
  // All of it comes off the credit: nothing to refund
  assert.deepEqual(creditOffset(d(-2000), d(3000)), { reduction: d(2000), net: d(0) });
  // A raise is collected normally; no credit, a full refund
  assert.deepEqual(creditOffset(d(500), d(3000)), { reduction: d(0), net: d(500) });
  assert.deepEqual(creditOffset(d(-4000), d(0)), { reduction: d(0), net: d(-4000) });
  // Its own line in the plan, and the plan's total is the refund
  const charges = diffAdjustmentLines([line("EXTRA_KM", 5000)], [line("EXTRA_KM", 1000)]);
  const credit = creditReductionLine("DROP", creditOffset(charges.delta, d(3000)).reduction);
  assert.equal(credit.entryType, "CREDIT");
  assert.equal(credit.classification, "PAYMENT");
  assert.equal(credit.delta.toFixed(2), "3000.00");
  const total = [...charges.lines, credit].reduce((s, l) => s.plus(l.delta), d(0));
  assert.deepEqual(settlementOf(total), { action: "REFUND", amount: d("1000.00") });
});

test("a taxed drop bill (before item 8) keeps its GST: +1 km is +₹11.80, not a ₹170 refund", () => {
  const billed = [
    line("EXTRA_KM", 1180, { classification: "TAXABLE", referenceType: "EXTRA_KM", gst: d(180) }),
    line("FUEL", 236, { classification: "TAXABLE", referenceType: "FUEL", gst: d(36) }),
  ];
  // Km worked out again as the drop bill would before GST: ₹1,010
  const recomputed = withStoredTax([line("EXTRA_KM", 1010, { referenceType: "EXTRA_KM" })], billed);
  assert.equal(recomputed[0]!.classification, "TAXABLE");
  assert.equal(recomputed[0]!.amount.toFixed(2), "1191.80");
  assert.equal(recomputed[0]!.gst!.toFixed(2), "181.80");
  const out = diffAdjustmentLines(billed, keepUnchangedLines(billed, recomputed, (l) => l.entryType === "EXTRA_KM"));
  assert.equal(out.delta.toFixed(2), "11.80");
  const km = out.lines.find((l) => l.entryType === "EXTRA_KM")!;
  assert.equal(km.classification, "TAXABLE");
  assert.equal(km.gstDelta.toFixed(2), "1.80");
  // A new line has no taxed counterpart: non-taxable (item 8)
  assert.equal(withStoredTax([line("DAMAGE", 300)], billed)[0]!.classification, "NON_TAXABLE");

  // The invoice nets only the touched line, keeping its taxable value and GST apart
  const row = (publicId: string, entryType: string, amount: string, gstAmount: string, extra: Record<string, unknown> = {}) => ({
    publicId, entryType, classification: "TAXABLE", referenceType: entryType, referenceId: null as string | null,
    description: `${entryType} line`, amount, gstAmount, baseAmount: amount, ...extra,
  });
  const net = netDropEntries(
    [row("km1", "EXTRA_KM", "1000.00", "180.00"), row("fuel1", "FUEL", "200.00", "36.00")],
    [row("a1", "EXTRA_KM", "10.00", "1.80", { metadata: { part: "DROP", label: "Extra km: 101 km × ₹10.00" } })],
  );
  const byId = new Map(net.map((e) => [e.publicId, e]));
  assert.equal(byId.get("km1")!.classification, "TAXABLE");
  assert.equal(byId.get("km1")!.amount, "1010.00");
  assert.equal(byId.get("km1")!.gstAmount, "181.80");
  // An untouched taxed line passes through with its GST
  assert.equal(byId.get("fuel1")!.gstAmount, "36.00");
  // Credit taken off on an edit is money, never an invoice line
  const withCredit = netDropEntries(
    [row("km1", "EXTRA_KM", "1000.00", "180.00")],
    [{ ...row("c1", "CREDIT", "300.00", "0"), classification: "PAYMENT", metadata: { part: "DROP" } }],
  );
  assert.deepEqual(withCredit.map((e) => e.publicId), ["km1"]);
});

test("a new edit replaces an unsettled difference: worked out from the last settled state", () => {
  // ₹5,000 deposit paid, raised to ₹7,000 and left to settle later (booking now says ₹7,000)
  const pendingDelta = d(2000);
  // Typo fixed back to ₹5,000: nothing to collect any more
  assert.equal(depositAdjustmentLine({ current: d(7000), pendingDelta, target: d(5000) }), null);
  // Raised again to ₹8,000: ₹3,000 from the settled ₹5,000
  const up = depositAdjustmentLine({ current: d(7000), pendingDelta, target: d(8000) })!;
  assert.equal(up.oldAmount.toFixed(2), "5000.00");
  assert.equal(up.delta.toFixed(2), "3000.00");
  // An edit that leaves the deposit carries the unsettled raise forward
  assert.equal(depositAdjustmentLine({ current: d(7000), pendingDelta, target: d(7000) })!.delta.toFixed(2), "2000.00");
  // No unsettled difference: an unchanged deposit is no line
  assert.equal(depositAdjustmentLine({ current: d(5000), pendingDelta: d(0), target: d(5000) }), null);

  // A ₹10,000 km typo left unsettled: the bill without it, km worked out again with the fixed reading
  const settled = [line("EXTRA_KM", 1000, { referenceType: "EXTRA_KM" }), line("FUEL", 200, { referenceType: "FUEL" })];
  const fixed = keepUnchangedLines(settled, [line("EXTRA_KM", 1000, { referenceType: "EXTRA_KM" })], (l) => l.entryType === "EXTRA_KM");
  assert.equal(diffAdjustmentLines(settled, fixed).delta.toFixed(2), "0.00");
});

test("a late return keeps the policy it billed with (rate, grace, extra time charged)", () => {
  const live = { extraTimeEnabled: true, gracePolicyEnabled: true, graceType: "AUTO", graceMinutes: 60, extraHourRate: d(200) };
  const billed = billedLatePolicy(live, {
    rate: "150.00",
    graceMinutes: 30,
    graceType: "MANUAL",
    gracePolicyEnabled: true,
    extraTimeEnabled: false,
  });
  assert.equal(billed.extraHourRate!.toFixed(2), "150.00");
  assert.equal(billed.graceMinutes, 30);
  assert.equal(billed.graceType, "MANUAL");
  assert.equal(billed.extraTimeEnabled, false);
  // A legacy row that recorded only its rate keeps today's grace
  const rateOnly = billedLatePolicy(live, { rate: "180" });
  assert.equal(rateOnly.extraHourRate!.toFixed(2), "180.00");
  assert.equal(rateOnly.graceMinutes, 60);
  assert.equal(billedLatePolicy(live, null), live);
});

test("settling a difference never collects twice nor refunds more than was paid", () => {
  // ₹1,000 drop correction, nothing else unpaid: collect it
  assert.equal(adjustmentSettleProblem(d(1000), d(1000), d(0)), null);
  // Collected in Settlements meanwhile: nothing left unpaid
  assert.equal(adjustmentSettleProblem(d(1000), d(0), d(0)), "ALREADY_COLLECTED");
  // A deposit raise isn't owed until collected — it has its own room
  assert.equal(adjustmentSettleProblem(d(2000), d(0), d(2000)), null);
  // Refund ₹1,000 of ₹1,000 overpaid; a deposit lowered ₹2,000 is refundable on its own
  assert.equal(adjustmentSettleProblem(d(-1000), d(-1000), d(0)), null);
  assert.equal(adjustmentSettleProblem(d(-2000), d(0), d(-2000)), null);
  assert.equal(adjustmentSettleProblem(d(-1000), d(0), d(0)), "ALREADY_REFUNDED");
});
