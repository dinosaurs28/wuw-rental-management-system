import Decimal from "decimal.js";
import {
  prisma,
  PaymentSessionType,
  PaymentSessionStatus,
  LedgerEntryClassification,
} from "@repo/database/client";
import { createID } from "../utils/nanoID.js";
import { queueInvoiceGeneration } from "../utils/invoice-generation.queue.js";
import { DROP_DAMAGE_REF, DROP_DISCOUNT_REF } from "./damage/drop-damage.service.js";
import { chargeEntryGst, chargeEntryGstRemoved } from "./charges/legacy-return-charges.service.js";
import { settlementEngineService } from "./payment/settlement-engine.service.js";
import {
  computeInvoiceGstTotals,
  invoiceTotalsData,
  isDamageReviewItem,
  INVOICE_SOURCE,
} from "./invoice-totals.service.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// GST on return charges follows the canonical rule (#23) and is never
// recomputed here. Since item 8 (Oct 3 2026) drop / recovery charges carry no
// GST, so new lines are non-taxable; lines stored with GST before keep it:
//  - Session flow: a ledger line is taxable when it was booked TAXABLE, and its
//    GST is the gstAmount stored on it when the drop bill was computed.
//  - Legacy ChargeEntry flow: the GST a legacy drop froze on the row (GST
//    columns, else JSON in notes — chargeEntryGst). Older rows have none: they
//    keep only the GST an earlier finalization stored on their invoice line (a
//    damage penalty used to be taxed then); otherwise they are non-taxable.

// LedgerEntry types to skip — these are not billable line items in the invoice
const SKIP_LEDGER_TYPES = new Set([
  "BOOKING_BASE", // already in booking subtotal
  "EXTENSION",    // extension handled separately
  "DISCOUNT",     // displayed as discount, not a charge (drop discount handled below)
  "REFUND",       // not a charge
  "PAYMENT",      // cash/online payment records
  "DEPOSIT",      // safety deposit credits
]);

// ── LedgerEntryType → InvoiceItem chargeType ──────────────────────────────────

function ledgerTypeToChargeType(entryType: string): string {
  switch (entryType) {
    case "EXTRA_KM":         return "EXTRA_KM";
    case "EXTRA_TIME":       return "EXTRA_TIME";
    case "FUEL":             return "FUEL_DEFICIT";
    case "FASTAG":           return "FASTAG";
    case "GRACE_ADJUSTMENT": return "GRACE_ADJUSTMENT";
    case "VEHICLE_SWAP":     return "VEHICLE_SWAP";
    case "DAMAGE":           return "DAMAGE_PENALTY"; // refined below if DamageReport exists
    default:                 return "ADDITIONAL_CHARGES";
  }
}

// ── ChargeEntry chargeType resolution ────────────────────────────────────────

async function resolveLegacyChargeType(chargeType: string, bookingId: number): Promise<string> {
  if (chargeType !== "DAMAGE") return chargeType;

  const report = await prisma.damageReport.findFirst({
    where: { bookingId },
    select: { chargeType: true },
  });
  return report?.chargeType === "COMPENSATION" ? "DAMAGE_COMPENSATION" : "DAMAGE_PENALTY";
}

// ── Canonical charge item ──────────────────────────────────────────────────────

interface ChargeItem {
  label: string;
  /** Taxable value for a taxable line; negative for a discount */
  amount: string;
  isTaxable: boolean;
  chargeType: string;
  /** Stored GST of the line (negative for a discount's GST reversal) */
  taxAmount: string;
  sourceRef: string;
}

const abs2 = (v: unknown) => new Decimal(String(v ?? 0)).abs();

/**
 * A drop discount ledger line becomes up to two invoice lines: the share that
 * reduced taxable charges (with the GST it reversed) and the share that reduced
 * non-taxable charges. The drop bill stores the taxable share as a negative
 * baseAmount and the reversed GST as a negative gstAmount; like the counter
 * coupon, the line's amount is the whole effect on the bill (discount before GST
 * + the GST it reversed), so the discount itself is |amount| − |gstAmount|.
 * An older line (no split) is wholly non-taxable — the drop discount used to be
 * capped at the non-taxable charges.
 */
