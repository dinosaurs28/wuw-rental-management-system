import type { OdometerSegment } from "@/types/drop";

/** Extra-km figures shown at drop — either a live preview or the server's computed values. */
export interface KmChargeFigures {
  kmDriven: number;
  includedKm: number;
  extraKm: number;
  extraKmRate: number;
  /** Face value — drop charges carry no GST (item 8). */
  extraKmCharge: number;
  extraKmEnabled: boolean;
  /** km can't be measured (a mid-rental swap was recorded without readings). */
  autoKmSkipped?: "VEHICLE_SWAPPED" | null;
  /** km on vehicles handed back at mid-rental swaps. */
  priorKm?: number;
  /** Finished odometer segments (one per mid-rental swap with readings). */
  segments?: OdometerSegment[];
  /** Extra km typed by staff (swap without readings). */
  manualExtraKm?: number | null;
  kmSource?: "ODOMETER" | "STAFF_ENTERED" | "NONE";
  /** includedKm = freeKmOriginal + freeKmExtensions (#7); absent from older servers. */
  freeKmOriginal?: number | null;
  freeKmExtensions?: number | null;
}

/**
 * Same maths as the server's EXTRA_KM line:
 *   kmDriven = priorKm (vehicles handed back at swaps) + (end − current vehicle's start)
 *   extraKm  = max(0, kmDriven − includedKm), or the staff-entered km after a swap
 *              recorded without readings
 *   charge   = enabled ? ceil(extraKm × rate) : 0   (no GST)
 */
export function previewKmCharge(
  startOdometer: number | null,
  endOdometer: number,
  allowance: {
    includedKm: number;
    extraKmRate: string;
    extraKmEnabled: boolean;
    autoKmSkipped?: "VEHICLE_SWAPPED" | null;
    freeKmOriginal?: number | null;
    freeKmExtensions?: number | null;
  },
  opts: { priorKm?: number; segments?: OdometerSegment[]; manualExtraKm?: number | null } = {},
): KmChargeFigures {
  const skipped = !!allowance.autoKmSkipped;
  const manualExtraKm = skipped && opts.manualExtraKm != null ? Math.max(0, Math.floor(opts.manualExtraKm)) : null;
  const priorKm = skipped ? 0 : Math.max(0, opts.priorKm ?? 0);
  const kmDriven = skipped ? 0 : priorKm + Math.max(0, endOdometer - (startOdometer ?? endOdometer));
  const extraKm = skipped ? manualExtraKm ?? 0 : Math.max(0, kmDriven - allowance.includedKm);
  const extraKmRate = parseFloat(allowance.extraKmRate) || 0;
  return {
    kmDriven,
    includedKm: allowance.includedKm,
    extraKm,
    extraKmRate,
    extraKmCharge: allowance.extraKmEnabled ? Math.ceil(extraKm * extraKmRate) : 0,
    extraKmEnabled: allowance.extraKmEnabled,
    autoKmSkipped: allowance.autoKmSkipped ?? null,
    priorKm,
    segments: skipped ? [] : opts.segments ?? [],
    manualExtraKm,
    kmSource: !skipped ? "ODOMETER" : manualExtraKm != null ? "STAFF_ENTERED" : "NONE",
    freeKmOriginal: allowance.freeKmOriginal ?? null,
    freeKmExtensions: allowance.freeKmExtensions ?? null,
  };
}
