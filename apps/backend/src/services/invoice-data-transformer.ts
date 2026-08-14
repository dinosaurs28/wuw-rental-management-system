import { prisma } from "@repo/database/client";

// ─── Section model ─────────────────────────────────────────────────────────────

export type SectionType =
  | "VEHICLE_RENTAL"
  | "EXTENSION_CHARGES"
  | "DAMAGE_PENALTY"
  | "ADDITIONAL_CHARGES"
  | "DAMAGE_COMPENSATION";

export interface InvoiceSectionItem {
  description: string;
  quantity?: number;  // days, km, hours
  unitRate?: number;  // per-day, per-km rate
  discount?: number;  // monetary discount on this item
  amount: number;     // base amount (before GST)
  isTaxable: boolean;
  notes?: string;
}

export interface InvoiceSection {
  type: SectionType;
  title: string;
  items: InvoiceSectionItem[];
  subtotalBeforeTax: number;
  discount: number;
  cgst: number;
  sgst: number;
  taxTotal: number;
  sectionTotal: number;  // subtotalBeforeTax - discount + taxTotal
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

  // GST rates from branch rule
  cgstRate: number;
  sgstRate: number;

  // Sections — drives all PDF pages
  taxableSections: InvoiceSection[];     // VEHICLE_RENTAL + DAMAGE_PENALTY
  nonTaxableSections: InvoiceSection[];  // ADDITIONAL_CHARGES + DAMAGE_COMPENSATION

  // Pre-computed summary totals
  subtotalBeforeTax: number;
  totalDiscount: number;
  totalCgst: number;
  totalSgst: number;
  grandTotal: number;

  // Payment info for summary page
  paymentStatus: string;
  paymentMethod?: string;
  safetyDepositApplied: number;
}

// ─── Classification ────────────────────────────────────────────────────────────

const ADDITIONAL_CHARGE_TYPES = new Set([
  "EXTRA_KM",
  "EXTRA_TIME",
  "FUEL_DEFICIT",
  "FASTAG",
  "GRACE_ADJUSTMENT",
]);

function classifyChargeType(chargeType: string | null | undefined): SectionType {
  if (!chargeType) return "ADDITIONAL_CHARGES";
  if (chargeType === "DAMAGE_PENALTY") return "DAMAGE_PENALTY";
  if (chargeType === "DAMAGE_COMPENSATION") return "DAMAGE_COMPENSATION";
  if (ADDITIONAL_CHARGE_TYPES.has(chargeType)) return "ADDITIONAL_CHARGES";
  return "ADDITIONAL_CHARGES"; // safe fallback for unknown types
}

