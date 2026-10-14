/**
 * Rules for editing a completed pickup / return (client item 1, Oct 2026).
 * Pure — no database — so the money safeguard is unit-tested.
 *
 * Readings, photos, DL details and damage notes may be corrected after the
 * pickup / drop. A change that would move money already computed or settled is
 * refused (409 EDIT_CHANGES_CHARGES) unless working the charge out again with
 * the same rules — and the free km / rate the drop actually billed with, never
 * today's pricing — gives exactly the same amount:
 *  - pickup odometer once the return is completed (an open drop bill is marked
 *    stale by the change instead: odometerBillStale)
 *  - drop odometer (always — the drop measured km with it, or measured none)
 *  - fuel levels when a fuel charge was worked out from them (the drop bill's
 *    FUEL line, prefilled from the bars, or the charge engine's FUEL_DEFICIT
 *    row): the deficit in bars must stay the same
 *  - FASTag balances: the pickup one once the return is completed, the drop
 *    one always (the drop billed the usage from them, or the typed charge when
 *    a reading was missing). An open drop bill is marked stale by a pickup
 *    balance change instead (fastagBillStale).
 * Nothing here re-bills or touches payments.
 */
import Decimal from "decimal.js";
import type { OdometerSegments } from "../charges/km-allowance.service.js";

/** 409 body when an edit would change money already computed or settled. */
export const EDIT_CHANGES_CHARGES = {
  code: "EDIT_CHANGES_CHARGES",
  message: "This change would alter charges that are already settled. Ask the branch manager to adjust the bill.",
} as const;

/** The drop's extra-km charge for these segments and end reading; null = it can't be worked out. */
export type KmChargeOf = (segments: OdometerSegments, endOdometer: number) => Decimal | null;

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

export interface KmEditCheck {
  segmentsBefore: OdometerSegments;
  segmentsAfter: OdometerSegments;
  /** null = no km was measured (no drop reading) */
  endBefore: number | null;
  endAfter: number | null;
}

/**
 * True when the edit would give a different extra-km charge than the readings
 * it replaces — or when either can't be worked out (it can't be shown equal).
 */
export function kmEditChangesCharges(check: KmEditCheck, chargeOf: KmChargeOf): boolean {
  const before = check.endBefore == null ? new Decimal(0) : chargeOf(check.segmentsBefore, check.endBefore);
  const after = check.endAfter == null ? new Decimal(0) : chargeOf(check.segmentsAfter, check.endAfter);
  return before == null || after == null || !before.eq(after);
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

/** Fuel bars "1".."10": less fuel came back than went out. */
export function hasFuelDeficit(pickupLevel: string | null, returnLevel: string | null): boolean {
  const out = pickupLevel ? parseInt(pickupLevel, 10) : NaN;
  const back = returnLevel ? parseInt(returnLevel, 10) : NaN;
  return !Number.isNaN(out) && !Number.isNaN(back) && back < out;
}

/** Bars of fuel short at the drop (0 when none, or a level is missing). */
export function fuelDeficitBars(pickupLevel: string | null, returnLevel: string | null): number {
  if (!hasFuelDeficit(pickupLevel, returnLevel)) return 0;
  return parseInt(pickupLevel!, 10) - parseInt(returnLevel!, 10);
}

/**
 * A fuel charge worked out from the levels — the drop bill's FUEL line
 * (prefilled from the bars short × rate) or the charge engine's FUEL_DEFICIT
 * row — stands only for the deficit it was billed for: levels that change the
 * bars short would change it.
 */
export function fuelEditChangesCharges(input: {
  levelBasedFuelCharge: boolean;
  before: { pickupLevel: string | null; returnLevel: string | null };
  after: { pickupLevel: string | null; returnLevel: string | null };
}): boolean {
  if (!input.levelBasedFuelCharge) return false;
  return (
    fuelDeficitBars(input.before.pickupLevel, input.before.returnLevel) !==
    fuelDeficitBars(input.after.pickupLevel, input.after.returnLevel)
  );
}

/**
 * The FASTag charge a drop works out from the readings (calculateFastagUsage):
 * COMPUTED bills `amount`; any other status leaves the charge staff typed. A
 * different status or amount is a different charge.
 */
export function fastagEditChangesCharges(
  before: { status: string; amount: Decimal },
  after: { status: string; amount: Decimal },
): boolean {
  if (before.status !== after.status) return true;
  return before.status === "COMPUTED" && !before.amount.eq(after.amount);
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
