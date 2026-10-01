// Vehicle swap (#13) — Fleet Executive, before pickup (pickup screen) and
// during an active rental (drop screen).
//
//   GET  /api/employee/bookings/:bookingId/available-vehicles → candidates + swapContext
//   POST /api/employee/bookings/:bookingId/swap-vehicle       → VehicleSwapRecord
//   GET  /api/employee/bookings/:bookingId/swap-history       → VehicleSwapRecord[] (newest first)
//
// Money is a 2-dp Decimal STRING ("299.95", may arrive as "1500") — Number() it.
// The price difference is PRE-GST and pro-rated to the rest of the rental; when
// charged it is billed at drop with GST on top.

export type SwapReason = 'CUSTOMER_REQUEST' | 'MAINTENANCE' | 'UPGRADE' | 'DOWNGRADE' | 'DAMAGE' | 'OTHER';

export const SWAP_REASONS: SwapReason[] = ['CUSTOMER_REQUEST', 'MAINTENANCE', 'UPGRADE', 'DOWNGRADE', 'DAMAGE', 'OTHER'];

export const SWAP_REASON_LABEL: Record<SwapReason, string> = {
  CUSTOMER_REQUEST: 'Customer request',
  MAINTENANCE: 'Maintenance',
  UPGRADE: 'Upgrade',
  DOWNGRADE: 'Downgrade',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

// Initial "Charge customer" value per reason when the server sends no defaults:
// the customer asked for the change, so they pay; company-caused swaps are free.
// The server never bills a request that omits chargeDifference — always send it.
const CHARGED_BY_DEFAULT: SwapReason[] = ['CUSTOMER_REQUEST', 'UPGRADE'];

// PRE_PICKUP = booking CONFIRMED (no readings); ACTIVE_RENTAL = PICKED_UP (all four readings).
export type SwapStage = 'PRE_PICKUP' | 'ACTIVE_RENTAL';

// One replacement offered by available-vehicles. `id` is the NUMERIC vehicle id
// the swap request takes.
export interface SwapCandidate {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: string;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
  images?: { url: string | null }[];
  // Current odometer — prefills the replacement's start reading (editable).
  odo?: number | null;
  // Last recorded fuel, as a percent (Vehicle.fuelLevel) — not bars.
  fuelLevel?: number | null;
  // The same reading as bars "1".."10" (null = unknown) — prefills the start fuel.
  fuelBars?: string | null;
  insuranceExpiry?: string;
  sameCategory?: boolean;
  // Higher category than the current car → "Upgrade" badge.
  isUpgrade?: boolean;
  // PRE-GST difference for the rest of the rental, ≥ 0; null = couldn't be priced.
  priceDifference?: string | null;
}

export interface SwapContext {
  bookingId: string;
  bookingStatus: string;
  stage: SwapStage;
  readingsRequired: boolean;
  startAt: string;
  endAt: string;
  remainingFrom: string;
  remainingFraction: string;
  currentVehicle: {
    id: number;
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    categoryId: number;
    categoryName: string;
    categoryRank: number;
    odo: number | null;
    // Percent; fuelBars is the same reading as bars "1".."10" (null = unknown).
    fuelLevel: number | null;
    fuelBars?: string | null;
  };
  // Reading the returning car started this rental segment at (pickup, or the
  // last mid-rental swap); its end odometer can't be lower. null = skip the check.
  currentVehicleStartOdometer: number | null;
  pricingAvailable: boolean;
  // Why the cars couldn't be priced (e.g. the branch has no GST rule).
  pricingError: string | null;
  chargeDifferenceDefaults: Partial<Record<SwapReason, boolean>>;
}

// available-vehicles response. swapContext is absent on servers older than #13.
export interface SwapCandidates {
  vehicles: SwapCandidate[];
  context: SwapContext | null;
}

export interface SwapVehicleSummary {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  category?: { name: string; rank: number } | null;
}

// A VehicleSwap row (swap response + history).
export interface VehicleSwapRecord {
  publicId: string;
  reason: SwapReason;
  reasonNotes: string | null;
  // Status the original car was left in (AVAILABLE / MAINTENANCE / MANAGER_REPORTED / …).
  originalVehicleStatus: string;
  originalVehicleNotes: string | null;
  swappedAt: string;
  // CONFIRMED = before pickup, PICKED_UP = during the rental, null = older row.
  bookingStatusAtSwap: string | null;
  originalVehicleEndOdometer: number | null;
  originalVehicleFuelLevel: string | null;
  newVehicleStartOdometer: number | null;
  newVehicleFuelLevel: string | null;
  priceDifference: string | number | null;
  // false with a priceDifference > 0 ⇒ the difference was waived.
  chargeDifference: boolean;
  originalVehicle: SwapVehicleSummary;
  newVehicle: SwapVehicleSummary;
  swappedBy: { publicId: string; name: string | null; role?: string } | null;
}

// POST swap-vehicle body. Readings are required when the booking is PICKED_UP.
export interface SwapVehicleBody {
  newVehicleId: number; // NUMERIC vehicle id from available-vehicles
  reason: SwapReason;
  reasonNotes?: string;
  markOriginalForMaintenance?: boolean;
  originalVehicleNotes?: string; // required when markOriginalForMaintenance
  originalVehicleEndOdometer?: number;
  originalVehicleFuelLevel?: string; // fuel bars "1".."10"
  newVehicleStartOdometer?: number;
  newVehicleFuelLevel?: string; // fuel bars "1".."10"
  // Bill the price difference at drop; omitted ⇒ not billed (old builds).
  chargeDifference?: boolean;
}

// Error codes of available-vehicles / swap-vehicle (`{ success:false, code, message, ...extra }`).
export type SwapErrorCode =
  | 'VALIDATION_ERROR'
  | 'BOOKING_NOT_FOUND'
  | 'SWAP_NOT_ELIGIBLE'
  | 'MANAGER_CONFIRMATION_PENDING'
  | 'BOOKING_OVERDUE'
  | 'RETURN_IN_PROGRESS'
  | 'EXTENSION_PENDING'
  | 'SAME_VEHICLE'
  | 'READINGS_REQUIRED'
  | 'ODOMETER_BELOW_START'
  | 'ODOMETER_BELOW_RECORDED'
  | 'PICKUP_IN_PROGRESS'
  | 'VEHICLE_NOT_FOUND'
  | 'VEHICLE_NOT_AVAILABLE'
  | 'VEHICLE_TYPE_MISMATCH'
  | 'CATEGORY_DOWNGRADE'
  | 'VEHICLE_BUSY'
  | 'BOOKING_CHANGED'
  | 'PRICE_DIFFERENCE_UNAVAILABLE';

// Fuel is recorded in bars, "1".."10".
export const SWAP_FUEL_BARS = Array.from({ length: 10 }, (_, i) => String(i + 1));

/** "1".."10" for a bars value (string or number), else null. */
export function fuelBarsValue(level: string | number | null | undefined): string | null {
  if (level == null) return null;
  const s = String(level).trim();
  return /^([1-9]|10)$/.test(s) ? s : null;
}

/** The price difference as a number; null when the cars couldn't be priced. */
export function priceDifferenceOf(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Initial "Charge customer" value for a reason: the server's default for it. */
export function defaultChargeDifference(context: SwapContext | null, reason: SwapReason): boolean {
  const fromServer = context?.chargeDifferenceDefaults?.[reason];
  return typeof fromServer === 'boolean' ? fromServer : CHARGED_BY_DEFAULT.includes(reason);
}
