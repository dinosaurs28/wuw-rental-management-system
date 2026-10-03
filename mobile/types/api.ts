import type { BranchScheduleConfig } from '../lib/branchSchedule';
import type { RentInclGstFields } from '../lib/gst';

// Period type returned by the pricing engine (duration-calculator.service.ts)
export type RentalPeriodType = 'HOURLY' | 'HALF_DAY' | 'FULL_DAY' | 'MULTI_DAY' | 'MONTHLY';

// Lightweight per-group pricing the LIST endpoint returns when start/end are sent.
// price / finalPrice are the TOTAL for the period (before / after discount);
// type is the period type.
export interface ListPricing {
  price: number;
  finalPrice: number;
  type: RentalPeriodType | string;
  // What the price covers (#5), e.g. "5 hours", "12 hours", "1 day + 2 hours".
  // Absent on payloads cached before it shipped.
  billedAs?: string;
  billedAsType?: RentalPeriodType;
  // Duration-slab saving already inside finalPrice (#24) — absent when none.
  discountAmount?: number;
  discountPercent?: number;
  discountLabel?: string | null;
  // GST-inclusive rent (item 17): price / finalPrice include GST; these split
  // finalPrice (rentWithoutGst + gst = finalPrice, gst = cgst + sgst). Absent
  // when the branch has no GST rule, and on older servers.
  rentWithoutGst?: number;
  gst?: number;
  cgst?: number;
  sgst?: number;
}

// ── Customer payment plan (#6, advance only since item 18) ──────────────────
// The server decides the one plan a booking is paid with (from the amounts —
// the branch's customerPaymentMode is ignored) and sends it as
// `paymentOptions`; screens render exactly that, never a choice.
export type PaymentFlow = 'FULL' | 'ADVANCE';
export type CustomerPaymentMode = 'ADVANCE_ONLY' | 'FULL_ONLY' | 'BOTH';
export type PaymentFlowReason =
  | 'BRANCH_FULL_ONLY'
  | 'BRANCH_ADVANCE_ONLY'
  | 'NO_ADVANCE_CONFIGURED'
  | 'ADVANCE_NOT_BELOW_TOTAL';

export interface PaymentOptions {
  mode: CustomerPaymentMode;
  /** Configured advance (vehicle / group representative). */
  advanceAmount: number;
  /** FULL-plan total: rental after discounts + GST + refundable deposit. null without dates. */
  payableTotal: number | null;
  /** 0 < advance < payableTotal; null when there are no dates yet. */
  advanceEligible: boolean | null;
  /** Show a chooser only when both are allowed. */
  allowedFlows: PaymentFlow[];
  /** Preselect this (FULL when both are allowed). */
  defaultFlow: PaymentFlow;
  reason: PaymentFlowReason | null;
  /** Human text for `reason` — shown under the plan. */
  reasonMessage: string | null;
  /** payableTotal − advance (due at pickup) when ADVANCE is allowed. */
  remainingAfterAdvance: number | null;
  /** Item 18 servers: charged online now (advance, or the full total on FULL; null without dates). */
  payNowAmount?: number | null;
  /** Item 18 servers: collected at pickup (0 on FULL; null without dates). */
  dueAtPickup?: number | null;
}

export interface Vehicle {
  publicId: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  images: string[];
  pricing: { daily: number | null; hourly?: number | null; halfDay?: number | null };
  // present only when the list was queried with start/end
  priceInfo?: ListPricing | null;
  availability: boolean | null;
  availableCount?: number;
  // Trip-type tags (HIGHWAY | HILL_STATION | LONG_DRIVE)
  useCases?: string[];
  // The vehicle's branch, for its office hours (#2). Optional: cached payloads may lack it.
  branchPublicId?: string | null;
}

export interface VehicleDetail extends Vehicle {
  status: string;
  deposit: number;
  advancePayAmount: number;
  customerPaymentMode?: CustomerPaymentMode;
  // Plans this vehicle/group may be booked with (#6). Absent on older servers.
  paymentOptions?: PaymentOptions | null;
  pricingDetails: PricingDetails | null;
  availableCount?: number;
}

// Real rental duration the pricing engine computes (pricing-engine.service.ts → RentalDuration)
export interface RentalDuration {
  periodType: RentalPeriodType | string;
  hours: number;
  days: number;
  actualDuration: number;
  billableDuration: number;
}

