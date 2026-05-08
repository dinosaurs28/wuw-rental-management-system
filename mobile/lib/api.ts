import axios from 'axios';
import { useAuthStore } from '../store/auth';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000') as string;

if (__DEV__) {
  console.log('[api] BASE_URL =', BASE_URL);
}

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
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
  async (err) => {
    const cfg = err.config ?? {};
    const isNetworkError = !err.response;

    if (__DEV__ && isNetworkError) {
      console.log(
        '[api] network error',
        cfg.method?.toUpperCase(),
        (cfg.baseURL ?? '') + (cfg.url ?? ''),
        '| code:', err.code,
        '| message:', err.message,
      );
    }

    // One automatic retry on network errors (transient cellular drops, DNS
    // blips, TLS resumption hiccups). Never retry HTTP error responses —
    // those are real and meaningful.
    if (isNetworkError && !cfg.__retried) {
      cfg.__retried = true;
      await new Promise((r) => setTimeout(r, 1000));
      return api.request(cfg);
    }

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
};

// ─── auth ─────────────────────────────────────────────────────────────────

export const authApi = {
  signIn: (email: string, password: string) =>
    api.post('/api/auth/email/signin', { email, password }),
  signUp: (name: string, email: string, password: string) =>
    api.post('/api/auth/email/signup', { name, email, password }),
  // Mobile Google sign-in: client obtains an idToken via expo-auth-session,
  // backend verifies and returns a JWT in the response body.
  googleSignIn: (idToken: string) =>
    api.post('/api/auth/google/mobile', { idToken }),
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
  // Customer-side hold cancellation (different from employeeApi.cancelEmployeeHold).
  cancelHold: (holdId: string) =>
    api.delete(`/api/user/booking/hold/${holdId}`),
  // Customer-side payment status polling (thin wrapper over the public endpoint).
  // Returns { status: 'Success' | 'Pending' | 'Failed', message?: string }
  verifyPayment: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),
};

