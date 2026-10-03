/**
 * Numeric verification of the GST rules as of Oct 3 2026, end to end:
 *   - Rent is GST-INCLUSIVE (item 17): the configured rent is what the customer
 *     pays; discounts come off it; GST = CGST% + SGST% OF the rent after
 *     discounts (splitRentTotal), rent without GST = the rest. Booking fields
 *     stay in taxable terms (totalBase = rent without GST before discounts).
 *   - An extension is the delta of the post-discount inclusive rent, split the
 *     same way.
 *   - Drop / recovery charges (extra km, late return, fuel, FASTag, swap
 *     difference, other charges, damage — penalty too) carry NO GST (item 8).
 * Item-17 engine cases (contracts G1) → booking with a duration discount →
 * extension → drop charges + drop discount → damage penalty in review →
 * invoice, PDF data, GST report, sales report, credit note. Asserts that every
 * document adds up and that only rent is taxed.
 *
 * WRITES DATA — run only against a throwaway database that has been seeded
 * (packages/db prisma/seed.ts: branch "Manipal Central", 9% + 9% GST rule,
 * 5% duration discount for 3–6 days, ₹1500/day four-wheeler):
 *   DATABASE_URL=postgresql://…/vrms_throwaway REDIS_URL=redis://localhost:6379 \
 *     VERIFY_GST_WRITE=1 npx tsx src/scripts/verifyGst.ts
 */
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { prisma, BookingStatus } from "@repo/database/client";
import { computeGst, splitGstInclusive, splitRentTotal, rentWithoutGst } from "@repo/schemas";
import {
  PricingEngineService,
  InclGstTotals,
  rentInclGstFields,
} from "../services/pricing/pricing-engine.service.js";
import { extensionPricingService, extensionSplitData } from "../services/extension/extension-pricing.service.js";
import {
  computeInvoiceGstTotals,
  initialInvoiceGstData,
  refreshInvoiceTotals,
} from "../services/invoice-totals.service.js";
import { finalizeInvoice } from "../services/invoice-finalization.service.js";
import { transformBookingToInvoiceData } from "../services/invoice-data-transformer.js";
import { generateInvoicePDF } from "../services/invoice-pdf-generator.js";
import { damageChargeService } from "../services/damage/damage-charge.service.js";
import { GetGSTReport } from "../controller/admin/gstReportController.js";
import { GetSalesReport } from "../controller/admin/salesReportController.js";
import { IssueCreditNote } from "../controller/branchManager/creditNote.controller.js";
import { createID } from "../utils/nanoID.js";