function buildSection(
  type: SectionType,
  title: string,
  items: InvoiceSectionItem[],
  cgstRate: number,
  sgstRate: number,
  sectionDiscount = 0,
): InvoiceSection {
  const subtotalBeforeTax = items.reduce((s, i) => s + i.amount, 0);

  let cgst = 0;
  let sgst = 0;

  for (const item of items) {
    if (item.isTaxable) {
      cgst += item.amount * (cgstRate / 100);
      sgst += item.amount * (sgstRate / 100);
    }
  }

  return {
    type,
    title,
    items,
    subtotalBeforeTax,
    discount: sectionDiscount,
    cgst,
    sgst,
    taxTotal: cgst + sgst,
    sectionTotal: subtotalBeforeTax - sectionDiscount + cgst + sgst,
  };
}

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

  // ── GST rates ────────────────────────────────────────────────────────────────
  const cgstRate = booking.branch.gstRule
    ? Number(booking.branch.gstRule.cgstRate)
    : 9;
  const sgstRate = booking.branch.gstRule
    ? Number(booking.branch.gstRule.sgstRate)
    : 9;

  // ── SECTION 1: Vehicle Rental (from BookingItems) ─────────────────────────────
  const rentalItems: InvoiceSectionItem[] = booking.items.map((item) => {
    const baseTotal = Number(item.baseTotal);
    const discountAmount = Number(item.discountAmount);
    const netAmount = baseTotal - discountAmount;

    return {
      description: `${item.vehicle.make} ${item.vehicle.model} (${item.vehicle.regNo})`,
      quantity: item.days,
      unitRate: item.days > 0 ? baseTotal / item.days : baseTotal,
      discount: discountAmount,
      amount: netAmount, // net of discount, before GST
      isTaxable: true,
    };
  });

  const rentalDiscount = rentalItems.reduce((s, i) => s + (i.discount ?? 0), 0);
  const vehicleRentalSection = buildSection(
    "VEHICLE_RENTAL",
    "Vehicle Rental",
    rentalItems,
    cgstRate,
    sgstRate,
    rentalDiscount,
  );

  // ── SECTION 1b: Extension Charges (taxable) ──────────────────────────────────
  // Fetch all confirmed extensions for this booking
  const confirmedExtensions = await prisma.bookingExtension.findMany({
    where: { bookingId: booking.id, extensionStatus: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
  });

  const extensionItems: InvoiceSectionItem[] = confirmedExtensions.map((ext, idx) => {
    const originalDays = Math.max(
      1,
      Math.ceil(
        (ext.oldEndAt.getTime() - booking.startAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const extEndAt = ext.actualNewEndAt ?? ext.requestedEndAt;
    const newDays = Math.max(
      1,
      Math.ceil(
        (extEndAt.getTime() - booking.startAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const additionalDays = newDays - originalDays;
    return {
      description: `Extension #${idx + 1}: +${additionalDays} day${additionalDays !== 1 ? "s" : ""} (until ${extEndAt.toLocaleDateString("en-IN")})`,
      quantity: additionalDays,
      amount: Number(ext.additionalAmount),
      isTaxable: true,
      notes: ext.notes ?? undefined,
    };
  });

  // ── Classify InvoiceItems into bucket arrays ────────────────────────────────
  const penaltyItems: InvoiceSectionItem[] = [];
  const compensationItems: InvoiceSectionItem[] = [];
  const additionalItems: InvoiceSectionItem[] = [];

  for (const invItem of booking.invoice.items) {
    const amount = Number(invItem.amount);
    const sectionType = classifyChargeType(invItem.chargeType ?? undefined);

    const sectionItem: InvoiceSectionItem = {
      description: invItem.label,
      amount,
      isTaxable: invItem.isTaxable,
    };

    if (sectionType === "DAMAGE_PENALTY") penaltyItems.push(sectionItem);
    else if (sectionType === "DAMAGE_COMPENSATION") compensationItems.push(sectionItem);
    else additionalItems.push(sectionItem);
  }

  // ── SECTION 2: Extension Charges (taxable, conditional) ─────────────────────
  const taxableSections: InvoiceSection[] = [vehicleRentalSection];

  if (extensionItems.length > 0) {
    taxableSections.push(
      buildSection("EXTENSION_CHARGES", "Rental Extensions", extensionItems, cgstRate, sgstRate),
    );
  }

  // ── SECTION 3: Damage Penalty (taxable, conditional) ─────────────────────────
  if (penaltyItems.length > 0) {
    taxableSections.push(
      buildSection("DAMAGE_PENALTY", "Damage Penalty", penaltyItems, cgstRate, sgstRate),
    );
  }

  // ── SECTION 3: Additional Charges + Damage Compensation (non-taxable page) ───
  const nonTaxableSections: InvoiceSection[] = [];

  if (additionalItems.length > 0) {
    nonTaxableSections.push(
      buildSection(
        "ADDITIONAL_CHARGES",
        "Additional Return Charges",
        additionalItems,
        cgstRate,
        sgstRate,
      ),
    );
  }

  if (compensationItems.length > 0) {
    nonTaxableSections.push(
      buildSection(
        "DAMAGE_COMPENSATION",
        "Damage Compensation",
        compensationItems,
        cgstRate,
        sgstRate,
      ),
    );
  }

  // ── Grand totals ──────────────────────────────────────────────────────────────
  const allSections = [...taxableSections, ...nonTaxableSections];
  const totalDiscount = allSections.reduce((s, sec) => s + sec.discount, 0);
  const totalCgst = allSections.reduce((s, sec) => s + sec.cgst, 0);
  const totalSgst = allSections.reduce((s, sec) => s + sec.sgst, 0);
  const subtotalBeforeTax = allSections.reduce(
    (s, sec) => s + sec.subtotalBeforeTax - sec.discount,
    0,
  );

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
    customerEmail: customer.user?.email || "N/A",
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
    totalCgst,
    totalSgst,
    grandTotal: Number(booking.invoice.total),

    paymentStatus: String(booking.invoice.status),
    paymentMethod,
    safetyDepositApplied: Number(booking.safetyDeposit ?? 0),
  };
}