// Classic fields are in TAXABLE terms (item 17): basePrice / discountAmount /
// taxAmount = rent without GST, its discount and the GST; finalTotal = rent
// incl. GST after discounts. Show the price from the inclusive fields
// (RentInclGstFields: rentInclGst, discountInclGst, … — lib/gst rentInclGstView).
export interface PricingDetails extends RentInclGstFields {
  basePrice: number;
  // Combined discount (duration slab + coupon + manual).
  discountAmount: number;
  discountPercent: number;
  // Duration-slab layer, named (#24) — e.g. label "Weekly", 10 (%). Optional:
  // cached payloads and older servers lack them. FLAT slabs are ₹ off per vehicle.
  durationDiscountAmount?: number;
  durationDiscountPercent?: number;
  durationDiscountLabel?: string | null;
  durationDiscountType?: 'PERCENTAGE' | 'FLAT' | null;
  couponDiscountAmount?: number;
  deposit: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxRate: number;
  // Per-tax rates (#23): label CGST/SGST with these, never taxRate / 2. May be
  // null for a minute on a pricing result cached before the server had them.
  cgstRate?: number | null;
  sgstRate?: number | null;
  finalTotal: number;
  freeKmLimit: number;
  extraKmRate: number;
  pricingBreakdown: {
    periodType: RentalPeriodType | string;
    duration: RentalDuration;
    applicablePrice: number;
    priceSource: string;
    // What was billed (#5) — may differ from periodType, e.g. an 8 h trip
    // billed as "12 hours" or a 13 h one as "1 day". Optional (cached payloads).
    billedAs?: string;
    billedAsType?: RentalPeriodType;
  };
}

// Extension eligibility — customer GET /api/user/bookings/:id/extension-eligibility
// and Fleet GET /api/employee/extensions/eligibility/:id. Everything after
// `reason` is optional: the customer endpoint's early returns (booking not
// active, extension pending) and older servers omit it.
export interface ExtensionEligibility {
  eligible: boolean;
  reason: string | null;
  hoursUntilEnd?: number;
  /** Latest end an extension may request (ISO) — 15 days, or 180 for a monthly plan. */
  maxEndAt?: string;
  /** The booking already ends at maxEndAt — nothing left to extend. */
  atCap?: boolean;
  maxBookingDays?: number;
  isMonthly?: boolean;
  rentalPeriodType?: RentalPeriodType | null;
  bookingStartAt?: string;
  currentEndAt?: string;
  branchPublicId?: string;
  /** Same shape as the public branch schedule. */
  officeHours?: BranchScheduleConfig;
  /**
   * Customer endpoint only (BRIEF4 P3): what a customer may add — +12 hours,
   * +1 day, +2 days … up to maxEndAt. insideHours:false = that return is
   * outside the branch's return hours (offer it disabled). Absent on early
   * returns and older servers.
   */
  packageOptions?: Array<{ hours: number; label: string; newEndAt: string; insideHours: boolean }>;
}

// Free km an extension adds to the drop allowance (#7), server-computed: each
// whole 24 h → freeKm24Hour, a remaining block of 12 h or more → freeKm12Hour,
// other hours → 0 (an extension under 12 h adds none). On extension quotes
// (pricing.extensionFreeKm), commit responses and drop timeline rows (freeKm).
// Absent from older servers; null when the vehicle's free km can't be read.
export interface ExtensionFreeKm {
  km: number;
  minutes: number;
  fullDays: number;
  halfDay: boolean;
  minutesWithoutKm: number;
  freeKm24Hour: number;
  freeKm12Hour: number;
  /** e.g. "150 km for 1 day; no km for the other 2 h". */
  label: string;
}

export interface BookingTrip {
  id: number;
  bookingId: string;
  status: BookingStatus;
  paymentStatus: string;
  startAt: string;
  endAt: string;
  days: number;
  total: number;
  isAdvancePayment: boolean;
  advanceAmount: number;
  remainingBalance: number;
  amountPaid: number;
  // Partial payment (#6) — optional, older servers omit them. `paid` is money
  // actually received (0 for HOLD / expired / failed / refunded); the balance
  // of an advance booking is due at PICKUP, or at DROP once picked up.
  paid?: number;
  balanceDue?: number;
  balanceDueAt?: 'PICKUP' | 'DROP' | null;
  dueAtPickup?: number;
  dueAtDrop?: number;
  // Part of balanceDue left on credit at the branch counter (#11): still owed,
  // the branch collects it against what it holds. Absent on older servers.
  balanceOnCredit?: number;
  // Applied coupon (online or counter) and the original booking's money (#20).
  couponCode?: string | null;
  totalBase?: number;
  totalDiscount?: number;
  totalTax?: number;
  // CGST / SGST of totalTax and the booking's frozen rates — null when the
  // booking stored no split; absent on older servers.
  totalCgst?: number | null;
  totalSgst?: number | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
  // GST-inclusive rent of the original booking (item 17), absent on older
  // servers: rentInclGst − discountInclGst = rentAfterDiscountInclGst
  // = rentWithoutGst + totalTax.
  rentInclGst?: number;
  discountInclGst?: number;
  rentAfterDiscountInclGst?: number;
  rentWithoutGst?: number;
  createdAt: string;
  vehicles: BookingVehicle[];
}

