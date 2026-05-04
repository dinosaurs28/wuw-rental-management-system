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
    if (err.response?.status === 401 || err.response?.status === 403) {
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
};
