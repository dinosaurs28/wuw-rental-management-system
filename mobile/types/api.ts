// Period type returned by the pricing engine (duration-calculator.service.ts)
export type RentalPeriodType = 'HOURLY' | 'HALF_DAY' | 'FULL_DAY' | 'MULTI_DAY' | 'MONTHLY';

// Lightweight per-group pricing the LIST endpoint returns when start/end are sent.
// finalPrice is the duration TOTAL (after discount); type is the period type.
export interface ListPricing {
  price: number;
  finalPrice: number;
  type: RentalPeriodType | string;
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
}

export interface VehicleDetail extends Vehicle {
  status: string;
  deposit: number;
  advancePayAmount: number;
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

export interface PricingDetails {
  basePrice: number;
  discountAmount: number;
  discountPercent: number;
  deposit: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxRate: number;
  finalTotal: number;
  freeKmLimit: number;
  extraKmRate: number;
  pricingBreakdown: {
    periodType: RentalPeriodType | string;
    duration: RentalDuration;
    applicablePrice: number;
    priceSource: string;
  };
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
  amountDue: string; // max(0, totalFinal - totalCollectedConfirmed)
  lifecycleState:
    | 'UNPAID'
    | 'PARTIALLY_PAID'
    | 'PAID_PENDING_CONFIRMATION'
    | 'FULLY_PAID'
    | 'OVERPAID'
    | 'REFUNDED';
  transactions: FinancialStateTxn[];
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

export interface UserProfile {
  name: string;
  email: string;
  phone: string | null;
  dob: string | null;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  alternatePhone: string;
  isProfileCompleted: boolean;
}