// ─── discount ─────────────────────────────────────────────────────────────

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
    pickupImageIds?: string[];
    requireManagerConfirmation?: boolean;
  }) => api.post(`/api/employee/pickup/${bookingId}`, body),
  // Pickup-flow: capture-config & session
  getPickupCaptureConfig: (bookingId: string) =>
    api.get(`/api/employee/pickup/${bookingId}/capture-config`),
  initiatePickupSession: (bookingId: string, body: {
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
  }) => api.post(`/api/employee/bookings/${bookingId}/pickup-session/initiate`, body),
  getActivePickupSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/pickup-session`),
  addDepositToPickupSession: (bookingId: string, body: { amount: number; reason: string }) =>
    api.post(`/api/employee/bookings/${bookingId}/pickup-session/add-deposit`, body),
  removeDepositFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-deposit`),
  applyDiscountToPickupSession: (bookingId: string, body: { discountCode: string }) =>
    api.post(`/api/employee/bookings/${bookingId}/pickup-session/apply-discount`, body),
  removeDiscountFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-discount`),
  getReturnDetails: (bookingId: string) =>
    api.get(`/api/employee/return/${bookingId}`),
  uploadReturnImage: (formData: FormData) =>
    api.post('/api/employee/return/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  completeReturn: (bookingId: string, body?: {
    returnImageIds?: string[];
    requireManagerConfirmation?: boolean;
  }) => api.post(`/api/employee/return/${bookingId}/complete`, body ?? {}),
  // Return-flow: pickup-time reference photos (shown read-only at return)
  getPickupCaptures: (bookingId: string) =>
    api.get(`/api/employee/return/${bookingId}/pickup-captures`),
  // Return-flow: payment session (modern flow)
  getReturnSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/return/session`),
  computeReturnSession: (bookingId: string, body: {
    endOdometer: number;
    returnFuelLevel?: string;
    extraKmCharge?: number;
    fuelCharge?: number;
    fastagAmount?: number;
    fastagNotes?: string;
    otherCharges?: { label: string; amount: number }[];
    returnImageIds?: string[];
  }) => api.post(`/api/employee/bookings/${bookingId}/return/session/compute`, body),
  // Return-flow: payment / refund recording
  recordPayment: (sessionPublicId: string, body: {
    method: 'CASH' | 'ONLINE';
    amount: number;
    idempotencyKey: string;
    notes?: string;
    onlineTransactionRef?: string;
    onlineGateway?: string;
  }) => api.post(`/api/employee/sessions/${sessionPublicId}/record-payment`, body),
  recordRefund: (sessionPublicId: string, body: {
    method: 'CASH' | 'ONLINE';
    amount: number;
    idempotencyKey: string;
    notes?: string;
  }) => api.post(`/api/employee/sessions/${sessionPublicId}/record-refund`, body),
  // Return-flow: damage report
  uploadDamageImage: (formData: FormData) =>
    api.post('/api/employee/damage/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  reportDamage: (body: {
    bookingId: string;
    odo: number;
    fuelLevel: number;
    severity: string;
    damageImageIds: string[];
    notes: Record<string, any>;
    returnImageIds: string[];
  }) => api.post('/api/employee/damage/report', body),
  getBookingKyc: (bookingId: string) =>
    api.get(`/api/employee/kyc/${bookingId}`),
  verifyKyc: (kycId: string, status: 'APPROVED' | 'REJECTED') =>
    api.patch(`/api/employee/kyc/${kycId}/status`, { status }),

  // ── walk-in customer onboarding ──────────────────────────────────────────
  walkinInitiate: (body: { phone: string }) =>
    api.post('/api/employee/walkin/initiate', body),
  walkinVerify: (body: { customer_public_id: string; otp: string }) =>
    api.post('/api/employee/walkin/verify', body),
  walkinComplete: (body: {
    customer_public_id: string;
    name: string;
    email: string;
    dob?: string;
    addressLine1: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
    alternatePhone?: string;
    gender?: string;
  }) => api.post('/api/employee/walkin/complete', body),
  uploadWalkinKyc: (formData: FormData) =>
    api.post('/api/employee/walkin/kyc/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteWalkinKyc: (publicId: string, customerPublicId: string) =>
    api.delete('/api/employee/walkin/kyc', {
      data: { id: publicId, customer_public_id: customerPublicId },
    }),
  getCustomerKyc: (customerPublicId: string) =>
    api.get(`/api/employee/walkin/kyc/${customerPublicId}`),
  verifyWalkinKyc: (kycPublicId: string, status: 'APPROVED' | 'REJECTED') =>
    api.post('/api/employee/walkin/kyc/status', { fileId: kycPublicId, status }),

  // ── booking-creation flow ────────────────────────────────────────────────
  listEmployeeVehicles: (params?: {
    search?: string;
    category?: string;
    sort?: 'price_low_to_high' | 'price_high_to_low';
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  }) => api.get('/api/employee/vehicles/search', { params }),
  getEmployeeVehicle: (id: string, params?: { start?: string; end?: string }) =>
    api.get(`/api/employee/vehicles/${id}`, { params }),
  getEmployeeVehicleGroup: (
    groupKey: string,
    params?: { start?: string; end?: string },
  ) =>
    api.get(`/api/employee/vehicles/group/${encodeURIComponent(groupKey)}`, {
      params,
    }),
  getEmployeeVehicleCategories: () =>
    api.get('/api/employee/vehicles/categories'),
  createEmployeeBooking: (body: {
    vehicles?: string[];
    group_key?: string;
    customer_public_id: string;
    customer_kyc_id: string;
    start: string;
    end: string;
    payment_type: 'CASH' | 'ONLINE';
  }) => api.post('/api/employee/booking/create', body),
  cancelEmployeeHold: (holdId: string) =>
    api.delete(`/api/employee/booking/hold/${holdId}`),
  verifyOnlinePayment: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),

  // ── remaining-payment status polling ─────────────────────────────────────
  verifyRemainingPayment: (transactionId: string) =>
    api.get(`/api/employee/payment/remaining-status/${transactionId}`),
};
