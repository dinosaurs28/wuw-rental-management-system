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
