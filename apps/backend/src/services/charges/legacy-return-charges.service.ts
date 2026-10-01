/**
 * Return charges on branches without Unified Payments (legacy drop).
 *
 * The legacy CompleteReturn has no drop bill: extra km, late return and any
 * vehicle-swap price difference are recorded as ChargeEntry rows (one per
 * moduleKey) and the branch manager collects them in Settlements, the same way
 * legacy drop damage is handled.
 *
 * The GST worked out when the row is written (rate frozen at that moment) is
 * stored on the row: finalAmount = taxable value, gstAmount = cgstAmount +
 * sgstAmount, taxRate = CGST + SGST rate. Rows written before those columns
 * existed carry it as JSON in ChargeEntry.notes:
 *   {"source":"LEGACY_DROP","gst":{"cgstRate":9,"sgstRate":9,"cgst":"9.00","sgst":"9.00","gst":"18.00"}}
 * Readers (settlement, invoice, receipt) take it from chargeEntryGst — columns
 * first, then that JSON — instead of re-taxing with the branch's current rule.
 */
import Decimal from "decimal.js";
import { prisma, ChargeType } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import type { TxClient } from "../payment/paymentSession.service.js";
import type { LineGst } from "../tax/gst.service.js";

export const LEGACY_DROP_SOURCE = "LEGACY_DROP";

/** ChargeEntry.moduleKey of the legacy drop's extra-km and late-return rows. */
export const LEGACY_EXTRA_KM_KEY = "extra_km";
export const LEGACY_EXTRA_TIME_KEY = "extra_time";
/** ChargeEntry.moduleKey prefix of a vehicle-swap difference — one row per swap (`vehicle_swap:<swapPublicId>`). */
export const LEGACY_VEHICLE_SWAP_KEY_PREFIX = "vehicle_swap:";
export const legacyVehicleSwapKey = (swapPublicId: string) => `${LEGACY_VEHICLE_SWAP_KEY_PREFIX}${swapPublicId}`;

/** ChargeEntry types a legacy drop leaves for the manager to collect. */
export const LEGACY_RETURN_CHARGE_TYPES: ChargeType[] = [
  ChargeType.EXTRA_KM,
  ChargeType.EXTRA_TIME,
  ChargeType.FUEL_DEFICIT,
  ChargeType.FASTAG,
  ChargeType.VEHICLE_SWAP,
];

export interface ChargeEntryGst {
  /** CGST + SGST rate frozen on the line, e.g. 18 */
  taxRate: number;
  cgst: Decimal;
  sgst: Decimal;
  gst: Decimal;
}

type DecimalLike = { toString(): string } | number | string;

/** The GST columns of a ChargeEntry (all optional so partial selects / older shapes still work). */
export interface ChargeEntryGstSource {
  gstAmount?: DecimalLike | null;
  cgstAmount?: DecimalLike | null;
  sgstAmount?: DecimalLike | null;
  taxRate?: DecimalLike | null;
  notes?: string | null;
}

/**
 * Frozen GST of a ChargeEntry (null = none recorded / not taxable): the GST
 * columns, else the JSON a legacy drop wrote into notes before they existed.
 */
export function chargeEntryGst(entry: ChargeEntryGstSource): ChargeEntryGst | null {
  const gst = entry.gstAmount != null ? new Decimal(entry.gstAmount.toString()) : null;
  if (gst && gst.gt(0)) {
    return {
      taxRate: Number(entry.taxRate?.toString() ?? 0),
      cgst: new Decimal(entry.cgstAmount?.toString() ?? "0"),
      sgst: new Decimal(entry.sgstAmount?.toString() ?? "0"),
      gst,
    };
  }
  return parseChargeEntryGst(entry.notes);
}

