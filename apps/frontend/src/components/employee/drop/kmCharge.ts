/** Extra-km figures shown at drop — either a live preview or the server's computed values. */
export interface KmChargeFigures {
  kmDriven: number;
  includedKm: number;
  extraKm: number;
  extraKmRate: number;
  extraKmCharge: number;
  extraKmEnabled: boolean;
  /** Extra km isn't billed automatically (the vehicle was swapped mid-rental). */
  autoKmSkipped?: "VEHICLE_SWAPPED" | null;
}

/**
 * Same maths as the server's EXTRA_KM line:
 * extraKm = max(0, end − start − includedKm); charge = enabled ? ceil(extraKm × rate) : 0.
 */
export function previewKmCharge(
  startOdometer: number | null,
  endOdometer: number,
  allowance: {
    includedKm: number;
    extraKmRate: string;
    extraKmEnabled: boolean;
    autoKmSkipped?: "VEHICLE_SWAPPED" | null;
  },
): KmChargeFigures {
  const kmDriven = Math.max(0, endOdometer - (startOdometer ?? endOdometer));
  const extraKm = Math.max(0, kmDriven - allowance.includedKm);
  const extraKmRate = parseFloat(allowance.extraKmRate) || 0;
  return {
    kmDriven,
    includedKm: allowance.includedKm,
    extraKm,
    extraKmRate,
    extraKmCharge: allowance.extraKmEnabled && !allowance.autoKmSkipped ? Math.ceil(extraKm * extraKmRate) : 0,
    extraKmEnabled: allowance.extraKmEnabled,
    autoKmSkipped: allowance.autoKmSkipped ?? null,
  };
}
