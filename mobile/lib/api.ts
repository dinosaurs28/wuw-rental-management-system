import axios from 'axios';
import { useAuthStore } from '../store/auth';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().signOut();
    }
    return Promise.reject(err);
  },
);

// ─── vehicles ───────────────────────────────────────────────────────────────

export interface VehicleListParams {
  category?: string;
  branch?: string;
  search?: string;
  sort?: 'price_low_to_high' | 'price_high_to_low';
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}

export const vehiclesApi = {
  list: (params?: VehicleListParams) =>
    api.get('/api/public/vehicles', { params }),
  detail: (id: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/public/vehicles/${id}`, { params }),
  groupDetail: (groupKey: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/public/vehicles/group/${encodeURIComponent(groupKey)}`, { params }),
  categories: () => api.get('/api/public/categories'),
  branches: () => api.get('/api/public/branches'),
  // Coupon preview (stateless). Returns { data: { valid, discountAmount, ... } }, always HTTP 200.
  validateCoupon: (body: {
    couponCode: string;
    vehiclePublicId?: string;
    groupKey?: string;
    startAt: string;
    endAt: string;
  }) => api.post('/api/public/discount/validate', body),
  // Customer booking summary + payment initiation (creates a 10-min HOLD).
  createBooking: (body: {
    vehicles: string[];
    groupKeys: string[];
    start: string;
    end: string;
    file_public_id: string;
    payment_type: 'CASH' | 'ONLINE';
    payment_flow: 'FULL' | 'ADVANCE';
    couponCode?: string;
  }) => api.post('/api/public/vehicles/booking', body),
};

// ─── payment / config ───────────────────────────────────────────────────────

export const paymentApi = {
  // Customer online payment status: { status: 'Success' | 'Pending' | 'Failed' }
  status: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),
};

export const configApi = {
  // { data: { phoneNumber, messageTemplate, isEnabled } | null }
  whatsapp: () => api.get('/api/config/whatsapp'),
};

// ─── auth ─────────────────────────────────────────────────────────────────

export const authApi = {
  signIn: (email: string, password: string) =>
    api.post('/api/auth/email/signin', { email, password }),
  signUp: (name: string, email: string, password: string) =>
    api.post('/api/auth/email/signup', { name, email, password }),
  me: () => api.get('/api/auth/me?google=true'),
};

// ─── user ─────────────────────────────────────────────────────────────────

