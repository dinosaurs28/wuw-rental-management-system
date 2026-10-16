// Trip-type tags (Oct 20 2026): "Udupi/Manipal" (LOCAL) and "Out of Udupi"
// (OUT_OF_UDUPI) replace Highway / Hill Station / Long Drive. Mirrors
// packages/schemas/src/vehicle.schema.ts — the legacy tags read as OUT_OF_UDUPI.

export const VEHICLE_USE_CASES = ['LOCAL', 'OUT_OF_UDUPI'] as const;
export type VehicleUseCase = (typeof VEHICLE_USE_CASES)[number];

export const VEHICLE_USE_CASE_LABELS: Record<VehicleUseCase, string> = {
  LOCAL: 'Udupi/Manipal',
  OUT_OF_UDUPI: 'Out of Udupi',
};

/** Tags no longer offered; read as OUT_OF_UDUPI. */
export const LEGACY_VEHICLE_USE_CASES = ['HIGHWAY', 'HILL_STATION', 'LONG_DRIVE'] as const;

/** The offered tags in a list: legacy → OUT_OF_UDUPI, unknown dropped, deduped, fixed order. */
export function normalizeUseCases(v: readonly unknown[] | null | undefined): VehicleUseCase[] {
  const set = new Set(
    (v ?? []).map((x) => {
      const t = typeof x === 'string' ? x.trim().toUpperCase() : x;
      return (LEGACY_VEHICLE_USE_CASES as readonly unknown[]).includes(t) ? 'OUT_OF_UDUPI' : t;
    }),
  );
  return VEHICLE_USE_CASES.filter((t) => set.has(t));
}