export interface BookingVehicle {
  publicId: string;
  make: string;
  model: string;
  thumbnail: string | null;
  finalTotal: number;
}

export type BookingStatus =
  | 'HOLD'
  | 'CONFIRMED'
  | 'PICKED_UP'
  | 'RETURNED'
  | 'CANCELLED';

export interface User {
  name: string;
  email: string;
  role: string;
  publicId: string;
  branchName?: string | null;
  branchPublicId?: string | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface Branch {
  id: number;
  name: string;
}

export interface ApiResponse<T> {
  message: string;
  data: T;
}

// ── Employee return charge session ──────────────────────────────────────────
export interface LedgerEntry {
  publicId: string;
  entryType: string;        // EXTRA_KM | FUEL | FASTAG | DAMAGE | DEPOSIT | PAYMENT ...
  classification: string;
  amount: string;           // 2dp string; negative = credit / payment / deposit
  gstAmount: string;
  // Drop lines (D5): taxable value and its CGST/SGST (rate frozen per line).
  baseAmount?: string;
  cgst?: string;
  sgst?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description: string;
  isVoided: boolean;
  createdAt: string;
}

export interface ReturnSession {
  publicId: string;
  sessionType: string;      // "RETURN"
  status: string;           // AWAITING_PAYMENT | PAYMENT_INITIATED | COMPLETED | ...
  netPayable: string;       // >0 customer pays, <0 refund due, 0 balanced (deposit already netted)
  totalCharges: string;
  totalDiscounts: string;
  totalPaymentsRecorded: string;
  taxableBase: string;
  nonTaxableBase: string;
  gstAmount: string;
  isRefund: boolean;
  entries: LedgerEntry[];
}

// ── WhatsApp support config ─────────────────────────────────────────────────
export interface WhatsAppConfig {
  phoneNumber: string;     // raw digits, no leading +
  messageTemplate: string; // may contain {{token}} placeholders
  isEnabled: boolean;
}

// ── Employee counter payment panel ──────────────────────────────────────────
// All Decimal fields arrive as 2dp strings (e.g. "1500.00").
export interface FinancialState {
  bookingId: number;
  bookingPublicId: string;
  totalFinal: string;
  totalCollectedConfirmed: string;
  totalCollectedPending: string;
  totalRefunded: string;
  amountDue: string; // max(0, totalOwed - (totalCollectedConfirmed - refunds paid out))
  /** Drop / return charges outside totalFinal, after the drop discount — at face value, no GST since item 8 (absent on older servers) */
  returnCharges?: string;
  /** Refundable safety deposit taken and not yet credited back at drop (absent on older servers) */
  safetyDepositHeld?: string;
  /** totalFinal + returnCharges + safety deposit held (absent on older servers) */
  totalOwed?: string;
  /** Part of amountDue put on customer credit (#11) and not cleared yet — still due. */
  creditPending?: string;
  /** The booking's credit position, or null (absent on older servers). */
  credit?: BookingCreditSummary | null;
  /** Legacy drop's safety-deposit choice (#6): SET_OFF | REFUND_IN_FULL, or null. */
  safetyDepositHandling?: 'SET_OFF' | 'REFUND_IN_FULL' | null;
  lifecycleState:
    | 'UNPAID'
    | 'PARTIALLY_PAID'
    | 'PAID_PENDING_CONFIRMATION'
    | 'FULLY_PAID'
    | 'OVERPAID'
    | 'REFUNDED';
  transactions: FinancialStateTxn[];
}

// Fleet credit (#11) on a booking: money still owed against the collateral held
// until the branch manager clears it. Amounts are 2-dp strings.
export interface BookingCreditSummary {
  creditEntryPublicId: string;
  status: 'PENDING' | 'PARTIALLY_CLEARED' | 'CLEARED' | string;
  total: string;
  cleared: string;
  pending: string;
  collateral: string[];
  pendingSections: {
    sectionKey: string;
    label: string;
    amount: number | string;
    collateral: string | null;
    purpose: string | null;
    createdAt: string | null;
  }[];
}

export interface FinancialStateTxn {
  publicId: string;
  purpose: string;
  method: string;
  status: string; // INITIATED | COLLECTED | CONFIRMED | REJECTED | FAILED | REFUNDED
  totalAmount: string;
  collectedAt: string | null;
  confirmedAt: string | null;
}

export interface PaginatedResponse<T> {
  message: string;
  data: T[];
  meta: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export type KycType = 'DL' | 'AADHAAR' | 'PAN' | 'STUDENT_ID';
export type KycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type KycSide = 'FRONT' | 'BACK';

export interface KycDocument {
  publicId: string;
  type: KycType;
  side: KycSide;
  status: KycStatus;
  file: { publicId: string; url: string; mimeType?: string };
  createdAt: string;
}

// Customer QR code photo (#4): a photo of the QR the walk-in customer presents
// (Aadhaar / DigiLocker…). `url` is a presigned private-bucket link that
// expires after `expiresIn` seconds (900) — refetch for a fresh one.
export interface QrPhoto {
  publicId: string; // send as qr_photo_id on walk-in booking create
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

export interface QrPhotoCustomer {
  publicId: string;
  name: string;
  phone: string | null;
}

// GET/POST /api/employee/customer/:publicId/qr-photo
export interface CustomerQrPhotoData {
  customer: QrPhotoCustomer;
  qrPhoto: QrPhoto | null;
}

// BOOKING = this booking's snapshot; CUSTOMER = no snapshot, the customer's
// current photo; null = no photo at all.
export type QrPhotoSource = 'BOOKING' | 'CUSTOMER' | null;

// GET/POST /api/employee/bookings/:bookingId/qr-photo
export interface BookingQrPhotoData {
  booking: { publicId: string; status: string };
  customer: QrPhotoCustomer;
  qrPhoto: QrPhoto | null;
  source: QrPhotoSource;
  // true only while the booking is HOLD or CONFIRMED
  canReplace: boolean;
}

export interface UserProfile {
  name: string;
  // null when the account only has a walk-in placeholder address.
  email: string | null;
  phone: string | null;
  dob: string | null;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  alternatePhone: string;
  // Full, normalised numbers — GET /user/profile is the owner's own profile.
  // Absent on servers older than #1.
  drivingLicenceNumber?: string | null;
  aadhaarNumber?: string | null;
  isProfileCompleted: boolean;
  /** Empty required fields (keys of CUSTOMER_PROFILE_FIELD_LABELS in lib/identity). */
  missingFields?: string[];
}

// ── Reschedule a CONFIRMED booking (BRIEF4 P4c) ─────────────────────────────
// GET /api/employee/bookings/:publicId/reschedule → data. The booking keeps
// its length and price; only the pickup (and with it the return) moves.
export interface RescheduleBusyRange {
  startAt: string;
  endAt: string;
  bookingPublicId: string | null;
  bookingStatus: string | null;
}

export interface RescheduleOptions {
  bookingPublicId: string;
  status: string;
  /** false ⇒ show `reason` and don't offer times. */
  reschedulable: boolean;
  code: string | null;
  reason: string | null;
  startAt: string;
  endAt: string;
  /** Fixed: the new return = the new pickup + this. */
  durationMinutes: number;
  durationLabel: string;
  isMonthly: boolean;
  rentalPeriodType: RentalPeriodType | null;
  /** Now (to the minute) — offer pickups from here. */
  earliestStartAt: string;
  /** Standard: window end − length; monthly: window end. */
  latestStartAt: string;
  /** The server takes a pickup up to this many minutes in the past. */
  pastToleranceMinutes: number;
  branchPublicId: string;
  /** Same shape as the public branch schedule. */
  officeHours: BranchScheduleConfig;
  vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  /** Other bookings / holds on the vehicle(s); bookingPublicId null = a customer checkout in progress. */
  vehicleBusy: Array<RescheduleBusyRange & { vehiclePublicId: string; kind: 'BOOKING' | 'HOLD' }>;
  /** Other bookings on the customer's driving licence. */
  dlBusy: RescheduleBusyRange[];
}

// POST /api/employee/bookings/:publicId/reschedule → data
export interface RescheduleResult {
  booking: {
    publicId: string;
    status: string;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    rentalPeriodType: RentalPeriodType | null;
    branchPublicId: string;
    vehicles: Array<{ publicId: string; make: string; model: string; regNo: string }>;
  };
  previous: { startAt: string; endAt: string };
  /** Positive = later, negative = earlier. */
  shiftMinutes: number;
  reason: string | null;
  releasedExtensionQuotePublicId: string | null;
}
