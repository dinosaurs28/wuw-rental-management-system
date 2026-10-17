/**
 * Km of each car of a rental, as the drop bills it — pure, unit-tested.
 *
 * The drop bills km once for the whole rental (calculateKmCharge):
 *   kmDriven = Σ km on every car (segments, oldest first)
 *   extraKm  = max(0, kmDriven − includedKm)       — ONE pooled free-km allowance
 *   charge   = ceil(extraKmRate × extraKm)          — one rate, whole rupees
 * The allowance and rate are the booking's (getKmAllowance: its current car's
 * pricing, never fewer free km than the confirmation promised).
 *
 * segmentKmShares splits that one charge across the cars in the order they were
 * driven: a car uses the free km the earlier cars left, and its extra km / ₹ is
 * what it adds to the running total. So
 *   Σ shares.extraKm       = the drop's extraKm
 *   Σ shares.extraKmCharge = the drop's charge
 * and a car's share never depends on the cars after it — the figure recorded at
 * a swap is the one the drop bills for that car, given the same free km, rate
 * and readings.
 */
import Decimal from "decimal.js";

export interface SegmentKmAllowance {
  includedKm: number;
  extraKmRate: Decimal;
  extraKmEnabled: boolean;
}

export interface SegmentKmShare {
  /** km driven on this car this segment */
  kmDriven: number;
  /** Free km still left when this segment started (the earlier cars used the rest) */
  allowanceKm: number;
  extraKm: number;
  extraKmRate: Decimal;
  /** Whole rupees, 0 when extra km isn't billed (extraKmEnabled false) */
  extraKmCharge: Decimal;
}

/** km of one segment the way the drop counts it: a missing start reading counts as no km driven. */
export function segmentKm(startOdometer: number | null, endOdometer: number): number {
  return Math.max(0, endOdometer - (startOdometer ?? endOdometer));
}

/** The drop's pooled km charge split across the segments, oldest first. */
export function segmentKmShares(segmentKms: number[], allowance: SegmentKmAllowance): SegmentKmShare[] {
  const charge = (extraKm: number) =>
    allowance.extraKmEnabled ? allowance.extraKmRate.mul(extraKm).ceil() : new Decimal(0);
  let cumulativeKm = 0;
  let cumulativeExtra = 0;
  let cumulativeCharge = new Decimal(0);
  return segmentKms.map((raw) => {
    const kmDriven = Math.max(0, raw);
    const allowanceKm = Math.max(0, allowance.includedKm - cumulativeKm);
    cumulativeKm += kmDriven;
    const extraTotal = Math.max(0, cumulativeKm - allowance.includedKm);
    const chargeTotal = charge(extraTotal);
    const share: SegmentKmShare = {
      kmDriven,
      allowanceKm,
      extraKm: extraTotal - cumulativeExtra,
      extraKmRate: allowance.extraKmRate,
      extraKmCharge: chargeTotal.minus(cumulativeCharge),
    };
    cumulativeExtra = extraTotal;
    cumulativeCharge = chargeTotal;
    return share;
  });
}

/** What a swap stores on VehicleSwap (segment* columns). */
export interface SwapKmSnapshot {
  segmentKmDriven: number;
  segmentIncludedKm: number;
  segmentAllowanceKm: number;
  segmentExtraKm: number;
  segmentExtraKmRate: string;
  segmentExtraKmCharge: string;
  segmentExtraKmEnabled: boolean;
}

/**
 * The returning car's km at a mid-rental swap: its share (segmentKmShares) after
 * the cars handed back at earlier swaps. null when km can't be measured — an
 * earlier swap was recorded without readings (the drop then bills staff-entered
 * extra km), or the allowance couldn't be worked out.
 *
 *  - priorSegmentKms: km of the cars handed back at earlier mid-rental swaps
 *    (getOdometerSegments().segments[].km), null entries = unmeasurable
 *  - segmentStartOdometer: the returning car's start reading this segment
 */
export function swapKmSnapshot(input: {
  priorSegmentKms: Array<number | null>;
  segmentStartOdometer: number | null;
  endOdometer: number;
  allowance: SegmentKmAllowance | null;
}): SwapKmSnapshot | null {
  if (!input.allowance) return null;
  if (input.priorSegmentKms.some((km) => km == null)) return null;
  const kms = [...(input.priorSegmentKms as number[]), segmentKm(input.segmentStartOdometer, input.endOdometer)];
  const share = segmentKmShares(kms, input.allowance).at(-1)!;
  return {
    segmentKmDriven: share.kmDriven,
    segmentIncludedKm: input.allowance.includedKm,
    segmentAllowanceKm: share.allowanceKm,
    segmentExtraKm: share.extraKm,
    segmentExtraKmRate: share.extraKmRate.toFixed(2),
    segmentExtraKmCharge: share.extraKmCharge.toFixed(2),
    segmentExtraKmEnabled: input.allowance.extraKmEnabled,
  };
}

/** A stored swap snapshot as clients get it (null when not recorded). */
export interface SwapKmRecorded {
  kmDriven: number;
  includedKm: number | null;
  allowanceKm: number | null;
  extraKm: number | null;
  extraKmRate: string | null;
  extraKmCharge: string | null;
  extraKmEnabled: boolean | null;
}

export function swapKmRecorded(row: {
  segmentKmDriven: number | null;
  segmentIncludedKm: number | null;
  segmentAllowanceKm: number | null;
  segmentExtraKm: number | null;
  segmentExtraKmRate: { toString(): string } | null;
  segmentExtraKmCharge: { toString(): string } | null;
  segmentExtraKmEnabled: boolean | null;
}): SwapKmRecorded | null {
  if (row.segmentKmDriven == null) return null;
  return {
    kmDriven: row.segmentKmDriven,
    includedKm: row.segmentIncludedKm,
    allowanceKm: row.segmentAllowanceKm,
    extraKm: row.segmentExtraKm,
    extraKmRate: row.segmentExtraKmRate != null ? new Decimal(row.segmentExtraKmRate.toString()).toFixed(2) : null,
    extraKmCharge: row.segmentExtraKmCharge != null ? new Decimal(row.segmentExtraKmCharge.toString()).toFixed(2) : null,
    extraKmEnabled: row.segmentExtraKmEnabled,
  };
}
