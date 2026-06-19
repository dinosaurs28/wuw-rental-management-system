export interface Vehicle {
  publicId: string;
  make: string;
  model: string;
  category: string;
  branch: string;
  images: string[];
  pricing: { daily: number | null };
  availability: boolean | null;
  availableCount?: number;
}

export interface VehicleDetail extends Vehicle {
  status: string;
  deposit: number;
  advancePayAmount: number;
  customerPaymentMode?: 'ADVANCE_ONLY' | 'FULL_ONLY' | 'BOTH';
  pricingDetails: PricingDetails | null;
  availableCount?: number;
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
    periodType: string;
    duration: number;
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
  isAdvancePayment: boolean;
  advanceAmount: number;
  remainingBalance: number;
  amountPaid: number;
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

export interface KycDocument {
  publicId: string;
  type: KycType;
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