function dropDiscountItems(entry: any): ChargeItem[] {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const gstReversal = abs2(entry.gstAmount).gt(0) ? abs2(entry.gstAmount) : abs2(meta.gst);
  const discount = abs2(entry.amount).sub(gstReversal);
  const taxableShare = Decimal.min(
    discount,
    abs2(entry.baseAmount).gt(0) ? abs2(entry.baseAmount) : abs2(meta.taxableShare),
  );
  const nonTaxableShare = discount.sub(taxableShare);
  const label = String(entry.description);
  const ref = `${INVOICE_SOURCE.LEDGER}${entry.publicId}`;
  const items: ChargeItem[] = [];
  if (taxableShare.gt(0)) {
    items.push({
      label,
      amount: taxableShare.negated().toFixed(2),
      isTaxable: true,
      chargeType: "DROP_DISCOUNT",
      taxAmount: gstReversal.negated().toFixed(2),
      sourceRef: ref,
    });
  }
  if (nonTaxableShare.gt(0)) {
    items.push({
      label,
      amount: nonTaxableShare.negated().toFixed(2),
      isTaxable: false,
      chargeType: "DROP_DISCOUNT", // rendered as the return-charge sections' discount on the PDF
      taxAmount: "0.00",
      sourceRef: ref,
    });
  }
  return items;
}

/**
 * Builds charge items from the correct source depending on the return flow:
 *
 * Session flow  → LedgerEntry rows from the completed RETURN PaymentSession
 * Legacy flow   → ChargeEntry rows persisted by the charge engine
 *
 * The session flow is detected by the presence of a completed RETURN
 * PaymentSession. Legacy is the fallback.
 */
