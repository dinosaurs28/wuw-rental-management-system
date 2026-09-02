import axios from 'axios';
import { useAuthStore } from '../store/auth';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Set by the request interceptor: did this request go out with a Bearer token? */
    wuwAuthenticated?: boolean;
  }
  interface AxiosRequestConfig {
    wuwAuthenticated?: boolean;
  }
}

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;

// Photo uploads run far longer than a JSON round-trip on mobile data, so they
// opt out of the 15s default below rather than aborting mid-transfer.
export const UPLOAD_TIMEOUT_MS = 60_000;

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
  // Record whether this request carried a session, so the 401 handler below can
  // tell an expired session apart from a guest touching something protected.
  config.wuwAuthenticated = !!token;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only a request that actually sent a token can have had its session
    // expire. Guests browse public endpoints without one, and a stray 401 from
    // such a request must not clear state — that would bounce them out of a
    // perfectly public screen.
    if (err.response?.status === 401 && err.config?.wuwAuthenticated) {
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
  // Self-service password reset (email OTP). forgotPassword always resolves 200
  // with a generic message (no account-existence leak); resetPassword returns
  // 400 "Invalid or expired reset code." for any bad email/OTP/expiry.
  forgotPassword: (email: string) =>
    api.post('/api/auth/email/forgot-password', { email }),
  resetPassword: (email: string, otp: string, password: string) =>
    api.post('/api/auth/email/reset-password', { email, otp, password }),
};

// ─── razorpay ─────────────────────────────────────────────────────────────

// Order descriptor returned by every initiation endpoint (customer checkout,
// employee create-booking, employee remaining-payment). It is NULL/absent on
// the cash branches, so always guard on its presence rather than on the
// payment method the screen sent.
export interface RazorpayOrder {
  orderId: string;
  keyId: string;
  /** Smallest currency unit (paise). */
  amount: number;
  amountInRupees?: number;
  currency: string;
}

export interface RazorpayVerifyPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

// The backend mounts the SAME verify handler three times, each behind a
// different role gate, because no combined gate exists: authCheckJwt is
// CUSTOMER-only and 403s any other role. So the path is chosen by the role of
// the session making the call, not by which screen is calling.
//   /api/payment/verify         customer   (authCheckJwt)
//   /api/payment/staff/verify   STAFF      (EmployeeCheck)
//   /api/payment/manager/verify MANAGER    (ManagerCheck) — no mobile surface
// 'STAFF' is the only role this app branches on (app/_layout.tsx, app/index.tsx
// route the employee stack off it), so anything else — including the '' the
// auth store falls back to when /me omits a role — takes the customer path,
// which is what every non-staff session should use anyway.
export function paymentVerifyPath(): string {
  const role = useAuthStore.getState().user?.role;
  return role === 'STAFF' ? '/api/payment/staff/verify' : '/api/payment/verify';
}

