// Types for the Fleet Executive vehicle-return flow.

import type { ExtensionFreeKm } from './api';

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
  // set when extra km can't be auto-calculated — only a mid-rental swap
  // recorded WITHOUT odometer readings (swaps with readings are measured)
  autoKmSkipped?: 'VEHICLE_SWAPPED' | null;
  // true only then: staff type the extra km at drop (manualExtraKm)
  manualExtraKmAllowed?: boolean;
  // includedKm = free km of the original period + free km the extensions add (#7)
  freeKmOriginal?: number;
  freeKmExtensions?: number;
  // extensions counted in freeKmExtensions — absent from older servers
  extensionCount?: number;
}

// ── Rental timeline (#7) and late return (#12) ─────────────────────────────

export type LateReturnStatus =
  | 'ON_TIME'
  | 'WITHIN_GRACE'
  | 'CHARGED'
  | 'WAIVED'
  | 'DISABLED'
  | 'RATE_UNAVAILABLE';

export type GraceType = 'AUTOMATIC' | 'MANUAL';

// What the automatic late-return line bills (money as 2 dp strings).
export interface LateChargePreview {
  hours: number;
  rate: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  gst: string;
  gstRate: string | null;
  total: string;
  status: LateReturnStatus;
  graceApplied: boolean;
  // 'GST_RULE_MISSING' when the branch has no GST rule (GST not shown)
  gstUnavailableReason?: string | null;
}

export interface RentalTimelineExtension {
  publicId: string;
  oldEndAt: string;
  newEndAt: string;
  minutes: number;
  status: 'CONFIRMED' | 'PAYMENT_COLLECTED' | 'PENDING_PAYMENT' | string;
  // committed hold not paid yet
  unpaid: boolean;
  // cash taken, the branch manager hasn't confirmed it
  awaitingConfirmation: boolean;
  isPartial: boolean;
  trigger: string;
  additionalAmount: string; // GST-inclusive
  taxAmount: string;
  // free km this extension adds to the allowance (#7); null when unknown, absent from older servers
  freeKm?: ExtensionFreeKm | null;
}

// Original / extended / late rental time, in whole minutes
// (originalMinutes + extendedMinutes = totalMinutes exactly).
export interface RentalTimeline {
  startAt: string;
  originalEndAt: string;
  currentEndAt: string;
  originalMinutes: number;
  extendedMinutes: number;
  totalMinutes: number;
  extensionCount: number;
  extensions: RentalTimelineExtension[];
  // Σ free km the extensions add (0 with none); null when the vehicle's free km are unknown
  extensionFreeKmTotal?: number | null;
  // Late part, as of the return time frozen on the open drop bill, else now.
  returnedAt: string | null;
  lateMinutes: number;
  graceMinutes: number;
  graceType: GraceType | null;
  gracePolicyEnabled: boolean;
  graceApplied: boolean;
  extraTimeEnabled: boolean;
  totalWithLateMinutes: number;
  lateChargePreview: LateChargePreview | null;
  // MANUAL grace only: what "Apply grace" would bill
  lateChargePreviewWithGrace: LateChargePreview | null;
}

// `late` on the drop bill / legacy complete response.
export interface ReturnLateSummary {
  dueAt: string;
  returnedAt: string;
  lateMinutes: number;
  graceMinutes: number;
  graceApplied: boolean;
  gracePolicyEnabled: boolean;
  graceType: GraceType | null;
  extraTimeEnabled: boolean;
  chargeableMinutes: number;
  hours: number;
  rate: string | null;
  status: LateReturnStatus;
  taxable: string;
  cgst: string;
  sgst: string;
  gst: string;
  gstRate: string | null;
  total: string;
  waived: boolean;
  waivedAmount: string;
  waiverReason: string | null;
}

// ── Mid-rental swaps (#13 at drop) ─────────────────────────────────────────

export interface KmSegment {
  endedBySwapPublicId: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  km: number | null;
}

// Odometer segments across mid-rental swaps (null unless PICKED_UP).
export interface KmSegments {
  swapCount: number;
  swapsMissingReadings: number;
  // every swap has readings, so km can be measured
  complete: boolean;
  // km on vehicles already handed back
  priorKm: number;
  // drop endOdometer must be ≥ this (when complete)
  currentStartOdometer: number | null;
  segments: KmSegment[];
}

// A vehicle-swap difference that will be billed on the drop bill.
export interface SwapChargePreview {
  swapPublicId: string;
  swappedAt: string;
  label: string;
  taxable: string;
  // null when the branch has no GST rule
  cgst: string | null;
  sgst: string | null;
  gst: string | null;
  total: string | null;
  gstUnavailableReason: string | null;
}

