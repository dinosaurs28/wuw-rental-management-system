import { prisma } from "@repo/database/client";
import { displayEmail } from "../utils/customer/identity.js";
import { computeInvoiceGstTotals, invoiceItemGst } from "./invoice-totals.service.js";

// ─── Section model ─────────────────────────────────────────────────────────────

export type SectionType =
  | "VEHICLE_RENTAL"
  | "EXTENSION_CHARGES"
  | "TAXABLE_RETURN_CHARGES"
  | "DAMAGE_PENALTY"
  | "ADDITIONAL_CHARGES"
  | "DAMAGE_COMPENSATION";

export interface InvoiceSectionItem {
  description: string;
  quantity?: number;  // days, km, hours
  /** Printed in the quantity column instead of the bare number (e.g. "+3 hr") */
  quantityLabel?: string;
  unitRate?: number;  // per-day, per-km rate
  discount?: number;  // monetary discount on this item
  amount: number;     // after the item discount, before GST
  isTaxable: boolean;
  /** CGST / SGST stored on the line when it was created (never recomputed) */
  cgst?: number;
  sgst?: number;
  notes?: string;
}

export interface InvoiceSection {
  type: SectionType;
  title: string;
  items: InvoiceSectionItem[];
  subtotalBeforeTax: number;  // gross: Σ (item amount + item discount)
  discount: number;           // Σ item discounts + section-level discount
  cgst: number;
  sgst: number;
  taxTotal: number;
  sectionTotal: number;  // subtotalBeforeTax - discount + taxTotal
  /** Rate labels for the section's CGST/SGST rows; null when its lines mix rates */
  cgstRate?: number | null;
  sgstRate?: number | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;

  // Branch / Company
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  gstNumber: string;

  // Customer
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;

  // Booking
  bookingId: number;
  bookingPublicId: string;
  startDate: Date;
  endDate: Date;
  days: number;

  // GST rates frozen on the booking (rental); sections carry their own labels
  cgstRate: number;
  sgstRate: number;

  // Sections — drives all PDF pages
  taxableSections: InvoiceSection[];     // VEHICLE_RENTAL + EXTENSION_CHARGES + TAXABLE_RETURN_CHARGES + DAMAGE_PENALTY
  nonTaxableSections: InvoiceSection[];  // ADDITIONAL_CHARGES + DAMAGE_COMPENSATION

  // Pre-computed summary totals
  subtotalBeforeTax: number;
  totalDiscount: number;
  /** Taxable value after discounts (the GST base) */
  taxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  /** Refundable security deposit — inside the grand total, not a taxable supply */
  depositAmount: number;
  /** Grand total − (lines + GST + deposit): paise from legacy unrounded taxes */
  roundingAdjustment: number;
  grandTotal: number;
  /** Coupon applied to the rental, printed next to its discount */
  couponCode: string | null;

  // Payment info for summary page
  paymentStatus: string;
  paymentMethod?: string;
  safetyDepositApplied: number;
}

// ─── Classification ────────────────────────────────────────────────────────────