// Called with the Checkout handler payload the moment RazorpayCheckout resolves.
// 400 => bad signature. Idempotent server-side (the webhook may also fire), and
// the status poll stays the fallback for when this never lands (app
// backgrounded, late webhook, etc.).
export const verifyRazorpaySignature = (payload: RazorpayVerifyPayload) =>
  api.post(paymentVerifyPath(), payload);

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
      timeout: UPLOAD_TIMEOUT_MS,
    }),
  deleteKyc: (publicId: string, customerPublicId: string) =>
    api.delete('/api/user/kyc', { data: { id: publicId, customer_public_id: customerPublicId } }),
  cancelHold: (holdId: string) =>
    api.delete(`/api/user/booking/hold/${holdId}`),

  // Permanent account deletion. `password` is omitted for Google-linked
  // accounts (they have no password). 409 => an active booking blocks it.
  deleteAccount: (confirmText: string, password?: string) =>
    api.delete('/api/user/account', { data: { confirmText, password } }),
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
  // Customer-side payment status polling (thin wrapper over the public endpoint).
  verifyPayment: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),
  // Razorpay signature verification — see verifyRazorpaySignature below.
  verifyRazorpaySignature,
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
      timeout: UPLOAD_TIMEOUT_MS,
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
      timeout: UPLOAD_TIMEOUT_MS,
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
      timeout: UPLOAD_TIMEOUT_MS,
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
      timeout: UPLOAD_TIMEOUT_MS,
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
  // ── staging-era aliases ───────────────────────────────────────────────────
  // Screens carried over from staging call these endpoints by different names.
  // Aliasing is less invasive than renaming call sites in screens this merge
  // is not otherwise touching.
  listEmployeeVehicles: (params?: {
    branch?: string;
    category?: string;
    sort?: string;
    start?: string;
    end?: string;
    limit?: number;
  }) => api.get('/api/employee/vehicles', { params }),
  getEmployeeVehicle: (id: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/employee/vehicles/${id}`, { params }),
  getEmployeeVehicleGroup: (groupKey: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/employee/vehicles/group/${encodeURIComponent(groupKey)}`, { params }),
  getEmployeeVehicleCategories: () => api.get('/api/employee/vehicles/categories'),
  createEmployeeBooking: (body: Record<string, unknown>) =>
    api.post('/api/employee/booking/create', body),
  cancelEmployeeHold: (holdId: string) =>
    api.delete(`/api/employee/booking/hold/${holdId}`),
  verifyRemainingPayment: (transactionId: string) =>
    api.get(`/api/employee/payment/remaining-status/${transactionId}`),
  verifyOnlinePayment: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),
  uploadWalkinKyc: (formData: FormData) =>
    api.post('/api/employee/walkin/kyc/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    }),
  getCustomerKyc: (customerPublicId: string) =>
    api.get(`/api/employee/walkin/kyc/${customerPublicId}`),
  deleteWalkinKyc: (publicId: string, customerPublicId: string) =>
    api.delete('/api/employee/walkin/kyc', {
      data: { id: publicId, customer_public_id: customerPublicId },
    }),
  verifyWalkinKyc: (kycPublicId: string, status: 'APPROVED' | 'REJECTED') =>
    api.post('/api/employee/walkin/kyc/status', { fileId: kycPublicId, status }),

  // ── pickup payment session (staging feature; its backend routes merged in) ─
  initiatePickupSession: (
    bookingId: string,
    body: {
      overrideRemainingBalance?: number;
      safetyDepositAmount?: number;
      safetyDepositReason?: string;
      extensionPublicId?: string;
      discountCode?: string;
      odo?: number;
      fuelLevel?: number;
      pickupFuelLevel?: 'EMPTY' | 'QUARTER' | 'HALF' | 'THREE_QUARTER' | 'FULL';
      pickupImageIds?: string[];
      captureImages?: { fileId: string; label: string }[];
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/pickup-session/initiate`, body),
  getActivePickupSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/pickup-session`),
  getPickupCaptureConfig: (bookingId: string) =>
    api.get(`/api/employee/pickup/${bookingId}/capture-config`),
  addDepositToPickupSession: (bookingId: string, body: { amount: number; reason: string }) =>
    api.post(`/api/employee/bookings/${bookingId}/pickup-session/add-deposit`, body),
  removeDepositFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-deposit`),
  applyDiscountToPickupSession: (bookingId: string, body: { discountCode: string }) =>
    api.post(`/api/employee/bookings/${bookingId}/pickup-session/apply-discount`, body),
  removeDiscountFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-discount`),
  recordRefund: (
    sessionPublicId: string,
    body: { method: 'CASH' | 'ONLINE'; amount: number; idempotencyKey: string; notes?: string },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-refund`, body),
};

// ─── discount ───────────────────────────────────────────────────────────────

export interface CouponValidateBody {
  couponCode: string;
  vehiclePublicId?: string;
  groupKey?: string;
  startAt: string;
  endAt: string;
}

export interface CouponValidateValid {
  valid: true;
  couponCode: string;
  discountAmount: string;
  discountType?: string;
  discountValue?: string;
}

export interface CouponValidateInvalid {
  valid: false;
  code: string;
  reason: string;
}

export type CouponValidateResult = CouponValidateValid | CouponValidateInvalid;

export const discountApi = {
  validateCoupon: (body: CouponValidateBody) =>
    api.post<{ data: CouponValidateResult }>('/api/public/discount/validate', body),
};
