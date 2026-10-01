/**
 * Numeric verification of the canonical GST rule (#23) end to end:
 * booking with a duration discount → extension → drop charges + drop discount →
 * damage penalty in review → invoice, PDF data, GST report, sales report,
 * credit note. Asserts that every document adds up and that no line is taxed
 * twice (the extension used to carry GST inside its amount and be taxed again).
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
import { computeGst, splitGstInclusive } from "@repo/schemas";
import { PricingEngineService } from "../services/pricing/pricing-engine.service.js";
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

  // ── 1. Booking: 3 days → 5% duration discount ─────────────────────────────
  console.log("\n── booking with a discount");
  const startAt = DateTime.fromISO("2027-01-10T10:00:00", { zone: "Asia/Kolkata" });
  const endAt = startAt.plus({ days: 3 });
  const engine = new PricingEngineService();
  const p = await engine.calculateBookingPrice(vehicle.id, startAt, endAt, branch.id, customer.id);
  eq("engine discount > 0", p.discountAmount.gt(0), true);
  eq("engine gst = cgst + sgst", p.taxAmount, p.cgstAmount.add(p.sgstAmount));
  eq("engine finalTotal = base − discount + gst", p.finalTotal, p.basePrice.sub(p.discountAmount).add(p.taxAmount));
  eq("engine cgst rounded to paise", p.cgstAmount.decimalPlaces() <= 2, true);
  eq("engine carries cgstRate", p.cgstRate, Number(rates.cgstRate));

  const totalFinal = p.finalTotal.add(p.deposit);
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
      pricingSnapshot: { totals: { cgstRate: Number(p.cgstRate), sgstRate: Number(p.sgstRate) } },
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
  const expectedTaxable = p4.basePrice.sub(p4.discountAmount).sub(p.basePrice.sub(p.discountAmount));
  eq("ext taxable = Δ post-discount base", ext.taxableAmount, expectedTaxable);
  eq("ext base − discount = taxable", ext.baseAmount.sub(ext.discountAmount), ext.taxableAmount);
  eq("ext cgst = 9% of taxable", ext.cgstAmount, D(computeGst(expectedTaxable.toNumber(), { cgstRate: 9, sgstRate: 9 }).cgst));
  eq("ext tax = cgst + sgst", ext.taxAmount, ext.cgstAmount.add(ext.sgstAmount));
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

  // ── 3. Drop: taxable extra km, non-taxable FASTag, pre-tax drop discount ────
  console.log("\n── drop charges + drop discount");
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
  const km = computeGst(500, { cgstRate: 9, sgstRate: 9 });
  // Discount ₹100 split pro-rata over taxable 500 / non-taxable 200 → 71.43 / 28.57
  const discTaxable = 71.43;
  const discGst = computeGst(discTaxable, { cgstRate: 9, sgstRate: 9 });
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
  await entry({ entryType: "EXTRA_KM", classification: "TAXABLE", amount: 500, baseAmount: 500, gstAmount: km.gst, description: "Extra km: 50 km × ₹10" });
  await entry({ entryType: "FASTAG", classification: "NON_TAXABLE", amount: 200, description: "FASTag tolls" });
  await entry({
    entryType: "DISCOUNT",
    classification: "DISCOUNT",
    amount: -(100 + discGst.gst),
    baseAmount: -discTaxable,
    gstAmount: -discGst.gst,
    referenceType: "DROP_DISCOUNT",
    description: "Drop discount",
    metadata: { taxableShare: discTaxable.toFixed(2), nonTaxableShare: (100 - discTaxable).toFixed(2) },
  });
  await finalizeInvoice(booking.id);
  inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  const dropGst = km.gst - discGst.gst;
  eq("invoice GST adds extra-km GST minus discount reversal", D(inv.tax), expTax.add(dropGst));
  eq("invoice taxable adds 500 − 71.43", D(inv.taxableAmount), expTaxable.add(500 - discTaxable));
  const dropNet = 500 + km.gst + 200 - (100 + discGst.gst);
  eq("invoice total = totalFinal + net drop charges", D(inv.total), totalFinal.add(ext.additionalAmount).add(dropNet));
  const t2 = await computeInvoiceGstTotals(booking.id);
  eq("finalized: taxable + GST + non-taxable + deposit = total", t2.taxableAmount.add(t2.tax).add(t2.nonTaxableAmount).add(t2.depositAmount), t2.total);
  eq("finalized rounding adjustment", t2.roundingAdjustment, 0);

  // ── 4. Damage penalty charged in review: CGST + SGST only ───────────────────
  console.log("\n── damage penalty");
  const tax = await damageChargeService.calculateDamageTax(1000, "PENALTY", branch.id);
  eq("penalty GST = 18% (CGST + SGST, never IGST)", tax.taxAmount, 180);
  const comp = await damageChargeService.calculateDamageTax(1000, "COMPENSATION", branch.id);
  eq("compensation not taxed", comp.taxAmount, 0);
  await prisma.$transaction(async (tx) => {
    await damageChargeService.addDamageChargeToInvoice(tx, invoice.id, 1000, "PENALTY", "Damage Charge: dmg_test", 180, "dmg_test");
    await tx.booking.update({ where: { id: booking.id }, data: { totalFinal: { increment: 1180 } } });
  });
  await finalizeInvoice(booking.id); // must keep the review line
  const reviewItems = await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id } });
  eq("damage review line kept by finalization", reviewItems.some((i) => i.sourceRef === "DAMAGE_REVIEW:dmg_test"), true);
  inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  eq("invoice GST adds penalty GST", D(inv.tax), expTax.add(dropGst).add(180));
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
    salesRow.financial.baseAmount - salesRow.financial.discount + salesRow.financial.gstAmount + salesRow.financial.depositAmount + 1180,
    salesRow.financial.totalAmount,
  );

  // ── 6. Credit note ──────────────────────────────────────────────────────────
  console.log("\n── credit note");
  const manager = await prisma.user.findFirstOrThrow({ where: { role: "MANAGER" } });
  const cnRes = mockRes();
  await IssueCreditNote(
    { public_Id: manager.publicId, branch_Id: branch.id, body: { bookingPublicId: booking.publicId, amount: 1180, reason: "Goodwill" } } as any,
    cnRes,
  );
  const cn = cnRes._json.data;
  eq("credit note taxable", cn.taxableAmount, 1000);
  eq("credit note cgst", cn.cgstAmount, 90);
  eq("credit note parts add up", cn.taxableAmount + cn.cgstAmount + cn.sgstAmount + cn.nonTaxableAmount, 1180);

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