/** Section of a return-charge / review line. Taxable lines go to the GST pages. */
function classifyChargeType(chargeType: string | null | undefined, isTaxable: boolean): SectionType {
  if (chargeType === "DAMAGE_PENALTY") return "DAMAGE_PENALTY";
  if (chargeType === "DAMAGE_COMPENSATION") return "DAMAGE_COMPENSATION";
  return isTaxable ? "TAXABLE_RETURN_CHARGES" : "ADDITIONAL_CHARGES";
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** One rate when every line shares it, otherwise null (printed without a %). */
function commonRate(rates: number[]): number | null {
  const first = rates[0];
  if (first === undefined) return null;
  return rates.every((r) => r === first) ? first : null;
}

/**
 * A section from stored line values. Items carry their own CGST/SGST (computed
 * when the line was created); nothing is re-taxed here. `sectionDiscount` is a
 * discount on the whole section (the drop discount); item discounts are
 * already netted out of each item's amount.
 */
function buildSection(
  type: SectionType,
  title: string,
  items: InvoiceSectionItem[],
  rateLabel: { cgstRate: number | null; sgstRate: number | null },
  sectionDiscount = 0,
  sectionTax: { cgst: number; sgst: number } = { cgst: 0, sgst: 0 },
): InvoiceSection {
  const itemDiscount = items.reduce((s, i) => s + (i.discount ?? 0), 0);
  const subtotalBeforeTax = round2(items.reduce((s, i) => s + i.amount + (i.discount ?? 0), 0));
  const discount = round2(itemDiscount + sectionDiscount);
  const cgst = round2(items.reduce((s, i) => s + (i.isTaxable ? (i.cgst ?? 0) : 0), 0) + sectionTax.cgst);
  const sgst = round2(items.reduce((s, i) => s + (i.isTaxable ? (i.sgst ?? 0) : 0), 0) + sectionTax.sgst);

  return {
    type,
    title,
    items,
    subtotalBeforeTax,
    discount,
    cgst,
    sgst,
    taxTotal: round2(cgst + sgst),
    sectionTotal: round2(subtotalBeforeTax - discount + cgst + sgst),
    cgstRate: rateLabel.cgstRate,
    sgstRate: rateLabel.sgstRate,
  };
}

/** "+3 hr", "+1 day", "+1 day 4 hr" for an extension's added time. */
function durationLabel(hours: number): string {
  const total = Math.max(0, Math.round(hours * 100) / 100);
  const days = Math.floor(total / 24);
  const rest = Math.round((total - days * 24) * 100) / 100;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (rest > 0 || days === 0) parts.push(`${rest} hr`);
  return `+${parts.join(" ")}`;
}

const fmtIst = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// ─── Transformer ───────────────────────────────────────────────────────────────

export async function transformBookingToInvoiceData(
  bookingId: number,
): Promise<InvoiceData> {
  console.log(`[Invoice Data Transformer] Transforming booking ${bookingId}`);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { include: { user: true } },
      branch: { include: { gstRule: true } },
      items: { include: { vehicle: { include: { category: true } } } },
      invoice: {
        include: {
          items: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  if (!booking.invoice) throw new Error(`Invoice not found for booking ${bookingId}`);

  // ── Stored GST (rental items, confirmed extensions, invoice lines) ──────────
  // Every figure below was computed once when its line was created and stored
  // (BookingItem, BookingExtension split, InvoiceItem.taxAmount) — nothing is
  // re-taxed from the branch's current GST rule.
  const totals = await computeInvoiceGstTotals(booking.id);
  const { cgstRate, sgstRate } = totals.rates;
  const rateLabel = { cgstRate, sgstRate };

  // ── SECTION 1: Vehicle Rental (from BookingItems) ─────────────────────────────
  const rentalCount = booking.items.length;
  const rentalItems: InvoiceSectionItem[] = booking.items.map((item, idx) => {
    const baseTotal = Number(item.baseTotal);
    const discountAmount = Number(item.discountAmount);
    const netAmount = round2(baseTotal - discountAmount);
    // The rental GST total is rounded per tax; put any paise left by older,
    // unrounded per-item values on the last vehicle so the section adds up.
    const isLast = idx === rentalCount - 1;
    const cgstBefore = booking.items.slice(0, idx).reduce((s, i) => s + round2(Number(i.cgstAmount)), 0);
    const sgstBefore = booking.items.slice(0, idx).reduce((s, i) => s + round2(Number(i.sgstAmount)), 0);

    return {
      description: `${item.vehicle.make} ${item.vehicle.model} (${item.vehicle.regNo})`,
      quantity: item.days,
      unitRate: item.days > 0 ? baseTotal / item.days : baseTotal,
      discount: discountAmount,
      amount: netAmount, // net of discount, before GST
      isTaxable: true,
      cgst: isLast ? round2(totals.rental.cgst.toNumber() - cgstBefore) : round2(Number(item.cgstAmount)),
      sgst: isLast ? round2(totals.rental.sgst.toNumber() - sgstBefore) : round2(Number(item.sgstAmount)),
    };
  });

  // Item amounts are already net of their discount: the section takes no
  // second, section-level discount (that used to subtract the rental discount twice).
  const vehicleRentalSection = buildSection("VEHICLE_RENTAL", "Vehicle Rental", rentalItems, rateLabel);

  // ── SECTION 1b: Extension Charges (taxable) ──────────────────────────────────
  // Each confirmed extension's taxable value and GST were stored when it was
  // priced; its amount (taxable + GST) is already inside booking.totalFinal.
  const confirmedExtensions = await prisma.bookingExtension.findMany({
    where: { bookingId: booking.id, extensionStatus: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
  });
  const extensionSplits = new Map(totals.extensions.map((e) => [e.publicId, e]));

  const extensionItems: InvoiceSectionItem[] = confirmedExtensions.map((ext, idx) => {
    const extEndAt = ext.actualNewEndAt ?? ext.requestedEndAt;
    const addedHours = (extEndAt.getTime() - ext.oldEndAt.getTime()) / (1000 * 60 * 60);
    const split = extensionSplits.get(ext.publicId);
    const label = durationLabel(addedHours);
    return {
      description: `Extension #${idx + 1}: ${label} (until ${fmtIst(extEndAt)})`,
      quantity: Math.round(addedHours * 100) / 100,
      quantityLabel: label,
      discount: split ? split.discount.toNumber() : 0,
      amount: split ? split.taxable.toNumber() : Number(ext.additionalAmount),
      isTaxable: true,
      cgst: split ? split.cgst.toNumber() : 0,
      sgst: split ? split.sgst.toNumber() : 0,
      notes: ext.notes ?? undefined,
    };
  });
  const extensionRates = totals.extensions.map((e) => e.taxRate.toNumber());
  const extensionRate = commonRate(extensionRates);
  const extensionRateLabel =
    extensionRate === totals.rates.rate
      ? rateLabel
      : { cgstRate: extensionRate != null ? extensionRate / 2 : null, sgstRate: extensionRate != null ? extensionRate / 2 : null };

  // ── Classify InvoiceItems into bucket arrays ────────────────────────────────
  const penaltyItems: InvoiceSectionItem[] = [];
  const compensationItems: InvoiceSectionItem[] = [];
  const additionalItems: InvoiceSectionItem[] = [];
  const taxableReturnItems: InvoiceSectionItem[] = [];
  // Drop discount: the share on taxable charges (with the GST it reversed)
  // and the share on non-taxable charges, as finalization stored them.
  let taxableDropDiscount = 0;
  let taxableDropDiscountGst = { cgst: 0, sgst: 0 };
  let dropDiscount = 0;

  for (const invItem of booking.invoice.items) {
    const amount = Number(invItem.amount);
    const line = invoiceItemGst(invItem, totals.rates);

    // Discount given at drop (stored as a negative item so invoice.total nets it)
    // is shown as the return-charge sections' discount, not as a charge line.
    if (invItem.chargeType === "DROP_DISCOUNT") {
      if (invItem.isTaxable) {
        taxableDropDiscount += Math.abs(amount);
        taxableDropDiscountGst = {
          cgst: taxableDropDiscountGst.cgst + line.cgst.toNumber(), // negative
          sgst: taxableDropDiscountGst.sgst + line.sgst.toNumber(),
        };
      } else {
        dropDiscount += Math.abs(amount);
      }
      continue;
    }

    const sectionType = classifyChargeType(invItem.chargeType, invItem.isTaxable);

    const sectionItem: InvoiceSectionItem = {
      // "₹" is not in the PDF font (renders as "¹") — print "Rs." like the amounts
      description: invItem.label.replace(/₹\s?/g, "Rs."),
      amount,
      isTaxable: invItem.isTaxable,
      cgst: line.cgst.toNumber(),
      sgst: line.sgst.toNumber(),
    };

    if (sectionType === "DAMAGE_PENALTY") penaltyItems.push(sectionItem);
    else if (sectionType === "DAMAGE_COMPENSATION") compensationItems.push(sectionItem);
    else if (sectionType === "TAXABLE_RETURN_CHARGES") taxableReturnItems.push(sectionItem);
    else additionalItems.push(sectionItem);
  }

  // ── SECTION 2: Extension Charges (taxable, conditional) ─────────────────────
  const taxableSections: InvoiceSection[] = [vehicleRentalSection];

  if (extensionItems.length > 0) {
    taxableSections.push(
      buildSection("EXTENSION_CHARGES", "Rental Extensions", extensionItems, extensionRateLabel),
    );
  }

  // ── SECTION 2b: Taxable return charges (extra km, late return, fuel, swap,
  // other charges) with the drop discount's taxable share ──────────────────────
  if (taxableReturnItems.length > 0 || taxableDropDiscount > 0) {
    taxableSections.push(
      buildSection(
        "TAXABLE_RETURN_CHARGES",
        "Return Charges",
        taxableReturnItems,
        rateLabel,
        taxableDropDiscount,
        taxableDropDiscountGst,
      ),
    );
  }

  // ── SECTION 3: Damage Penalty (taxable, conditional) ─────────────────────────
  if (penaltyItems.length > 0) {
    taxableSections.push(
      buildSection("DAMAGE_PENALTY", "Damage Penalty", penaltyItems, rateLabel),
    );
  }

  // ── SECTION 3: Additional Charges + Damage Compensation (non-taxable page) ───
  const nonTaxableSections: InvoiceSection[] = [];
  const noRate = { cgstRate: null, sgstRate: null };

  // The drop discount's non-taxable share comes off the additional return
  // charges first, then off damage compensation.
  const additionalSubtotal = additionalItems.reduce((s, i) => s + i.amount, 0);
  const additionalDiscount = compensationItems.length > 0
    ? Math.min(dropDiscount, Math.max(0, additionalSubtotal))
    : dropDiscount;
  const compensationDiscount = dropDiscount - additionalDiscount;

  if (additionalItems.length > 0 || (additionalDiscount > 0 && compensationItems.length === 0)) {
    nonTaxableSections.push(
      buildSection(
        "ADDITIONAL_CHARGES",
        "Additional Return Charges",
        additionalItems,
        noRate,
        additionalDiscount,
      ),
    );
  }

  if (compensationItems.length > 0) {
    nonTaxableSections.push(
      buildSection(
        "DAMAGE_COMPENSATION",
        "Damage Compensation",
        compensationItems,
        noRate,
        compensationDiscount,
      ),
    );
  }

  // ── Grand totals ──────────────────────────────────────────────────────────────
  const allSections = [...taxableSections, ...nonTaxableSections];
  const totalDiscount = round2(allSections.reduce((s, sec) => s + sec.discount, 0));
  const totalCgst = round2(allSections.reduce((s, sec) => s + sec.cgst, 0));
  const totalSgst = round2(allSections.reduce((s, sec) => s + sec.sgst, 0));
  const subtotalBeforeTax = round2(allSections.reduce(
    (s, sec) => s + sec.subtotalBeforeTax - sec.discount,
    0,
  ));
  const taxableAmount = round2(
    taxableSections.reduce((s, sec) => s + sec.subtotalBeforeTax - sec.discount, 0),
  );
  // Grand total = stored lines + GST + the refundable deposit (+ legacy paise)
  const depositAmount = totals.depositAmount.toNumber();
  const grandTotal = totals.total.toNumber();
  const roundingAdjustment = round2(grandTotal - subtotalBeforeTax - totalCgst - totalSgst - depositAmount);

  // ── Payment info ──────────────────────────────────────────────────────────────
  const latestPayment = booking.invoice.payments[0];
  const paymentMethod = latestPayment?.method ? String(latestPayment.method) : undefined;

  // ── Customer address ──────────────────────────────────────────────────────────
  const customer = booking.customer;
  const customerAddress =
    [customer.addressLine1, customer.city, customer.state, customer.zipCode]
      .filter(Boolean)
      .join(", ") || "N/A";

  console.log(
    `[Invoice Data Transformer] Booking ${bookingId}: ` +
      `${taxableSections.length} taxable section(s), ` +
      `${nonTaxableSections.length} non-taxable section(s).`,
  );

  // Calculate actual rental duration from the final startAt/endAt (covers extensions).
  // booking.days stores only the original booking days and is not updated on extension.
  const rentalMs = booking.endAt.getTime() - booking.startAt.getTime();
  const actualDays = Math.max(1, Math.ceil(rentalMs / (1000 * 60 * 60 * 24)));

  return {
    invoiceNumber:
      booking.invoice.invoiceNumber ||
      `INV/${new Date().getFullYear()}/${bookingId.toString().padStart(5, "0")}`,
    invoiceDate: booking.invoice.createdAt,

    companyName: booking.branch.name || "Unknown Branch",
    companyAddress: booking.branch.address || "N/A",
    companyPhone: booking.branch.phone || process.env.COMPANY_PHONE || "N/A",
    companyEmail: process.env.COMPANY_EMAIL || "info@company.com",
    gstNumber: booking.branch.gstRule?.gstNumber || "N/A",

    customerName: customer.user?.name || "Guest",
    // Walk-in placeholder / tombstone emails are never printed (#1).
    customerEmail: displayEmail(customer.user?.email) ?? "N/A",
    customerPhone:
      customer.user?.phone || customer.alternatePhone || "N/A",
    customerAddress,

    bookingId: booking.id,
    bookingPublicId: booking.publicId,
    startDate: booking.startAt,
    endDate: booking.endAt,
    days: actualDays,

    cgstRate,
    sgstRate,

    taxableSections,
    nonTaxableSections,

    subtotalBeforeTax,
    totalDiscount,
    taxableAmount,
    totalCgst,
    totalSgst,
    depositAmount,
    roundingAdjustment,
    // Recomputed from the stored lines; equals invoice.total once the invoice
    // totals are in sync (every finalizer / refresh writes the same value).
    grandTotal,
    couponCode: booking.couponCode ?? null,

    paymentStatus: String(booking.invoice.status),
    paymentMethod,
    safetyDepositApplied: Number(booking.safetyDeposit ?? 0),
  };
}