async function buildChargeItems(bookingId: number): Promise<ChargeItem[]> {
  // ── 1. Session-based return flow ──────────────────────────────────────────
  const returnSession = await prisma.paymentSession.findFirst({
    where: {
      bookingId,
      sessionType: PaymentSessionType.RETURN,
      status: PaymentSessionStatus.COMPLETED,
    },
    include: {
      entries: true, // fetch all, filter in code to avoid Prisma enum-cast issues
    },
    orderBy: { completedAt: "desc" },
  });

  if (returnSession) {
    // Filter to positive charge entries only — exclude payments, credits, base
    const chargeEntries = returnSession.entries.filter((e: any) => {
      if (e.isVoided) return false;
      if (e.classification === LedgerEntryClassification.PAYMENT) return false;
      if (e.classification === "DISCOUNT") return false;
      if (SKIP_LEDGER_TYPES.has(String(e.entryType))) return false;
      if (new Decimal(e.amount.toString()).lte(0)) return false;
      return true;
    });

    // Discount given at drop — a negative line so invoice total = amount actually settled
    const dropDiscountEntries = returnSession.entries.filter(
      (e: any) => !e.isVoided && e.referenceType === DROP_DISCOUNT_REF,
    );

    console.log(
      `[finalizeInvoice] Session flow — booking ${bookingId}: ` +
        `session ${returnSession.publicId} has ${chargeEntries.length} charge entries, ` +
        `${dropDiscountEntries.length} drop discount(s) (${returnSession.entries.length} total entries)`,
    );

    if (chargeEntries.length > 0 || dropDiscountEntries.length > 0) {
      const chargeItems: ChargeItem[] = chargeEntries.map((entry: any) => {
        // DAMAGE entries in a return session are either free-form "other charges"
        // (ADDITIONAL_CHARGES) or damage the customer paid for at drop — billed
        // without GST, so it lands in the non-taxable Damage Compensation section.
        // Damage settled by the branch manager is added to InvoiceItem separately.
        const chargeType =
          entry.entryType === "DAMAGE"
            ? entry.referenceType === DROP_DAMAGE_REF
              ? "DAMAGE_COMPENSATION"
              : "ADDITIONAL_CHARGES"
            : ledgerTypeToChargeType(String(entry.entryType));

        // Taxable exactly when the drop bill booked it TAXABLE; its GST is the
        // amount stored on the ledger line (never recomputed here).
        const isTaxable = entry.classification === LedgerEntryClassification.TAXABLE;

        return {
          label: String(entry.description),
          amount: new Decimal(entry.amount.toString()).toFixed(2),
          isTaxable,
          chargeType,
          taxAmount: isTaxable ? new Decimal(entry.gstAmount.toString()).toFixed(2) : "0.00",
          sourceRef: `${INVOICE_SOURCE.LEDGER}${entry.publicId}`,
        };
      });

      const discountItems: ChargeItem[] = dropDiscountEntries.flatMap(dropDiscountItems);

      return [...chargeItems, ...discountItems];
    }

    // Session exists but had no billable entries (e.g. deposit-only return)
    console.log(
      `[finalizeInvoice] Session ${returnSession.publicId} has no billable charge entries — no return charges to add`,
    );
    return [];
  }

  // ── 2. Legacy ChargeEntry flow ────────────────────────────────────────────
  const chargeEntries = await prisma.chargeEntry.findMany({
    where: {
      bookingId,
      chargeType: { notIn: ["BASE", "SAFETY_DEPOSIT"] },
    },
  });

  console.log(
    `[finalizeInvoice] Legacy flow — booking ${bookingId}: ${chargeEntries.length} ChargeEntry rows`,
  );

  if (chargeEntries.length === 0) return [];

  const resolved = await Promise.all(
    chargeEntries.map((e) => resolveLegacyChargeType(String(e.chargeType), bookingId)),
  );
  // The GST an earlier finalization already stored on a line stays (rows without
  // frozen GST); a line invoiced for the first time now carries none (item 8)
  const priorItems = await prisma.invoiceItem.findMany({
    where: {
      invoice: { bookingId },
      sourceRef: { in: chargeEntries.map((e) => `${INVOICE_SOURCE.CHARGE_ENTRY}${e.publicId}`) },
    },
    select: { sourceRef: true, isTaxable: true, taxAmount: true },
  });
  const priorBySource = new Map(priorItems.map((p) => [p.sourceRef, p]));

  return chargeEntries.map((entry, i) => {
    const chargeType = resolved[i] ?? "ADDITIONAL_CHARGES";
    const amount = new Decimal(entry.finalAmount.toString());

    // A legacy drop froze the line's GST on the ChargeEntry when it wrote it
    const frozen = chargeEntryGst(entry);
    if (frozen) {
      const isTaxable = frozen.gst.gt(0);
      return {
        label: entry.label,
        amount: amount.toFixed(2),
        isTaxable,
        chargeType,
        taxAmount: isTaxable ? frozen.gst.toFixed(2) : "0.00",
        sourceRef: `${INVOICE_SOURCE.CHARGE_ENTRY}${entry.publicId}`,
      };
    }

    // Older rows carry no GST. Drop / recovery charges — damage included — are
    // not taxed any more (item 8): a line keeps only the GST an earlier
    // finalization of this invoice stored on it (a damage penalty used to be
    // taxed here, once); otherwise it is non-taxable.
    const sourceRef = `${INVOICE_SOURCE.CHARGE_ENTRY}${entry.publicId}`;
    // A row restated without GST (open legacy drop, item 8) drops it from its line too
    const prior = chargeEntryGstRemoved(entry.notes) ? undefined : priorBySource.get(sourceRef);
    const priorTax = prior?.isTaxable ? new Decimal(prior.taxAmount.toString()) : new Decimal(0);
    const isTaxable = priorTax.gt(0);
    return {
      label: entry.label,
      amount: amount.toFixed(2),
      isTaxable,
      chargeType,
      taxAmount: isTaxable ? priorTax.toFixed(2) : "0.00",
      sourceRef,
    };
  });
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Idempotently rebuilds Invoice data after return settlement.
 *
 * - Detects session vs legacy return flow automatically.
 * - Rebuilds the return-charge InvoiceItem rows from the authoritative source,
 *   with the GST stored on each line. A damage charged in the manager's review
 *   (sourceRef DAMAGE_REVIEW:…) is kept — it is not a return charge.
 * - Recomputes the invoice from stored values (invoice-totals.service):
 *   total = booking.totalFinal + return charges (+ their GST) − drop discount;
 *   tax / taxable / CGST / SGST = rental + confirmed extensions + taxable lines;
 *   depositAmount = the refundable deposit (inside total, not taxable).
 * - Nulls invoicePdfFileId to discard any stale cached PDF.
 * - Queues a new PDF generation job.
 * - Marks the invoice PAID (the default — callers that run once the return is
 *   settled). `markPaid: false` rebuilds the lines while money is still owed
 *   and leaves the invoice PENDING (see syncLegacyReturnInvoice).
 */
export async function finalizeInvoice(
  bookingId: number,
  opts: { markPaid?: boolean } = {},
): Promise<void> {
  const markPaid = opts.markPaid !== false;
  console.log(`[finalizeInvoice] Starting for booking ${bookingId}${markPaid ? "" : " (balance still owed)"}`);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      branchId: true,
      pricingSnapshot: true,
      items: { select: { taxRate: true } },
      invoice: {
        select: {
          id: true,
          invoicePdfFileId: true,
        },
      },
    },
  });

  if (!booking?.invoice) {
    console.warn(`[finalizeInvoice] No invoice found for booking ${bookingId}`);
    return;
  }

  const invoiceId = booking.invoice.id;
  // Capture the old file ID before nulling it — passed to the worker so it can
  // delete the stale R2 object and FileObject row after the new PDF is uploaded.
  const previousFileObjectId = booking.invoice.invoicePdfFileId ?? undefined;
  // Return charges are never taxed here (item 8: no GST on drop / recovery
  // charges; stored GST is read back as is)
  const chargeItems = await buildChargeItems(bookingId);

  const newTotal = await prisma.$transaction(async (tx) => {
    // One rebuild at a time per invoice: a legacy drop, the manager's settlement
    // and a regenerate can each trigger one, and two interleaved rebuilds would
    // both delete the old rows and both insert — every return charge twice.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    // Return-charge rows are rebuilt; the manager's damage-review rows stay
    const currentItems = await tx.invoiceItem.findMany({
      where: { invoiceId },
      select: { id: true, label: true, sourceRef: true },
    });
    const staleItemIds = currentItems.filter((i) => !isDamageReviewItem(i)).map((i) => i.id);
    if (staleItemIds.length > 0) {
      await tx.invoiceItem.deleteMany({ where: { id: { in: staleItemIds } } });
    }

    for (const item of chargeItems) {
      await tx.invoiceItem.create({
        data: {
          publicId: createID(),
          invoiceId,
          label: item.label,
          amount: item.amount,
          isTaxable: item.isTaxable,
          chargeType: item.chargeType,
          taxAmount: item.taxAmount,
          sourceRef: item.sourceRef,
        },
      });
    }

    const totals = await computeInvoiceGstTotals(bookingId, tx);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...invoiceTotalsData(totals),
        status: markPaid ? "PAID" : "PENDING",
        invoicePdfFileId: null,
        generatedAt: null,
      },
    });
    return totals.total;
  });

  await queueInvoiceGeneration(bookingId, invoiceId, true, previousFileObjectId);

  console.log(
    `[finalizeInvoice] Done — booking ${bookingId}: total ₹${newTotal.toFixed(2)}, ` +
      `${chargeItems.length} charge item(s), PDF queued.`,
  );
}

/**
 * Legacy (non-Unified-Payments) drop: the return charges it recorded as
 * ChargeEntry rows (extra km, late return — GST frozen on each) are collected
 * by the branch manager in Settlements, and no payment session finalizes the
 * invoice. Rebuild its return-charge lines after the drop and after each
 * settlement payment, and mark it PAID only once the settlement shows nothing
 * owed or awaiting confirmation.
 *
 * Returns false (and does nothing) for a booking whose return went through a
 * RETURN payment session — that flow finalizes the invoice when it completes.
 * Safe to run repeatedly; callers run it fire-and-forget.
 */
export async function syncLegacyReturnInvoice(bookingId: number): Promise<boolean> {
  const returnSession = await prisma.paymentSession.findFirst({
    where: { bookingId, sessionType: PaymentSessionType.RETURN, status: PaymentSessionStatus.COMPLETED },
    select: { id: true },
  });
  if (returnSession) return false;

  const { isSettled } = await settlementEngineService.calculateSettlement(bookingId);
  await finalizeInvoice(bookingId, { markPaid: isSettled });
  return true;
}
