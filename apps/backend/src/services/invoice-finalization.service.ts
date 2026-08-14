import Decimal from "decimal.js";
import {
  prisma,
  PaymentSessionType,
  PaymentSessionStatus,
  LedgerEntryClassification,
} from "@repo/database/client";
import { createID } from "../utils/nanoID.js";
import { queueInvoiceGeneration } from "../utils/invoice-generation.queue.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Only DAMAGE_PENALTY attracts GST — all other return charges are non-taxable.
// (DAMAGE_PENALTY is checked inline via `chargeType === "DAMAGE_PENALTY"`.)
const TAXABLE_CHARGE_TYPES = new Set<string>([]);

// LedgerEntry types to skip — these are not billable line items in the invoice
const SKIP_LEDGER_TYPES = new Set([
  "BOOKING_BASE", // already in booking subtotal
  "EXTENSION",    // extension handled separately
  "DISCOUNT",     // displayed as discount, not a charge
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
  amount: string;
  isTaxable: boolean;
  chargeType: string;
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

    console.log(
      `[finalizeInvoice] Session flow — booking ${bookingId}: ` +
        `session ${returnSession.publicId} has ${chargeEntries.length} charge entries ` +
        `(${returnSession.entries.length} total entries)`,
    );

    if (chargeEntries.length > 0) {
      return chargeEntries.map((entry: any) => {
        // DAMAGE entries in a return session are free-form "other charges" added by
        // the employee — NOT actual vehicle damage (which is handled separately by
        // the branch manager directly on InvoiceItem). Map them to ADDITIONAL_CHARGES.
        const chargeType =
          entry.entryType === "DAMAGE"
            ? "ADDITIONAL_CHARGES"
            : ledgerTypeToChargeType(String(entry.entryType));

        const isTaxable = chargeType === "DAMAGE_PENALTY";

        return {
          label: String(entry.description),
          amount: new Decimal(entry.amount.toString()).toFixed(2),
          isTaxable,
          chargeType,
        };
      });
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

  return chargeEntries.map((entry, i) => {
    const chargeType = resolved[i] ?? "ADDITIONAL_CHARGES";
    const isTaxable = chargeType === "DAMAGE_PENALTY";

    return {
      label: entry.label,
      amount: new Decimal(entry.finalAmount.toString()).toFixed(2),
      isTaxable,
      chargeType,
    };
  });
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Idempotently rebuilds Invoice data after return settlement.
 *
 * - Detects session vs legacy return flow automatically.
 * - Rebuilds InvoiceItem rows from the authoritative source.
 * - Recomputes invoice.total = booking.totalFinal + return charges (+ GST where applicable).
 * - Nulls invoicePdfFileId to discard any stale cached PDF.
 * - Queues a new PDF generation job.
 */
export async function finalizeInvoice(bookingId: number): Promise<void> {
  console.log(`[finalizeInvoice] Starting for booking ${bookingId}`);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      totalFinal: true,
      invoice: { select: { id: true, invoicePdfFileId: true } },
      branch: {
        select: {
          gstRule: { select: { cgstRate: true, sgstRate: true } },
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
  const cgstRate = booking.branch.gstRule ? Number(booking.branch.gstRule.cgstRate) : 9;
  const sgstRate = booking.branch.gstRule ? Number(booking.branch.gstRule.sgstRate) : 9;
  const totalGstRate = cgstRate + sgstRate;

  const chargeItems = await buildChargeItems(bookingId);

  // Aggregate totals
  let extraBase = new Decimal(0);
  let extraTax = new Decimal(0);
  let damageBase = new Decimal(0);

  for (const item of chargeItems) {
    const base = new Decimal(item.amount);
    const tax = item.isTaxable ? base.mul(totalGstRate).div(100) : new Decimal(0);
    extraBase = extraBase.add(base);
    extraTax = extraTax.add(tax);
    if (item.chargeType === "DAMAGE_PENALTY" || item.chargeType === "DAMAGE_COMPENSATION") {
      damageBase = damageBase.add(base);
    }
  }

  const newTotal = new Decimal(booking.totalFinal.toString()).add(extraBase).add(extraTax);

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });

    for (const item of chargeItems) {
      await tx.invoiceItem.create({
        data: {
          publicId: createID(),
          invoiceId,
          label: item.label,
          amount: item.amount,
          isTaxable: item.isTaxable,
          chargeType: item.chargeType,
        },
      });
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        damageCharges: damageBase.toFixed(2),
        tax: extraTax.toFixed(2),
        total: newTotal.toFixed(2),
        status: "PAID",
        invoicePdfFileId: null,
        generatedAt: null,
      },
    });
  });

  await queueInvoiceGeneration(bookingId, invoiceId, true, previousFileObjectId);

  console.log(
    `[finalizeInvoice] Done — booking ${bookingId}: total ₹${newTotal.toFixed(2)}, ` +
      `${chargeItems.length} charge item(s), PDF queued.`,
  );
}
