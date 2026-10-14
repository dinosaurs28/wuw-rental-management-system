/**
 * Rules for editing a completed pickup / return (client item 1, Oct 2026).
 * Pure — no database — so they are unit-tested.
 *
 * An edit's money is worked out again with the free km / rate the drop billed
 * with (never today's pricing) and settled as a difference
 * (services/booking/operation-adjustment.ts). An open drop bill is marked stale
 * by a corrected pickup reading instead (odometerBillStale). Readings must stay
 * possible, and photos can be replaced but not all taken away.
 */
import Decimal from "decimal.js";
import type { OdometerSegments } from "../charges/km-allowance.service.js";

/**
 * The free km and rate a drop billed with, read from what it recorded (the drop
 * bill's km, else Booking.freeKmLimit and the legacy extra-km charge row).
 * null fields = not recorded.
 */
export interface BilledKmAllowance {
  includedKm: number | null;
  extraKmRate: Decimal | null;
  extraKmEnabled: boolean | null;
}

export interface BilledKm {
  /** false: a swap was recorded without readings — km isn't measured, readings don't move the charge */
  measured: boolean;
  kmDriven: number;
  extraKm: number;
  /** null = can't be worked out from what the drop recorded */
  charge: Decimal | null;
}

/** calculateKmCharge's formula with the allowance the drop billed with. */
export function billedKmCharge(allowance: BilledKmAllowance, segments: OdometerSegments, endOdometer: number): BilledKm {
  if (!segments.complete) return { measured: false, kmDriven: 0, extraKm: 0, charge: new Decimal(0) };
  const start = segments.currentStartOdometer;
  const kmDriven = segments.priorKm + Math.max(0, endOdometer - (start ?? endOdometer));
  if (allowance.includedKm == null) return { measured: true, kmDriven, extraKm: 0, charge: null };
  const extraKm = Math.max(0, kmDriven - allowance.includedKm);
  if (extraKm === 0 || allowance.extraKmEnabled === false) return { measured: true, kmDriven, extraKm, charge: new Decimal(0) };
  if (allowance.extraKmEnabled == null || allowance.extraKmRate == null) {
    return { measured: true, kmDriven, extraKm, charge: null };
  }
  return { measured: true, kmDriven, extraKm, charge: allowance.extraKmRate.mul(extraKm).ceil() };
}

/**
 * The billed allowance from what a drop recorded:
 *  - the drop bill's km metadata (includedKm, extraKmRate, extraKmEnabled), else
 *  - legacy drop: Booking.freeKmLimit, and the extra-km charge row's rate (a row
 *    means extra km was charged); extra km recorded without a row means it
 *    wasn't charged on that plan
 */
export function billedKmAllowance(input: {
  billKm: unknown;
  freeKmLimit: number | null;
  extraKmCharged: number | null;
  legacyExtraKmRate: { toString(): string } | null;
}): BilledKmAllowance {
  const km = input.billKm as { includedKm?: unknown; extraKmRate?: unknown; extraKmEnabled?: unknown } | null;
  if (km && typeof km.includedKm === "number" && typeof km.extraKmEnabled === "boolean" && km.extraKmRate != null) {
    return {
      includedKm: km.includedKm,
      extraKmRate: new Decimal(String(km.extraKmRate)),
      extraKmEnabled: km.extraKmEnabled,
    };
  }
  if (input.legacyExtraKmRate != null) {
    return {
      includedKm: input.freeKmLimit,
      extraKmRate: new Decimal(input.legacyExtraKmRate.toString()),
      extraKmEnabled: true,
    };
  }
  return {
    includedKm: input.freeKmLimit,
    extraKmRate: null,
    extraKmEnabled: (input.extraKmCharged ?? 0) > 0 ? false : null,
  };
}

