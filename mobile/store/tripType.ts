import { create } from 'zustand';
import { VEHICLE_USE_CASES, type VehicleUseCase } from '../lib/tripTypes';

// The trip type the customer searched with (client, Oct 2026): "Udupi/Manipal"
// (LOCAL) or "Out of Udupi" (OUT_OF_UDUPI). Required before vehicles are
// listed; kept for the app session so the search screen, its edit sheet and a
// later "See all" reuse it. null = not chosen yet.

interface TripTypeState {
  tripType: VehicleUseCase | null;
  setTripType: (t: VehicleUseCase) => void;
}

export const useTripTypeStore = create<TripTypeState>((set) => ({
  tripType: null,
  setTripType: (tripType) => set({ tripType }),
}));

/** A trip type from a route param / unknown value, or null. */
export function parseTripType(v: unknown): VehicleUseCase | null {
  return typeof v === 'string' && (VEHICLE_USE_CASES as readonly string[]).includes(v) ? (v as VehicleUseCase) : null;
}