/** GST a legacy drop froze as JSON in ChargeEntry.notes (rows written before the GST columns). */
export function parseChargeEntryGst(notes: string | null | undefined): ChargeEntryGst | null {
  if (!notes || !notes.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(notes) as { gst?: Record<string, unknown> };
    const g = parsed?.gst;
    if (!g) return null;
    return {
      taxRate: Number(g.cgstRate ?? 0) + Number(g.sgstRate ?? 0),
      cgst: new Decimal(String(g.cgst ?? "0")),
      sgst: new Decimal(String(g.sgst ?? "0")),
      gst: new Decimal(String(g.gst ?? "0")),
    };
  } catch {
    return null;
  }
}

/**
 * Creates or replaces the legacy drop's ChargeEntry for a moduleKey. `amount` is
 * the taxable value (pre-GST); `gst` is the line GST at the branch rate (frozen
 * into the GST columns), or null for a non-taxable charge.
 */
export async function upsertLegacyReturnCharge(
  tx: TxClient,
  input: {
    bookingId: number;
    moduleKey: string;
    chargeType: ChargeType;
    label: string;
    amount: Decimal;
    quantity: number;
    unitRate: Decimal;
    actorId: number;
    gst: LineGst | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const notes = JSON.stringify({ source: LEGACY_DROP_SOURCE, ...(input.details ?? {}) });
  const amount = input.amount.toFixed(2);
  const gstColumns = {
    gstAmount: input.gst ? input.gst.gst.toFixed(2) : "0.00",
    cgstAmount: input.gst ? input.gst.cgst.toFixed(2) : "0.00",
    sgstAmount: input.gst ? input.gst.sgst.toFixed(2) : "0.00",
    taxRate: input.gst ? input.gst.rate.toFixed(2) : "0.00",
  };
  await tx.chargeEntry.upsert({
    where: { bookingId_moduleKey: { bookingId: input.bookingId, moduleKey: input.moduleKey } },
    create: {
      publicId: createID(),
      bookingId: input.bookingId,
      chargeType: input.chargeType,
      moduleKey: input.moduleKey,
      label: input.label,
      originalAmount: amount,
      finalAmount: amount,
      quantity: input.quantity,
      unitRate: input.unitRate.toFixed(2),
      ...gstColumns,
      notes,
      createdById: input.actorId,
    },
    update: {
      chargeType: input.chargeType,
      label: input.label,
      originalAmount: amount,
      finalAmount: amount,
      quantity: input.quantity,
      unitRate: input.unitRate.toFixed(2),
      ...gstColumns,
      notes,
      isOverridden: false,
    },
  });
}

/** Removes a legacy drop ChargeEntry that no longer applies (e.g. a re-submitted return). */
export async function removeLegacyReturnCharge(tx: TxClient, bookingId: number, moduleKey: string): Promise<void> {
  await tx.chargeEntry.deleteMany({ where: { bookingId, moduleKey, override: { is: null } } });
}

/** Removes vehicle-swap rows of the legacy drop other than `keepModuleKeys`. */
export async function removeStaleLegacySwapCharges(
  tx: TxClient,
  bookingId: number,
  keepModuleKeys: string[],
): Promise<void> {
  await tx.chargeEntry.deleteMany({
    where: {
      bookingId,
      chargeType: ChargeType.VEHICLE_SWAP,
      moduleKey: { startsWith: LEGACY_VEHICLE_SWAP_KEY_PREFIX, notIn: keepModuleKeys },
      override: { is: null },
    },
  });
}

/**
 * What a legacy drop left the customer owing: Σ ChargeEntry finalAmount + the
 * frozen GST, for the return charge types. Used by the BM settlement.
 */
export async function legacyReturnChargesTotal(bookingId: number, tx?: TxClient): Promise<Decimal> {
  const db = tx ?? prisma;
  const entries = await db.chargeEntry.findMany({
    where: { bookingId, chargeType: { in: LEGACY_RETURN_CHARGE_TYPES } },
    select: { finalAmount: true, gstAmount: true, cgstAmount: true, sgstAmount: true, taxRate: true, notes: true },
  });
  return entries.reduce((sum, e) => {
    const gst = chargeEntryGst(e)?.gst ?? new Decimal(0);
    return sum.plus(new Decimal(e.finalAmount.toString())).plus(gst);
  }, new Decimal(0));
}