export const userApi = {
  bookings: (page = 1, limit = 10) =>
    api.get('/api/user/booking', { params: { page, limit } }),
  bookingHistory: (type?: string, page = 1) =>
    api.get('/api/user/booking/history', { params: { type, page, limit: 20 } }),
  profile: () => api.get('/api/user/profile'),
  updateProfile: (data: Record<string, unknown>) =>
    api.put('/api/user/profile', data),
  kyc: () => api.get('/api/user/kyc'),
  uploadKyc: (formData: FormData) =>
    api.post('/api/user/kyc', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteKyc: (publicId: string, customerPublicId: string) =>
    api.delete('/api/user/kyc', { data: { id: publicId, customer_public_id: customerPublicId } }),
  cancelHold: (holdId: string) =>
    api.delete(`/api/user/booking/hold/${holdId}`),
  // { data: { customerId, cancellations: [...], totalCancellations, totalOutstanding } }
  // Money fields (cancellationFee, totalOutstanding) arrive as STRINGS.
  cancellationHistory: () =>
    api.get('/api/user/cancellation-history'),

  // ── invoice (async PDF generation) ────────────────────────────────────────
  // bookingId is the NUMERIC booking.id (not the publicId UUID).
  invoiceDownload: (bookingId: number) =>
    api.post('/api/invoices/download', { bookingId }),
  invoiceStatus: (invoiceId: number) =>
    api.get(`/api/invoices/status/${invoiceId}`),
  invoiceRegenerate: (bookingId: number) =>
    api.post('/api/invoices/regenerate', { bookingId }),
};

// ─── employee ─────────────────────────────────────────────────────────────

export const employeeApi = {
  login: (email: string, password: string) =>
    api.post('/api/employee/auth/login', { email, password }),
  dashboardStats: () => api.get('/api/employee/dashboard/stats'),
  getActiveShift: () => api.get('/api/employee/payment/shifts/me/active'),
  openShift: () => api.post('/api/employee/payment/shifts'),
  closeShift: (publicId: string, body: { actualTotal: number; discrepancyExplanation?: string }) =>
    api.post(`/api/employee/payment/shifts/${publicId}/close`, body),
  listPickups: (params?: { date?: string }) =>
    api.get('/api/employee/booking', { params }),
  listReturns: (params?: { date?: string }) =>
    api.get('/api/employee/return', { params }),
  scanBooking: (bookingId: string) =>
    api.get(`/api/employee/booking/${bookingId}/scan`),
  searchCustomer: (query: string) =>
    api.get('/api/employee/customer/search', { params: { q: query } }),
  getCustomer: (publicId: string) =>
    api.get(`/api/employee/customer/${publicId}`),
  getPickupDetails: (bookingId: string) =>
    api.get(`/api/employee/pickup/${bookingId}`),
  uploadPickupImage: (formData: FormData) =>
    api.post('/api/employee/pickup/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deletePickupImage: (publicId: string) =>
    api.delete(`/api/employee/pickup/image/${publicId}`),
  completePickup: (bookingId: string, body: {
    odo: number;
    fuelLevel: number;
    // "1".."10"; required by backend only when the branch fuel module is enabled,
    // optional otherwise — mobile always sends it to be safe.
    pickupFuelLevel?: string;
    pickupImageIds?: string[];
    captureImages?: { fileId: string; label: string }[];
    requireManagerConfirmation?: boolean;
    payRemainingAtPickup?: boolean;
    // gated by booking.frozenChargeConfig.safetyDepositEnabled
    safetyDepositRequest?: { requestedAmount: number; reason: string };
  }) => api.post(`/api/employee/pickup/${bookingId}`, body),
  getReturnDetails: (bookingId: string) =>
    api.get(`/api/employee/return/${bookingId}`),
  // pre-delivery reference photos captured at pickup, for return comparison
  getPickupCaptures: (bookingId: string) =>
    api.get(`/api/employee/return/${bookingId}/pickup-captures`),
  uploadReturnImage: (formData: FormData) =>
    api.post('/api/employee/return/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  completeReturn: (bookingId: string, body?: {
    returnImageIds?: string[];
    requireManagerConfirmation?: boolean;
  }) => api.post(`/api/employee/return/${bookingId}/complete`, body ?? {}),
  getBookingKyc: (bookingId: string) =>
    api.get(`/api/employee/kyc/${bookingId}`),
  verifyKyc: (kycId: string, status: 'APPROVED' | 'REJECTED') =>
    api.patch(`/api/employee/kyc/${kycId}/status`, { status }),

  // ── remaining / advance balance collection (pickup + return) ──────────────
  initiateRemainingPaymentPickup: (
    bookingId: string,
    body: { method: 'CASH' | 'ONLINE_RAZORPAY'; paidDuring: 'PICKUP' },
  ) => api.post(`/api/employee/pickup/${bookingId}/initiate-remaining-payment`, body),
  initiateRemainingPaymentReturn: (
    bookingId: string,
    body: { method: 'CASH' | 'ONLINE_RAZORPAY'; paidDuring: 'RETURN' },
  ) => api.post(`/api/employee/return/${bookingId}/initiate-remaining-payment`, body),
  remainingPaymentStatus: (transactionId: string) =>
    api.get(`/api/employee/payment/remaining-status/${transactionId}`),

  // ── return: charge session lifecycle ──────────────────────────────────────
  deleteReturnImage: (publicId: string) =>
    api.delete(`/api/employee/return/image/${publicId}`),
  computeReturnSession: (
    bookingId: string,
    body: {
      endOdometer: number;
      returnFuelLevel?: string;
      extraKmCharge?: number;
      fuelCharge?: number;
      fastagAmount?: number;
      fastagNotes?: string;
      otherCharges?: { label: string; amount: number }[];
      returnImageIds?: string[];
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/return/session/compute`, body),
  getReturnSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/return/session`),
  recordSessionPayment: (
    sessionPublicId: string,
    body: {
      method: 'CASH' | 'ONLINE';
      amount: number;
      idempotencyKey: string;
      notes?: string;
      onlineTransactionRef?: string;
      onlineGateway?: string;
    },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-payment`, body),
  recordSessionRefund: (
    sessionPublicId: string,
    body: {
      method: 'CASH' | 'ONLINE';
      amount: number;
      idempotencyKey: string;
      notes?: string;
    },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-refund`, body),

  // ── walk-in customer creation (phone OTP + profile) ───────────────────────
  walkinInitiate: (phone: string) =>
    api.post('/api/employee/walkin/initiate', { phone }),
  walkinVerify: (customerPublicId: string, otp: string) =>
    api.post('/api/employee/walkin/verify', { customer_public_id: customerPublicId, otp }),
  walkinComplete: (body: {
    customer_public_id: string;
    name: string;
    email: string;
    addressLine1: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    dob?: string;
    alternatePhone?: string;
  }) => api.post('/api/employee/walkin/complete', body),

  // ── walk-in KYC ───────────────────────────────────────────────────────────
  walkinKycList: (customerPublicId: string) =>
    api.get(`/api/employee/walkin/kyc/${customerPublicId}`),
  walkinKycUpload: (formData: FormData) =>
    api.post('/api/employee/walkin/kyc/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  walkinKycDelete: (id: string) =>
    api.delete('/api/employee/walkin/kyc', { data: { id } }),

  // ── walk-in vehicle selection ─────────────────────────────────────────────
  vehicleCategories: () => api.get('/api/employee/vehicles/categories'),
  searchVehicles: (params?: {
    search?: string;
    category?: string;
    sort?: 'price_low_to_high' | 'price_high_to_low';
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  }) => api.get('/api/employee/vehicles/search', { params }),
  vehicleGroupDetail: (groupKey: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/employee/vehicles/group/${encodeURIComponent(groupKey)}`, { params }),
  vehicleDetail: (id: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/employee/vehicles/${id}`, { params }),

  // ── walk-in booking create / hold / pay ───────────────────────────────────
  createBooking: (body: {
    vehicles?: string[];
    group_key?: string;
    customer_public_id: string;
    customer_kyc_id: string;
    start: string;
    end: string;
    payment_type: 'CASH' | 'ONLINE';
  }) => api.post('/api/employee/booking/create', body),
  cancelBookingHold: (holdId: string) =>
    api.delete(`/api/employee/booking/hold/${holdId}`),
  bookingPaymentStatus: (transactionId: string) =>
    api.get(`/api/employee/booking/payment-status/${transactionId}`),

  // ── pickup pre-delivery photos ────────────────────────────────────────────
  pickupCaptureConfig: (bookingId: string) =>
    api.get(`/api/employee/pickup/${bookingId}/capture-config`),

  // ── damage reporting (return) ─────────────────────────────────────────────
  uploadDamageImage: (formData: FormData) =>
    api.post('/api/employee/damage/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  reportDamage: (body: {
    bookingId: string;
    odo: number;
    fuelLevel: number; // 0..100 percent
    severity: string; // 'Minor' | 'Moderate' | 'Severe'
    chargeType: 'PENALTY' | 'COMPENSATION';
    damageImageIds: string[];
    returnImageIds: string[];
    notes?: Record<string, unknown>;
  }) => api.post('/api/employee/damage/report', body),

  // ── vehicle swap at pickup (#51) ──────────────────────────────────────────
  // bookingId = booking publicId. AvailableVehicle.id is the NUMERIC vehicle id.
  getAvailableVehicles: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/available-vehicles`),
  swapVehicle: (
    bookingId: string,
    body: {
      newVehicleId: number; // NUMERIC vehicle id from available-vehicles list
      reason: 'CUSTOMER_REQUEST' | 'MAINTENANCE' | 'UPGRADE' | 'DOWNGRADE' | 'DAMAGE' | 'OTHER';
      reasonNotes?: string;
      markOriginalForMaintenance?: boolean;
      originalVehicleNotes?: string; // required when markOriginalForMaintenance
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/swap-vehicle`, body),

  // ── counter discount (coupon + manual) (#52) — money fields are STRINGS ────
  getDiscountSummary: (bookingId: string) =>
    api.get(`/api/employee/discount/bookings/${bookingId}/discount-summary`),
  applyDiscountCoupon: (bookingId: string, couponCode: string) =>
    api.post(`/api/employee/discount/bookings/${bookingId}/apply-coupon`, { couponCode }),
  removeDiscountCoupon: (bookingId: string) =>
    api.delete(`/api/employee/discount/bookings/${bookingId}/apply-coupon`),
  applyManualDiscount: (bookingId: string, body: { amount: number; reason: string }) =>
    api.post(`/api/employee/discount/bookings/${bookingId}/manual-discount`, body),

  // ── booking extension at counter (#53) — newEndAt MUST be ISO-8601 UTC 'Z' ─
  evaluateExtension: (body: { bookingPublicId: string; newEndAt: string; notes?: string }) =>
    api.post('/api/employee/extensions/evaluate', body),
  commitExtension: (body: {
    extensionPublicId: string;
    resolutionType: 'SAME_VEHICLE' | 'SWAP_CURRENT_TO_OTHER' | 'SWAP_FUTURE_BOOKING' | 'PARTIAL_EXTENSION';
    idempotencyKey: string;
    notes?: string;
  }) => api.post('/api/employee/extensions/commit', body),
  collectExtension: (
    extensionPublicId: string,
    body: { method: 'CASH' | 'ONLINE'; onlineTransactionRef?: string },
  ) => api.post(`/api/employee/extensions/${extensionPublicId}/collect`, body),

  // ── counter payment panel (financial state + ledger + record) ─────────────
  financialState: (bookingPublicId: string) =>
    api.get(`/api/employee/payment/bookings/${bookingPublicId}/financial-state`),
  bookingTransactions: (bookingPublicId: string) =>
    api.get(`/api/employee/payment/bookings/${bookingPublicId}/transactions`),
  recordPayment: (body: {
    bookingPublicId: string;
    purpose:
      | 'ADVANCE'
      | 'REMAINING_BALANCE'
      | 'FULL_PAYMENT'
      | 'EXTENSION'
      | 'DAMAGE_FEE'
      | 'SAFETY_DEPOSIT'
      | 'OVERPAYMENT_REFUND'
      | 'CANCELLATION_REFUND';
    method: 'CASH' | 'ONLINE' | 'SPLIT';
    totalAmount: number;
    cashAmount?: number;
    onlineAmount?: number;
    onlineTransactionRef?: string;
    onlineGateway?: string;
    idempotencyKey: string;
    notes?: string;
  }) => api.post('/api/employee/payment/transactions', body),
};