/**
 * The pickup reading an open drop bill was computed from no longer matches the
 * booking (corrected with Edit Pickup). `billMeta` is RETURN session metadata:
 * `pickupOdometer`, else (bills computed before it was stored) the km data's
 * first segment start / start reading. Bills without either are never stale for this.
 */
export function odometerBillStale(billMeta: unknown, startOdometer: number | null): boolean {
  if (!billMeta || typeof billMeta !== "object") return false;
  const meta = billMeta as {
    pickupOdometer?: number | null;
    km?: { startOdometer?: number | null; swapCount?: number; segments?: Array<{ startOdometer?: number | null }> } | null;
  };
  let recorded: number | null | undefined = meta.pickupOdometer;
  if (recorded === undefined && meta.km) {
    recorded = (meta.km.swapCount ?? 0) > 0 ? meta.km.segments?.[0]?.startOdometer : meta.km.startOdometer;
  }
  if (recorded === undefined) return false;
  return (recorded ?? null) !== (startOdometer ?? null);
}

/**
 * The booking's odometer segments with a corrected pickup reading: it is the
 * start of the first segment — the current vehicle's start when there was no
 * mid-rental swap, else the start of the car handed back at the first swap.
 */
export function withPickupOdometer(segments: OdometerSegments, startOdometer: number): OdometerSegments {
  if (segments.swapCount === 0 || segments.segments.length === 0) {
    return { ...segments, currentStartOdometer: startOdometer };
  }
  const [first, ...rest] = segments.segments;
  const updated = [
    {
      ...first!,
      startOdometer,
      km: first!.endOdometer == null ? null : Math.max(0, first!.endOdometer - startOdometer),
    },
    ...rest,
  ];
  return {
    ...segments,
    segments: updated,
    priorKm: segments.complete ? updated.reduce((sum, s) => sum + (s.km ?? 0), 0) : 0,
  };
}

/** Why a corrected pickup reading can't be right, or null. */
export function pickupOdometerProblem(
  segments: OdometerSegments,
  startOdometer: number,
  endOdometer: number | null,
): string | null {
  const firstSwapEnd = segments.swapCount > 0 ? segments.segments[0]?.endOdometer ?? null : null;
  if (firstSwapEnd != null && startOdometer > firstSwapEnd) {
    return `The pickup reading can't be more than the reading when the car was swapped (${firstSwapEnd} km).`;
  }
  if (segments.swapCount === 0 && endOdometer != null && startOdometer > endOdometer) {
    return `The pickup reading can't be more than the drop reading (${endOdometer} km).`;
  }
  return null;
}

/** Why a corrected drop reading can't be right, or null (same rule as the drop itself). */
export function endOdometerProblem(segments: OdometerSegments, endOdometer: number): string | null {
  if (!segments.complete || segments.currentStartOdometer == null) return null;
  if (endOdometer >= segments.currentStartOdometer) return null;
  return segments.swapCount > 0
    ? `End odometer can't be less than the replacement vehicle's reading at the swap (${segments.currentStartOdometer} km).`
    : `End odometer can't be less than the pickup reading (${segments.currentStartOdometer} km).`;
}

/** A pickup / return that had photos can't be left with none (the workflow needs them). */
export function photosEmptied(countBefore: number, countAfter: number): boolean {
  return countBefore > 0 && countAfter === 0;
}

/** Required capture slots that had a photo before the edit and would have none after it. */
export function emptiedRequiredSlots(
  requiredLabels: string[],
  labelsBefore: Array<string | null>,
  labelsAfter: Array<string | null>,
): string[] {
  return requiredLabels.filter((label) => labelsBefore.includes(label) && !labelsAfter.includes(label));
}

/** before / after of the fields that actually change, for the audit entry. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T>; fields: string[] } {
  const out = { before: {} as Partial<T>, after: {} as Partial<T>, fields: [] as string[] };
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
    out.before[key] = before[key];
    out.after[key] = after[key];
    out.fields.push(String(key));
  }
  return out;
}
