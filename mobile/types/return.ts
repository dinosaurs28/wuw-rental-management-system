// Types for the Fleet Executive vehicle-return flow.

export type FuelLevel =
  | 'EMPTY'
  | 'QUARTER'
  | 'HALF'
  | 'THREE_QUARTER'
  | 'FULL';

export const FUEL_LEVELS: { value: FuelLevel; label: string; pct: number }[] = [
  { value: 'EMPTY',         label: 'Empty', pct: 0 },
  { value: 'QUARTER',       label: '¼',     pct: 25 },
  { value: 'HALF',          label: '½',     pct: 50 },
  { value: 'THREE_QUARTER', label: '¾',     pct: 75 },
  { value: 'FULL',          label: 'Full',  pct: 100 },
];

export const fuelLevelToPct = (l?: FuelLevel | null): number =>
  FUEL_LEVELS.find((f) => f.value === l)?.pct ?? 0;

export const pctToFuelLevel = (pct?: number | null): FuelLevel => {
  if (pct == null) return 'EMPTY';
  // Round down to nearest fuel-level bucket
  if (pct >= 100) return 'FULL';
  if (pct >= 75) return 'THREE_QUARTER';
  if (pct >= 50) return 'HALF';
  if (pct >= 25) return 'QUARTER';
  return 'EMPTY';
};

export type PaymentMethod = 'CASH' | 'ONLINE';

export type SessionStatus =
  | 'OPEN'
  | 'COMPUTING'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_INITIATED'
  | 'COMPLETED'
  | 'ABANDONED';

export interface ChargeEntry {
  chargeType: string;
  moduleKey: string;
  label: string;
  originalAmount: string;
  finalAmount: string;
  quantity: string | null;
  unitRate: string | null;
  isOverridden: boolean;
  notes: string | null;
}

export interface ChargeBreakdown {
  bookingId?: string;
  subtotal: string;
  waivedTotal: string;
  finalTotal: string;
  charges: ChargeEntry[];
}

export interface LedgerEntry {
  publicId?: string;
  type?: string;
  amount: string;
  notes?: string | null;
  createdAt?: string;
}

export interface PaymentSession {
  publicId: string;
  sessionType: 'PICKUP' | 'EXTENSION' | 'RETURN';
  status: SessionStatus;
  netPayable: string;
  totalCharges: string;
  totalDiscounts: string;
  totalPaymentsRecorded: string;
  taxableBase: string;
  nonTaxableBase: string;
  gstAmount: string;
  isRefund: boolean;
  entries: LedgerEntry[];
}

export interface ReturnSessionResponse {
  session: PaymentSession;
  chargeBreakdown: ChargeBreakdown;
}

export interface PickupCapture {
  publicId: string;
  url: string;
  thumbUrl?: string | null;
  capturedAt?: string | null;
}

export type DamageSeverity = 'MINOR' | 'MODERATE' | 'SEVERE';
export type DamageChargeType = 'PENALTY' | 'COMPENSATION';

export interface DamageEntry {
  area: string;
  severity: DamageSeverity;
  description: string;
  imageIds: string[];
}

// Zones differ for car vs 2-wheeler vehicles. The web hardcodes both lists in
// ReturnProcessPage.tsx around lines 480-485.
export const CAR_DAMAGE_ZONES = [
  'Front Bumper',
  'Rear Bumper',
  'Left Door',
  'Right Door',
  'Hood',
  'Boot',
  'Roof',
  'Windshield',
  'Headlight',
  'Taillight',
  'Mirror',
  'Wheel',
  'Other',
] as const;

export const TWO_WHEELER_DAMAGE_ZONES = [
  'Front Fairing',
  'Rear Fairing',
  'Fuel Tank',
  'Seat',
  'Handlebar',
  'Mirror',
  'Headlight',
  'Taillight',
  'Wheel',
  'Exhaust',
  'Other',
] as const;

// ── Drop (return) — booking details, km, discount, damages ─────────────────

// Plan-based free-km allowance for the booked period (server-computed).
export interface KmAllowance {
  includedKm: number;
  extraKmRate: string;
  extraKmEnabled: boolean;
  // set when extra km can't be auto-calculated (vehicle swapped mid-rental)
  autoKmSkipped?: 'VEHICLE_SWAPPED' | null;
}

// GET /api/employee/return/:bookingId
export interface ReturnBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  status: string;
  totalFinal: string | number;
  isAdvancePayment: boolean;
  remainingBalance: string | number | null;
  remainingPaidAt: string | null;
  days: number | null;
  startOdometer: number | null;
  pickupFuelLevel: string | null;
  safetyDeposit: string | number | null;
  usePaymentSessions: boolean;
  frozenChargeConfig: { fuelModuleEnabled?: boolean; fastagModuleEnabled?: boolean } | null;
  // Original driving licence held at the counter since pickup.
  licenseCollectedAt?: string | null;
  licenseReturnedAt?: string | null;
  kmAllowance?: KmAllowance | null;
  customer: { user: { name: string; phone: string | null } };
  items: Array<{
    vehicle: {
      publicId: string;
      make: string;
      model: string;
      regNo: string;
      odo: number | null;
      hasFastag?: boolean;
      // ₹ per fuel bar (of 10) — prices the fuel deficit at drop
      fuelBar?: string | number | null;
    };
  }>;
}

// `km` on the return-session compute response.
// autoKmSkipped: extra km wasn't auto-calculated (e.g. the vehicle was swapped
// mid-rental, so the odometers aren't comparable).
export interface ReturnKmSummary {
  startOdometer: number | null;
  endOdometer: number;
  kmDriven: number;
  includedKm: number;
  extraKm: number;
  extraKmRate: string;
  extraKmCharge: string;
  extraKmEnabled: boolean;
  autoKmSkipped?: 'VEHICLE_SWAPPED' | null;
}

export interface DropDiscount {
  amount: string;
  reason: string;
}

export type DropDamageSeverity = 'Minor' | 'Moderate' | 'Severe';

export interface DropDamageVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
}

// Damage recorded at drop; billed on the return session when chargeCustomer.
export interface DropDamage {
  publicId: string;
  area: string;
  severity: DropDamageSeverity;
  description: string;
  amount: string;
  chargeCustomer: boolean;
  // true = on the return-session bill; false = the manager charges it on review
  // (legacy branches) or it's a company expense.
  billedAtDrop: boolean;
  vehicle: DropDamageVehicle | null;
  photos: { publicId: string; url: string }[];
  createdAt: string;
}

export interface DropDamageInput {
  area: string;
  severity: DropDamageSeverity;
  description: string;
  amount: number;
  chargeCustomer: boolean;
  damageImageIds: string[];
  // required when the booking has more than one vehicle (VEHICLE_REQUIRED)
  vehiclePublicId?: string;
}