// ── Drop bill (#23) ─────────────────────────────────────────────────────────
// Item 8: drop / recovery charges carry no GST — every line comes back with
// taxable false, GST "0.00" and total = amount; bill.gst "0.00", gstRates null.
// A bill computed before that is reported stale by GET …/return/session
// (billStale true, billStaleReason "DROP_GST_REMOVED") and must be recomputed.

export interface GstRates {
  cgstRate: number;
  sgstRate: number;
  rate: number;
}

export interface DropBillLine {
  type: string;
  label: string;
  // EXTRA_KM | LATE_RETURN | VEHICLE_SWAP | OTHER_CHARGE | DROP_DAMAGE | …
  referenceType: string;
  referenceId: string | null;
  taxable: boolean;
  amount: string; // taxable value (full amount when not taxable)
  cgst: string;
  sgst: string;
  gst: string;
  total: string;
}

export interface DropBill {
  gstRates: GstRates | null;
  lines: DropBillLine[];
  subtotal: string; // Σ line amounts, before discount and GST
  taxableTotal: string;
  nonTaxableTotal: string;
  discount: {
    amount: string;
    taxableShare: string;
    nonTaxableShare: string;
    cgst: string;
    sgst: string;
    gst: string;
  } | null;
  taxableValue: string;
  nonTaxableValue: string;
  cgst: string;
  sgst: string;
  gst: string;
  total: string; // drop charges incl. GST, before the deposit credit
}

// Legacy (no Unified Payments) complete: charges the branch manager collects.
export interface LegacyReturnChargeLine {
  type: 'EXTRA_KM' | 'EXTRA_TIME' | 'VEHICLE_SWAP' | string;
  label: string;
  // VEHICLE_SWAP: the swap's publicId (absent on older servers).
  referenceId?: string | null;
  taxable: boolean;
  amount: string;
  cgst: string;
  sgst: string;
  gst: string;
  total: string;
}

// POST /api/employee/return/:bookingId/complete
export interface CompleteReturnResponse {
  message: string;
  returnedAt?: string;
  km?: ReturnKmSummary | null; // null when endOdometer wasn't sent
  late?: ReturnLateSummary | null;
  returnCharges?: {
    collectedBy: 'BRANCH_MANAGER' | string;
    gstRates: GstRates | null;
    lines: LegacyReturnChargeLine[];
    total: string;
  } | null;
  // #6 — the held safety deposit's settlement as recorded (null when none held).
  safetyDeposit?: {
    handling: 'SET_OFF' | 'REFUND_IN_FULL';
    amount: string;
    settledBy: 'BRANCH_MANAGER' | string;
  } | null;
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
  // A legacy drop was recorded and sent for the branch manager's confirmation.
  requiresManagerConfirmation?: boolean;
  days: number | null;
  startOdometer: number | null;
  pickupFuelLevel: string | null;
  safetyDeposit: string | number | null;
  usePaymentSessions: boolean;
  frozenChargeConfig: { fuelModuleEnabled?: boolean; fastagModuleEnabled?: boolean } | null;
  // Original driving licence held at the counter since pickup.
  licenseCollectedAt?: string | null;
  licenseReturnedAt?: string | null;
  // Original driving licence status chosen at pickup (#3); null = not recorded.
  // Same union as lib/dlStatus DlCollectionStatus.
  dlStatus?: 'COLLECTED' | 'NOT_COLLECTED' | 'DEPOSIT' | null;
  dlDepositNote?: string | null;
  dlStatusUpdatedAt?: string | null;
  kmAllowance?: KmAllowance | null;
  // Drop (D5) — absent on servers older than this release.
  rentalTimeline?: RentalTimeline | null;
  kmSegments?: KmSegments | null;
  swapCharges?: SwapChargePreview[];
  // Fuel bars at the original pickup (pickupFuelLevel is the current
  // vehicle's start fuel — the replacement's after a mid-rental swap).
  originalPickupFuelLevel?: string | null;
  returnedAt?: string | null;
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
  // km on vehicles handed back at mid-rental swaps (included in kmDriven)
  priorKm?: number;
  // extra km typed by staff (swap without readings)
  manualExtraKm?: number | null;
  kmSource?: 'ODOMETER' | 'STAFF_ENTERED' | 'NONE';
  swapCount?: number;
  segments?: KmSegment[];
  // includedKm = free km of the original period + free km the extensions add (#7)
  freeKmOriginal?: number;
  freeKmExtensions?: number;
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
