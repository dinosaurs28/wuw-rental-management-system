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
};