let failures = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const a = actual instanceof Decimal ? actual.toFixed(2) : typeof actual === "number" ? actual.toFixed(2) : actual;
  const e = expected instanceof Decimal ? expected.toFixed(2) : typeof expected === "number" ? expected.toFixed(2) : expected;
  const ok = JSON.stringify(a) === JSON.stringify(e);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: expected ${e}, got ${a}`);
};
const D = (v: { toString(): string } | number) => new Decimal(v.toString());

const mockRes = () => {
  const r: any = { _status: 200, _json: null };
  r.status = (c: number) => ((r._status = c), r);
  r.json = (x: any) => ((r._json = x), r);
  r.setHeader = () => r;
  r.send = (x: any) => ((r._send = x), r);
  return r;
};

function pureChecks() {
  console.log("\n── pure GST arithmetic");
  // CGST and SGST rounded half-up per tax, GST = CGST + SGST
  const g = computeGst(1425, { cgstRate: 9, sgstRate: 9 });
  eq("cgst 9% of 1425", g.cgst, 128.25);
  eq("gst = cgst + sgst", g.gst, g.cgst + g.sgst);
  const h = computeGst(0.05, { cgstRate: 9, sgstRate: 9 });
  eq("cgst of ₹0.05 rounds half-up", h.cgst, 0);
  const odd = computeGst(105.55, { cgstRate: 9, sgstRate: 9 }); // 9.4995 each
  eq("cgst 9% of 105.55 (9.4995 → 9.50)", odd.cgst, 9.5);
  eq("total = taxable + gst", odd.total, 105.55 + 19);
  const s = splitGstInclusive(1180, { cgstRate: 9, sgstRate: 9 });
  eq("split 1180 @18% taxable", s.taxable, 1000);
  eq("split parts add up", s.taxable + s.gst, 1180);

  // Item 17: GST = 9% + 9% OF the inclusive rent (the client's method)
  const r = { cgstRate: 9, sgstRate: 9 };
  const rent = splitRentTotal(1300, r);
  eq("rent ₹1,300 → without GST", rent.taxable, 1066);
  eq("rent ₹1,300 → CGST", rent.cgst, 117);
  eq("rent ₹1,300 → GST", rent.gst, 234);
  eq("rentWithoutGst(1300)", rentWithoutGst(1300, r), 1066);
  const flat = splitRentTotal(1200, r);
  eq("flat ₹100 coupon: ₹1,200 → without GST", flat.taxable, 984);
  eq("flat ₹100 coupon: ₹1,200 → GST", flat.gst, 216);
  const pct = splitRentTotal(1170, r);
  eq("10% coupon: ₹1,170 → without GST", pct.taxable, 959.4);
  eq("10% coupon: ₹1,170 → CGST", pct.cgst, 105.3);
  const ext = splitRentTotal(1425, r);
  eq("₹1,425 → CGST (128.25)", ext.cgst, 128.25);
  eq("split parts add back to the total", ext.taxable + ext.gst, 1425);
}

async function main() {
  if (process.env.VERIFY_GST_WRITE !== "1") {
    throw new Error("Set VERIFY_GST_WRITE=1 — this script writes bookings to DATABASE_URL (use a throwaway DB)");
  }
  pureChecks();

  const branch = await prisma.branch.findFirstOrThrow({ where: { name: "Manipal Central" } });
  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: { branchId: branch.id, category: { name: { contains: "Four" } } },
    include: { category: true },
  });
  const customer = await prisma.customer.findFirstOrThrow({ include: { user: true } });
  const staff = await prisma.user.findFirstOrThrow({ where: { role: "STAFF" } });
  const rates = await prisma.gSTRule.findUniqueOrThrow({ where: { branchId: branch.id } });
  console.log(`\nbranch ${branch.name}, GST ${rates.cgstRate}% + ${rates.sgstRate}%, vehicle ${vehicle.make} ${vehicle.model}`);
  const gstRates = { cgstRate: Number(rates.cgstRate), sgstRate: Number(rates.sgstRate) };
  const engine = new PricingEngineService();

  // ── 0. Item 17: the contract's cases (₹1,300 / 24 h, ₹800 / 12 h, ₹100 / h) ──
  console.log("\n── GST-inclusive rent (item 17)");
  const g1Pricing = {
    id: 0,
    publicId: "verify-gst",
    vehicleId: vehicle.id,
    enabled: true,
    hourlyRate: "100",
    price12Hour: "800",
    totalRent12Hour: "800",
    price24Hour: "1300",
    totalRent24Hour: "1300",
    rentWithoutGst12Hour: null,
    rentWithoutGst24Hour: null,
    freeKm12Hour: 100,
    freeKm24Hour: 150,
    priceMonthly: null,
    freeKmMonthly: 1500,
    extraKmRate: "8",
    extraHourRate: "100",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  const g1Start = DateTime.fromISO("2027-02-10T10:00:00", { zone: "Asia/Kolkata" });
  const priceG1 = (end: DateTime, coupon?: string) =>
    engine.calculateBookingPrice(
      vehicle.id, g1Start, end, branch.id, customer.id, coupon,
      undefined, undefined, vehicle.categoryId, g1Pricing,
    );
  const day = await priceG1(g1Start.plus({ days: 1 }));
  eq("1 day: rent incl. GST", day.gross.price, 1300);
  eq("1 day: basePrice = rent without GST", day.basePrice, 1066);
  eq("1 day: GST", day.taxAmount, 234);
  eq("1 day: CGST", day.cgstAmount, 117);
  eq("1 day: finalTotal = the price (GST inside)", day.finalTotal, 1300);
  eq("1 day: base − discount + GST = finalTotal", day.basePrice.sub(day.discountAmount).add(day.taxAmount), day.finalTotal);
  const dayHours = await priceG1(g1Start.plus({ days: 1, hours: 2 }));
  eq("1 day + 2 h: 1300 + min(2 × 100, 800)", dayHours.gross.price, 1500);
  eq("1 day + 2 h: rent without GST", dayHours.rentWithoutGst, 1230);
  eq("1 day + 2 h: GST", dayHours.taxAmount, 270);

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const couponWindow = { startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 365 * 86_400_000) };
  const flatRule = await prisma.discountRule.create({
    data: {
      publicId: createID(), code: `VGSTFLAT${createID().slice(0, 6).toUpperCase()}`, name: "verifyGst flat ₹100",
      discountType: "FLAT", value: 100, createdById: admin.id, ...couponWindow,
    },
  });
  const pctRule = await prisma.discountRule.create({
    data: {
      publicId: createID(), code: `VGSTPCT${createID().slice(0, 6).toUpperCase()}`, name: "verifyGst 10%",
      discountType: "PERCENTAGE", value: 10, createdById: admin.id, ...couponWindow,
    },
  });
  const flat = await priceG1(g1Start.plus({ days: 1 }), flatRule.code);
  eq("flat ₹100 coupon applied", flat.discountEvaluation.couponValid, true);
  eq("flat ₹100: coupon off the rent incl. GST", flat.gross.couponDiscount, 100);
  eq("flat ₹100: rent incl. GST after discount", flat.finalTotal, 1200);
  eq("flat ₹100: rent without GST", flat.rentWithoutGst, 984);
  eq("flat ₹100: GST", flat.taxAmount, 216);
  eq("flat ₹100: taxable discount (1066 − 984)", flat.discountAmount, 82);
  eq("flat ₹100: response discountInclGst", rentInclGstFields(flat).discountInclGst, 100);
  const pct = await priceG1(g1Start.plus({ days: 1 }), pctRule.code);
  eq("10% coupon: coupon off the rent incl. GST", pct.gross.couponDiscount, 130);
  eq("10% coupon: rent without GST", pct.rentWithoutGst, 959.4);
  eq("10% coupon: GST", pct.taxAmount, 210.6);
  eq("10% coupon: taxable discount (1066 − 959.40)", pct.discountAmount, 106.6);

  // ── 1. Booking: 3 days → 5% duration discount ─────────────────────────────
  console.log("\n── booking with a discount");
  const startAt = DateTime.fromISO("2027-01-10T10:00:00", { zone: "Asia/Kolkata" });
  const endAt = startAt.plus({ days: 3 });
  const p = await engine.calculateBookingPrice(vehicle.id, startAt, endAt, branch.id, customer.id);
  eq("engine discount > 0", p.discountAmount.gt(0), true);
  eq("engine duration slab = 5% of the rent incl. GST", p.gross.durationDiscount, p.gross.price.mul(0.05));
  eq("engine basePrice = rent without GST of the price", p.basePrice, rentWithoutGst(p.gross.price.toNumber(), gstRates));
  eq("engine GST = 18% of the rent after discounts", p.taxAmount, splitRentTotal(p.gross.total.toNumber(), gstRates).gst);
  eq("engine gst = cgst + sgst", p.taxAmount, p.cgstAmount.add(p.sgstAmount));
  eq("engine finalTotal = base − discount + gst", p.finalTotal, p.basePrice.sub(p.discountAmount).add(p.taxAmount));
  eq("engine finalTotal = rent incl. GST after discounts", p.finalTotal, p.gross.price.sub(p.gross.discount));
  eq("engine cgst rounded to paise", p.cgstAmount.decimalPlaces() <= 2, true);
  eq("engine carries cgstRate", p.cgstRate, Number(rates.cgstRate));

  const totalFinal = p.finalTotal.add(p.deposit);
  const inclGst = new InclGstTotals();
  inclGst.add(p);
  const booking = await prisma.booking.create({
    data: {
      publicId: `gst_${createID()}`,
      customerId: customer.id,
      branchId: branch.id,
      startAt: startAt.toJSDate(),
      endAt: endAt.toJSDate(),
      days: 3,
      totalBase: p.basePrice.toFixed(2),
      totalDiscount: p.discountAmount.toFixed(2),
      totalDeposit: p.deposit.toFixed(2),
      totalTax: p.taxAmount.toFixed(2),
      totalFinal: totalFinal.toFixed(2),
      status: BookingStatus.PICKED_UP,
      // An item-17 booking: frozen rates + the GST-inclusive totals
      pricingSnapshot: { totals: { cgstRate: Number(p.cgstRate), sgstRate: Number(p.sgstRate), ...inclGst.view() } },
      createdById: staff.id,
      items: {
        create: {
          vehicleId: vehicle.id,
          days: 3,
          baseTotal: p.basePrice.toFixed(2),
          discountAmount: p.discountAmount.toFixed(2),
          discountPercent: p.discountPercent.toFixed(2),
          deposit: p.deposit.toFixed(2),
          taxAmount: p.taxAmount.toFixed(2),
          cgstAmount: p.cgstAmount.toFixed(2),
          sgstAmount: p.sgstAmount.toFixed(2),
          taxRate: p.taxRate.toFixed(2),
          finalTotal: totalFinal.toFixed(2),
        },
      },
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      publicId: createID(),
      bookingId: booking.id,
      subtotal: booking.totalBase,
      discount: booking.totalDiscount,
      damageCharges: 0,
      total: booking.totalFinal,
      status: "PENDING",
      ...(await initialInvoiceGstData(booking.id)),
    },
  });
  eq("new invoice tax = booking GST (was 0)", D(invoice.tax), p.taxAmount);
  eq("new invoice deposit", D(invoice.depositAmount), p.deposit);
  eq("new invoice taxable = base − discount", D(invoice.taxableAmount), p.basePrice.sub(p.discountAmount));

  // ── 2. Extension +1 day ────────────────────────────────────────────────────
  console.log("\n── extension");
  const newEnd = endAt.plus({ days: 1 }).toJSDate();
  const ext = await extensionPricingService.recalculate(booking.id, newEnd);
  const p4 = await engine.calculateBookingPrice(vehicle.id, startAt, endAt.plus({ days: 1 }), branch.id, customer.id);
  const expectedAdditional = p4.gross.total.sub(p.gross.total);
  const expectedExtSplit = splitRentTotal(expectedAdditional.toNumber(), gstRates);
  eq("ext additional = Δ post-discount rent incl. GST", ext.additionalAmount, expectedAdditional);
  eq("ext cgst = 9% of the additional amount", ext.cgstAmount, expectedExtSplit.cgst);
  eq("ext tax = cgst + sgst", ext.taxAmount, ext.cgstAmount.add(ext.sgstAmount));
  eq("ext taxable = additional − GST", ext.taxableAmount, expectedAdditional.sub(ext.taxAmount));
  eq("ext base − discount = taxable", ext.baseAmount.sub(ext.discountAmount), ext.taxableAmount);
  eq("ext additional = taxable + tax", ext.additionalAmount, ext.taxableAmount.add(ext.taxAmount));
  eq("ext rate frozen", ext.taxRate, 18);
  eq("ext hours", ext.extensionHours, 24);

  await prisma.bookingExtension.create({
    data: {
      publicId: createID(),
      bookingId: booking.id,
      branchId: branch.id,
      extensionTrigger: "EMPLOYEE_DURING_RENTAL",
      extensionStatus: "CONFIRMED",
      oldEndAt: endAt.toJSDate(),
      requestedEndAt: newEnd,
      actualNewEndAt: newEnd,
      additionalAmount: ext.additionalAmount.toFixed(2),
      newTotalFinal: ext.newTotalFinal.toFixed(2),
      ...extensionSplitData(ext),
      resolutionType: "SAME_VEHICLE",
      actorId: staff.id,
      actorPublicId: staff.publicId,
      actorRole: "STAFF",
    },
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { endAt: newEnd, extensionCount: 1, totalFinal: { increment: ext.additionalAmount.toFixed(2) } },
  });
  await refreshInvoiceTotals(booking.id);

  let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  const expTaxable = p.basePrice.sub(p.discountAmount).add(ext.taxableAmount);
  const expTax = p.taxAmount.add(ext.taxAmount);
  eq("invoice taxable = rental + extension", D(inv.taxableAmount), expTaxable);
  eq("invoice GST = rental GST + extension GST (no double GST)", D(inv.tax), expTax);
  eq("invoice cgst + sgst = tax", D(inv.cgstAmount).add(D(inv.sgstAmount)), D(inv.tax));
  eq("invoice total = booking.totalFinal", D(inv.total), totalFinal.add(ext.additionalAmount));
  eq("invoice taxable + GST + deposit = total", D(inv.taxableAmount).add(D(inv.tax)).add(D(inv.depositAmount)), D(inv.total));
  eq("invoice subtotal − discount = taxable", D(inv.subtotal).sub(D(inv.discount)), D(inv.taxableAmount));

  const pdf1 = await transformBookingToInvoiceData(booking.id);
  const rentalSec = pdf1.taxableSections.find((s) => s.type === "VEHICLE_RENTAL")!;
  eq("PDF rental discount taken once", rentalSec.subtotalBeforeTax - rentalSec.discount, p.basePrice.sub(p.discountAmount).toNumber());
  const extSec = pdf1.taxableSections.find((s) => s.type === "EXTENSION_CHARGES")!;
  eq("PDF extension GST = stored GST", extSec.taxTotal, ext.taxAmount.toNumber());
  eq("PDF extension section total = additionalAmount", extSec.sectionTotal, ext.additionalAmount.toNumber());
  eq("PDF lines + GST + deposit = grand total", pdf1.subtotalBeforeTax + pdf1.totalCgst + pdf1.totalSgst + pdf1.depositAmount, pdf1.grandTotal);
  eq("PDF rounding adjustment", pdf1.roundingAdjustment, 0);
  eq("PDF grand total = invoice.total", pdf1.grandTotal, Number(inv.total));

  // ── 3. Drop: extra km, FASTag, late return and a drop discount — no GST (item 8)
  console.log("\n── drop charges + drop discount (no GST)");
  const session = await prisma.paymentSession.create({
    data: {
      publicId: createID(),
      bookingId: booking.id,
      branchId: branch.id,
      sessionType: "RETURN",
      status: "COMPLETED",
      completedAt: new Date(),
      actorId: staff.id,
    },
  });
  const entry = (data: any) =>
    prisma.ledgerEntry.create({
      data: {
        publicId: createID(),
        sessionId: session.id,
        bookingId: booking.id,
        idempotencyKey: createID(),
        actorId: staff.id,
        actorRole: "STAFF",
        ...data,
      },
    });
  // What the drop bill writes now: every charge NON_TAXABLE at face value, GST 0,
  // and the drop discount wholly non-taxable (taxableShare 0)
  await entry({ entryType: "EXTRA_KM", classification: "NON_TAXABLE", amount: 500, baseAmount: 500, gstAmount: 0, description: "Extra km: 50 km × ₹10" });
  await entry({ entryType: "EXTRA_TIME", classification: "NON_TAXABLE", amount: 160, baseAmount: 160, gstAmount: 0, referenceType: "LATE_RETURN", description: "Late return: 2 h × ₹80" });
  await entry({ entryType: "FASTAG", classification: "NON_TAXABLE", amount: 200, baseAmount: 200, gstAmount: 0, description: "FASTag tolls" });
  await entry({
    entryType: "DISCOUNT",
    classification: "DISCOUNT",
    amount: -100,
    baseAmount: 0,
    gstAmount: 0,
    referenceType: "DROP_DISCOUNT",
    description: "Drop discount",
    metadata: { taxableShare: "0.00", nonTaxableShare: "100.00" },
  });
  await finalizeInvoice(booking.id);
  inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  eq("invoice GST = rent + extension GST only (drop charges add none)", D(inv.tax), expTax);
  eq("invoice taxable = rent + extension (drop charges not taxable)", D(inv.taxableAmount), expTaxable);
  const dropNet = 500 + 160 + 200 - 100;
  eq("invoice total = totalFinal + drop charges at face value", D(inv.total), totalFinal.add(ext.additionalAmount).add(dropNet));
  const dropItems = await prisma.invoiceItem.findMany({
    where: { invoiceId: invoice.id, chargeType: { in: ["EXTRA_KM", "EXTRA_TIME", "FASTAG"] } },
  });
  eq("drop lines on the invoice", dropItems.length, 3);
  eq("drop lines are non-taxable", dropItems.every((i) => !i.isTaxable), true);
  eq("drop lines carry no GST", dropItems.reduce((s, i) => s.add(D(i.taxAmount)), new Decimal(0)), 0);
  const t2 = await computeInvoiceGstTotals(booking.id);
  eq("finalized: taxable + GST + non-taxable + deposit = total", t2.taxableAmount.add(t2.tax).add(t2.nonTaxableAmount).add(t2.depositAmount), t2.total);
  eq("finalized: non-taxable = net drop charges", t2.nonTaxableAmount, dropNet);
  eq("finalized rounding adjustment", t2.roundingAdjustment, 0);

  // ── 4. Damage penalty charged in review: no GST either (item 8) ─────────────
  console.log("\n── damage penalty (no GST)");
  const tax = await damageChargeService.calculateDamageTax(1000, "PENALTY", branch.id);
  eq("penalty GST = 0", tax.taxAmount, 0);
  eq("penalty not taxable", tax.isTaxable, false);
  const comp = await damageChargeService.calculateDamageTax(1000, "COMPENSATION", branch.id);
  eq("compensation not taxed", comp.taxAmount, 0);
  await prisma.$transaction(async (tx) => {
    await damageChargeService.addDamageChargeToInvoice(tx, invoice.id, 1000, "PENALTY", "Damage Charge: dmg_test", tax.taxAmount, "dmg_test");
    await tx.booking.update({ where: { id: booking.id }, data: { totalFinal: { increment: 1000 } } });
  });
  await finalizeInvoice(booking.id); // must keep the review line
  const reviewItems = await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id } });
  const reviewLine = reviewItems.find((i) => i.sourceRef === "DAMAGE_REVIEW:dmg_test");
  eq("damage review line kept by finalization", Boolean(reviewLine), true);
  eq("damage review line carries no GST", reviewLine ? D(reviewLine.taxAmount) : null, 0);
  inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  eq("invoice GST unchanged by the penalty", D(inv.tax), expTax);
  eq("invoice total adds the penalty at face value", D(inv.total), totalFinal.add(ext.additionalAmount).add(dropNet).add(1000));
  const pdf2 = await transformBookingToInvoiceData(booking.id);
  eq("final PDF adds up", pdf2.subtotalBeforeTax + pdf2.totalCgst + pdf2.totalSgst + pdf2.depositAmount, pdf2.grandTotal);
  eq("final PDF grand total = invoice.total", pdf2.grandTotal, Number(inv.total));
  eq("final PDF CGST = invoice CGST", pdf2.totalCgst, Number(inv.cgstAmount));
  const pdfBuf = await generateInvoicePDF(pdf2);
  eq("PDF renders", pdfBuf.length > 1000, true);

  // ── 5. Reports ──────────────────────────────────────────────────────────────
  console.log("\n── reports");
  const q = { startDate: "2027-01-01", endDate: "2027-01-31" };
  const gstRes = mockRes();
  await GetGSTReport({ query: q } as any, gstRes);
  const gstRow = gstRes._json.data.sectionA_output.find((r: any) => r.bookingId === booking.publicId);
  eq("GST report row GST = invoice GST", gstRow.totalGST, Number(inv.tax));
  eq("GST report row taxable = invoice taxable", gstRow.taxableAmount, Number(inv.taxableAmount));
  const salesRes = mockRes();
  await GetSalesReport({ query: q } as any, salesRes);
  const salesRow = salesRes._json.data.data.find((r: any) => r.bookingId === booking.publicId);
  eq("sales report GST includes extension", salesRow.financial.gstAmount, p.taxAmount.add(ext.taxAmount).toNumber());
  eq(
    "sales row base − discount + GST + deposit + review damage = total",
    salesRow.financial.baseAmount - salesRow.financial.discount + salesRow.financial.gstAmount + salesRow.financial.depositAmount + 1000,
    salesRow.financial.totalAmount,
  );

  // ── 6. Credit note ──────────────────────────────────────────────────────────
  console.log("\n── credit note");
  const manager = await prisma.user.findFirstOrThrow({ where: { role: "MANAGER" } });
  const cnRes = mockRes();
  // The taxable part is split in the invoice's own taxable : GST proportion —
  // rent is 18% GST of the inclusive total, so ₹1,300 → 1066 + 117 + 117
  await IssueCreditNote(
    { public_Id: manager.publicId, branch_Id: branch.id, body: { bookingPublicId: booking.publicId, amount: 1300, reason: "Goodwill" } } as any,
    cnRes,
  );
  const cn = cnRes._json.data;
  eq("credit note taxable", cn.taxableAmount, 1066);
  eq("credit note cgst", cn.cgstAmount, 117);
  eq("credit note sgst", cn.sgstAmount, 117);
  eq("credit note parts add up", cn.taxableAmount + cn.cgstAmount + cn.sgstAmount + cn.nonTaxableAmount, 1300);

  console.log(failures === 0 ? "\nALL GST CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
