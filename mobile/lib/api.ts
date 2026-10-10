import axios from 'axios';
import { useAuthStore } from '../store/auth';
import type { DropDamageInput } from '../types/return';
import type { AppNotification, NotificationAudience, NotificationPage } from '../types/notifications';
import type { MyShiftsParams } from '../types/shift';
import type { DlCollectionStatus, UpdateDlStatusBody } from './dlStatus';
import type { ExtensionGstFields, RentInclGstFields } from './gst';
import type { ExtensionFreeKm } from '../types/api';
import type { PaymentFlow, PaymentOptions } from '../types/api';
import type { RescheduleOptions, RescheduleResult } from '../types/api';
import type { PublicOffersResponse } from '../types/offers';
import type { UpiQrTarget, UpiQrView } from '../types/upiQr';
import type { CounterRefundMethod, PaymentProof, SafetyDepositHandling } from './counterPayment';
import type {
  OperationDraft,
  OperationDraftKind,
  OperationDraftMeta,
  OperationDraftType,
  PausedOperation,
  SaveOperationDraftBody,
} from './operationDraft';
import type {
  BlacklistResult,
  CustomerBookingDetail,
  CustomerDetail,
  CustomerFilter,
  CustomerListResponse,
  RentBucket,
  RentsPage,
} from '../types/customers';

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
  // Comma list of trip-type tags (HIGHWAY,HILL_STATION,LONG_DRIVE); OR match.
  useCases?: string;
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
  // Office hours (#2), no auth: { schedules: [{ dayOfWeek, isOpen, openTime, closeTime }],
  // graceMinutes, is24Hours } at the top level; newer servers add defaultHours,
  // pickupCutoffMinutes and effectiveSchedules. is24Hours = open 24/7; a day
  // without a row = default 8 AM – 11 PM (lib/branchSchedule.ts).
  branchSchedule: (branchPublicId: string) =>
    api.get(`/api/public/branch/${encodeURIComponent(branchPublicId)}/schedule`),
  // Coupon preview (stateless): { data: CouponValidateResult }, HTTP 200 for a
  // valid or invalid code (409 GST_RULE_MISSING). Signed-in customers go through
  // the authenticated endpoint so per-customer coupons work — see couponValidatePath.
  validateCoupon: (body: CouponValidateBody) =>
    api.post<{ data: CouponValidateResult }>(couponValidatePath(), body),
  // Customer booking summary + payment initiation (creates a 10-min HOLD).
  createBooking: (body: {
    vehicles: string[];
    groupKeys: string[];
    start: string;
    end: string;
    // X2: optional — the KYC document the customer chose to attach, if any.
    file_public_id?: string;
    payment_type: 'CASH' | 'ONLINE';
    payment_flow: 'FULL' | 'ADVANCE';
    couponCode?: string;
  }) => api.post('/api/public/vehicles/booking', body),
};

// ─── offer posters (#15) ────────────────────────────────────────────────────

export const offersApi = {
  // No auth. Live posters for the home hero: with `branch`, that branch's plus
  // global ones. { data: [] } (or any error) → show the static hero.
  list: (branchPublicId?: string | null) =>
    api.get<PublicOffersResponse>('/api/public/offers', {
      params: branchPublicId ? { branch: branchPublicId } : undefined,
    }),
};

// ─── payment / config ───────────────────────────────────────────────────────

export const paymentApi = {
  // Customer online payment status: { status: 'Success' | 'Pending' | 'Failed' }
  status: (transactionId: string) =>
    api.get(`/api/payment/status/${transactionId}`),
};

// UPI QR scanned from another phone (item 2) — customer only. Pays the order
// the booking / extension already has. Errors: { success:false, code, message }.
export const upiQrApi = {
  // { data: { enabled } } — false: don't offer the QR (ops switch / no keys).
  availability: () =>
    api.get<{ success: boolean; data: { enabled: boolean } }>('/api/payment/upi-qr/availability'),
  // 201 a new QR, 200 the still-open one (reused: true). 409 BOOKING_ALREADY_PAID /
  // EXTENSION_ALREADY_PAID → already paid; 409 HOLD_EXPIRED → start again.
  create: (target: UpiQrTarget) =>
    api.post<{ success: boolean; data: UpiQrView }>('/api/payment/upi-qr', target),
  // Poll every 3 s — confirms the booking / extension as soon as the payment lands.
  status: (qrPaymentId: string) =>
    api.get<{ success: boolean; data: UpiQrView }>(`/api/payment/upi-qr/${qrPaymentId}`),
  // Stops the QR taking money (left the screen / paying another way). A payment
  // that already landed is settled and comes back as CONFIRMED.
  close: (qrPaymentId: string) =>
    api.post<{ success: boolean; data: UpiQrView }>(`/api/payment/upi-qr/${qrPaymentId}/close`, {}),
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
  // SMS-code reset (default path). identifier = mobile number or email; the code
  // always goes by SMS to the phone on the account. Request is always a generic 200.
  passwordResetChannels: () => api.get('/api/auth/password-reset/channels'),
  smsForgotPassword: (identifier: string) =>
    api.post('/api/auth/sms/forgot-password', { identifier }),
  smsResetPassword: (identifier: string, otp: string, password: string) =>
    api.post('/api/auth/sms/reset-password', { identifier, otp, password }),
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

// ─── customer trip extension ────────────────────────────────────────────────
// Money fields are decimal STRINGS. newEndAt must be ISO-8601 UTC (toISOString()).

export type CustomerExtensionResolution = 'SAME_VEHICLE' | 'PARTIAL_EXTENSION' | 'NO_RESOLUTION';

export interface CustomerExtensionQuote {
  extensionPublicId: string;
  bookingPublicId: string;
  oldEndAt: string;
  /** Already narrowed to the partial end when only a partial extension fits. */
  requestedEndAt: string;
  pricing: {
    originalDays: number;
    newDays: number;
    originalTotalFinal: string;
    additionalAmount: string;
    newTotalFinal: string;
    /** Rental length before the extension / hours this quote adds (numbers). */
    originalHours?: number;
    extensionHours?: number;
    /** Free km this quote adds (#7) — none for an extension under 12 h. */
    extensionFreeKm?: ExtensionFreeKm | null;
  } & ExtensionGstFields; // GST split of additionalAmount (= taxableAmount + taxAmount)
  resolutionOptions: { type: CustomerExtensionResolution; description: string; partialNewEndAt?: string }[];
}

export const extensionApi = {
  // { data: ExtensionEligibility } (types/api.ts) — the 15-day cap (maxEndAt,
  // atCap) and the branch's officeHours ride along; early returns omit them.
  eligibility: (bookingPublicId: string) =>
    api.get(`/api/user/bookings/${bookingPublicId}/extension-eligibility`),
  // { data: CustomerExtensionQuote }. NO_RESOLUTION quotes are already released
  // server-side. 409 { code: 'EXTENSION_PENDING', pendingExtensionPublicId,
  // pendingExtensionStatus } while another extension is open.
  evaluate: (bookingPublicId: string, body: { newEndAt: string; notes?: string }) =>
    api.post(`/api/user/bookings/${bookingPublicId}/extensions/evaluate`, body),
  // { data: { transactionId, razorpay: RazorpayOrder, amount } }, or when nothing
  // is due { data: { transactionId: null, razorpay: null, extensionStatus: 'CONFIRMED', newEndAt } }.
  // 409 when the vehicle is no longer free.
  initiatePayment: (extensionPublicId: string) =>
    api.post(`/api/user/extensions/${extensionPublicId}/initiate-payment`),
  // Fallback after Checkout: { status: 'CONFIRMED' | 'PENDING' | 'FAILED', message, data?: { newEndAt } }.
  verifyPayment: (orderId: string) =>
    api.post(`/api/user/extensions/verify-payment/${orderId}`),
  // Releases an unpaid quote — otherwise the booking stays locked by it.
  cancel: (extensionPublicId: string) =>
    api.post(`/api/user/extensions/${extensionPublicId}/cancel`, {}),
};

// ─── employee ─────────────────────────────────────────────────────────────

export const employeeApi = {
  login: (email: string, password: string) =>
    api.post('/api/employee/auth/login', { email, password }),
  // Fleet Executive password reset (email 6-digit code, STAFF accounts only).
  forgotPassword: (email: string) =>
    api.post('/api/employee/auth/email/forgot-password', { email }),
  resetPassword: (email: string, otp: string, password: string) =>
    api.post('/api/employee/auth/email/reset-password', { email, otp, password }),
  // SMS-code reset (default path), STAFF accounts only.
  smsForgotPassword: (identifier: string) =>
    api.post('/api/employee/auth/sms/forgot-password', { identifier }),
  smsResetPassword: (identifier: string, otp: string, password: string) =>
    api.post('/api/employee/auth/sms/reset-password', { identifier, otp, password }),
  dashboardStats: () => api.get('/api/employee/dashboard/stats'),
  // { data: null | ActiveShift } (types/shift.ts).
  getActiveShift: () => api.get('/api/employee/payment/shifts/me/active'),
  // openingCash: the float counted into the drawer (0–10,00,000, 2 dp); omitted = 0.
  // 201 { data: { publicId, status, openedAt, openingCash } }; 409 SHIFT_ALREADY_OPEN,
  // 400 INVALID_OPENING_CASH.
  openShift: (body?: { openingCash: number }) => api.post('/api/employee/payment/shifts', body ?? {}),
  // 400 DISCREPANCY_EXPLANATION_REQUIRED carries the server's expectedClosing,
  // openingCash, cashCollected and cashRefunded when the count differs.
  closeShift: (publicId: string, body: { actualTotal: number; discrepancyExplanation?: string }) =>
    api.post(`/api/employee/payment/shifts/${publicId}/close`, body),
  // Own shift history across every branch (#22): MyShiftsResponse.
  getMyShifts: (params?: MyShiftsParams) => api.get('/api/employee/payment/shifts/me', { params }),
  // One own shift with its transactions: { data: ShiftDetail }; 404 SHIFT_NOT_FOUND.
  getMyShift: (publicId: string) => api.get(`/api/employee/payment/shifts/me/${publicId}`),
  // `type` splits the queue into Daily / Monthly tabs (#17): Monthly ignores
  // `date` and lists every monthly booking. With `type` an empty list is 200 [];
  // both add { type, counts: { daily, monthly } }.
  listPickups: (params?: { date?: string; type?: 'DAILY' | 'MONTHLY' }) =>
    api.get('/api/employee/booking', { params }),
  listReturns: (params?: { date?: string; type?: 'DAILY' | 'MONTHLY' }) =>
    api.get('/api/employee/return', { params }),
  // PICKED_UP bookings past their return time, most overdue first (#8). Always
  // 200 — OverdueReturnsResponse (types/queue.ts). limit defaults 50, max 200.
  listOverdueReturns: (params?: { page?: number; limit?: number; type?: 'DAILY' | 'MONTHLY' }) =>
    api.get('/api/employee/dashboard/overdue-returns', { params }),
  scanBooking: (bookingId: string) =>
    api.get(`/api/employee/booking/${bookingId}/scan`),
  searchCustomer: (query: string) =>
    api.get('/api/employee/customer/search', { params: { q: query } }),
  getCustomer: (publicId: string) =>
    api.get(`/api/employee/customer/${publicId}`),
  // Active bookings that block this customer for [start, end]:
  // { usedTypeClasses: { TWO_WHEELER?|FOUR_WHEELER?: { vehicleMake, vehicleModel, endAt, ... } },
  //   blockedAll?, anyVehicleConflict? } (blockedAll = branch allows one vehicle at a time).
  customerBookingLimits: (customerPublicId: string, params: { start: string; end: string }) =>
    api.get(`/api/employee/customer/${customerPublicId}/booking-limits`, { params }),
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
    // Original driving licence status (#3) — optional (X1): omitted / null leaves
    // it unset. DEPOSIT is no longer accepted (400 DL_STATUS_INVALID).
    dlStatus?: DlCollectionStatus | null;
    dlDepositNote?: string | null;
    // Deprecated alias kept for old builds (dlStatus wins). Never send false.
    licenseCollected?: boolean;
    // X2: the customer's DL number typed at the counter (saved to the customer).
    // Required when none is on file: 422 DL_NUMBER_REQUIRED, 400 INVALID_DL_NUMBER.
    drivingLicenceNumber?: string;
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
    // Legacy drop: extra km and late return are billed by the server and
    // collected by the branch manager (response: CompleteReturnResponse).
    endOdometer?: number;
    // only used when kmAllowance.manualExtraKmAllowed (swap without readings)
    manualExtraKm?: number;
    // MANUAL grace branches only
    applyGrace?: boolean;
    waiveLateCharge?: { reason: string } | null;
    // #6 — how the held safety deposit is settled (recorded for the branch
    // manager's settlement). Omitted = SET_OFF. Response adds `safetyDeposit`.
    safetyDepositHandling?: SafetyDepositHandling;
  }) => api.post(`/api/employee/return/${bookingId}/complete`, body ?? {}),

  // ── paused pickup / drop (client item 2) — lib/operationDraft.ts ─────────
  // { data: OperationDraft | null }; a draft whose booking moved on is dropped.
  getOperationDraft: (kind: OperationDraftKind, bookingId: string) =>
    api.get<{ data: OperationDraft | null }>(`/api/employee/${kind}/${bookingId}/draft`),
  // 409 DRAFT_CONFLICT (+ the current `draft`) when baseVersion is stale;
  // 409 DRAFT_NOT_ALLOWED once the booking is past that step.
  saveOperationDraft: (kind: OperationDraftKind, bookingId: string, body: SaveOperationDraftBody) =>
    api.put<{ data: OperationDraftMeta }>(`/api/employee/${kind}/${bookingId}/draft`, body),
  discardOperationDraft: (kind: OperationDraftKind, bookingId: string) =>
    api.delete(`/api/employee/${kind}/${bookingId}/draft`),
  // The branch's paused operations, newest first.
  listOperationDrafts: (params?: { type?: OperationDraftType }) =>
    api.get<{ data: PausedOperation[] }>('/api/employee/operation-drafts', { params }),
  getBookingKyc: (bookingId: string) =>
    api.get(`/api/employee/kyc/${bookingId}`),
  verifyKyc: (kycId: string, status: 'APPROVED' | 'REJECTED') =>
    api.patch(`/api/employee/kyc/${kycId}/status`, { status }),

  // ── remaining / advance balance collection (pickup + return) ──────────────
  initiateRemainingPaymentPickup: (
    bookingId: string,
    // UPI = counter UPI QR backed by `proof_file_id` (payment-screen photo, #3;
    // older builds sent a 12-digit `utr`) — settles like CASH. SPLIT = cashAmount
    // + onlineAmount (= the balance) + the photo. CREDIT = the balance stays owed
    // against `collateral` (#11) and the counter step counts as settled.
    body: RemainingPaymentBody & { paidDuring: 'PICKUP' },
  ) => api.post(`/api/employee/pickup/${bookingId}/initiate-remaining-payment`, body),
  initiateRemainingPaymentReturn: (
    bookingId: string,
    body: RemainingPaymentBody & { paidDuring: 'RETURN' },
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
      // extra-km charge is computed by the server from the plan's km allowance
      fuelCharge?: number;
      fastagAmount?: number;
      fastagNotes?: string;
      otherCharges?: { label: string; amount: number }[];
      returnImageIds?: string[];
      // re-applied on every compute — resend it on recomputes. Drop charges carry no GST (item 8).
      discount?: { amount: number; reason: string };
      // Late return: "Apply grace" (MANUAL grace branches only)
      applyGrace?: boolean;
      // Late return waiver — resend on every compute while it should stay
      waiveLateCharge?: { reason: string } | null;
      // only used when kmAllowance.manualExtraKmAllowed (swap without readings)
      manualExtraKm?: number | null;
      // #6 — safety deposit at drop; resend on every compute while it should stay.
      // Omitted = SET_OFF. data.deposit: DropDeposit (lib/counterPayment).
      safetyDepositHandling?: SafetyDepositHandling;
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/return/session/compute`, body),
  getReturnSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/return/session`),
  // damages recorded at drop (billed on the return session when charged)
  listDropDamages: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/return/damages`),
  addDropDamage: (bookingId: string, body: DropDamageInput) =>
    api.post(`/api/employee/bookings/${bookingId}/return/damages`, body),
  deleteDropDamage: (bookingId: string, damagePublicId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/return/damages/${damagePublicId}`),
  recordSessionPayment: (
    sessionPublicId: string,
    body: {
      // UPI ≡ ONLINE through the counter UPI gateway; CREDIT = stays owed (#11)
      method: 'CASH' | 'ONLINE' | 'SPLIT' | 'UPI' | 'CREDIT';
      amount: number;
      idempotencyKey: string;
      notes?: string;
      onlineTransactionRef?: string;
      onlineGateway?: string;
      // SPLIT only: the cash and online parts (must add up to amount)
      cashAmount?: number;
      onlineAmount?: number;
      // UPI / a split's UPI part: the payment-screen photo (#3)
      proof_file_id?: string;
      // CREDIT only: what was taken from the customer (3–300 chars)
      collateral?: string;
      // Drop bill with the deposit refunded in full (#6): how it's paid back.
      // Without it: 400 DEPOSIT_REFUND_METHOD_REQUIRED { depositRefundAmount }.
      depositRefund?: { method: CounterRefundMethod; proof_file_id?: string; notes?: string };
    },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-payment`, body),
  recordSessionRefund: (
    sessionPublicId: string,
    body: {
      // UPI = ONLINE paid back by UPI, optionally with a photo of the transfer
      method: 'CASH' | 'ONLINE' | 'UPI';
      amount: number;
      idempotencyKey: string;
      notes?: string;
      proof_file_id?: string;
    },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-refund`, body),

  // ── walk-in customer creation (phone OTP + profile) ───────────────────────
  walkinInitiate: (phone: string) =>
    api.post('/api/employee/walkin/initiate', { phone }),
  walkinVerify: (customerPublicId: string, otp: string) =>
    api.post('/api/employee/walkin/verify', { customer_public_id: customerPublicId, otp }),
  // Also completes an EXISTING customer's profile (complete mode). Omit `email`
  // when blank — the server keeps the stored one. 200 adds
  // { customer_public_id, isProfileCompleted, missingFields, hasEmail }.
  walkinComplete: (body: {
    customer_public_id: string;
    name: string;
    email?: string;
    /** Raw input is fine — normalised server-side. */
    drivingLicenceNumber: string;
    aadhaarNumber: string;
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
  // customer_public_id: the server checks the document belongs to this customer.
  walkinKycDelete: (id: string, customerPublicId: string) =>
    api.delete('/api/employee/walkin/kyc', { data: { id, customer_public_id: customerPublicId } }),

  // ── customer QR code photo (#4) — multipart field 'file', JPEG ≤10 MB ─────
  // Customer level: the customer's CURRENT photo (User.publicId).
  getCustomerQrPhoto: (customerPublicId: string) =>
    api.get(`/api/employee/customer/${customerPublicId}/qr-photo`),
  uploadCustomerQrPhoto: (customerPublicId: string, formData: FormData) =>
    api.post(`/api/employee/customer/${customerPublicId}/qr-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    }),
  deleteCustomerQrPhoto: (customerPublicId: string) =>
    api.delete(`/api/employee/customer/${customerPublicId}/qr-photo`),
  // Booking level (branch-scoped): the booking's snapshot, else the customer's
  // current photo. POST replaces both; 409 QR_PHOTO_FROZEN after pickup.
  getBookingQrPhoto: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/qr-photo`),
  uploadBookingQrPhoto: (bookingId: string, formData: FormData) =>
    api.post(`/api/employee/bookings/${bookingId}/qr-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    }),

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
  // Cars whose registration number contains q (spaces / hyphens ignored), one
  // row each, priced for the dates; unbookable ones come with the reason.
  searchVehiclesByRegNo: (params: { q: string; start: string; end: string }) =>
    api.get('/api/employee/vehicles/search-reg', { params }),

  // ── walk-in booking create / hold / pay ───────────────────────────────────
  createBooking: (body: {
    vehicles?: string[];
    group_key?: string;
    customer_public_id: string;
    // X2: optional — omitted when staff attach no KYC document.
    customer_kyc_id?: string;
    start: string;
    end: string;
    payment_type: 'CASH' | 'ONLINE' | 'UPI' | 'SPLIT' | 'CREDIT';
    /** Older builds' UPI proof — this app sends proof_file_id instead. */
    utr?: string;
    /** UPI / SPLIT: the payment-screen photo (#3); then confirmed via bookingPaymentStatus like CASH. */
    proof_file_id?: string;
    /** SPLIT: the cash part (> 0); upi_amount, when sent, must add up to the total (400 SPLIT_AMOUNT_MISMATCH { total }). */
    cash_amount?: number;
    upi_amount?: number;
    /** CREDIT: the collateral held (3–300 chars) — no payment is recorded (#11). */
    collateral?: string;
    /** QrPhoto.publicId of the customer's current QR code photo (409 QR_PHOTO_MISMATCH if replaced). */
    qr_photo_id?: string;
    /** Counter monthly plan (#15/#17): 30–180 days, pickup within 15 days. Omitted = STANDARD. */
    plan?: 'STANDARD' | 'MONTHLY';
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

  // ── vehicle swap at pickup (#51) and during the rental (#13) ──────────────
  // bookingId = booking publicId. AvailableVehicle.id is the NUMERIC vehicle id.
  // Shapes: types/vehicleSwap.ts (data = candidates, swapContext = stage/readings/pricing).
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
      // Mid-rental swap (#13): all four readings are required when the booking
      // is PICKED_UP (400 READINGS_REQUIRED); fuel is bars "1".."10".
      originalVehicleEndOdometer?: number;
      originalVehicleFuelLevel?: string;
      newVehicleStartOdometer?: number;
      newVehicleFuelLevel?: string;
      // Bill the price difference at drop (face value, no GST — item 8); omitted ⇒ server default for the reason.
      chargeDifference?: boolean;
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/swap-vehicle`, body),
  // This booking's swaps, newest first (VehicleSwapRecord[] in types/vehicleSwap).
  getBookingSwapHistory: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/swap-history`),

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
  // { data: ExtensionEligibility } (types/api.ts): how far the booking may run
  // (15 days, 180 for a monthly plan) and the branch's office hours. 404 when
  // the booking isn't in this branch.
  extensionEligibility: (bookingPublicId: string) =>
    api.get(`/api/employee/extensions/eligibility/${encodeURIComponent(bookingPublicId)}`),
  // 400 BRANCH_SCHEDULE_VIOLATION (end outside office hours) or
  // BOOKING_MAX_PERIOD_EXCEEDED { maxEndAt } — both carry a message.
  evaluateExtension:(body: { bookingPublicId: string; newEndAt: string; notes?: string }) =>
    api.post('/api/employee/extensions/evaluate', body),
  commitExtension: (body: {
    extensionPublicId: string;
    resolutionType: 'SAME_VEHICLE' | 'SWAP_CURRENT_TO_OTHER' | 'SWAP_FUTURE_BOOKING' | 'PARTIAL_EXTENSION';
    /** SWAP_CURRENT_TO_OTHER: the vehicle picked from availableVehicles. */
    selectedVehiclePublicId?: string;
    /** SWAP_FUTURE_BOOKING: the evaluation's affectedBookings, as proposed. */
    affectedBookingSwaps?: { bookingPublicId: string; newVehiclePublicId: string }[];
    /** PARTIAL_EXTENSION: the option's partialNewEndAt. */
    partialNewEndAt?: string;
    idempotencyKey: string;
    notes?: string;
    /** Collect now instead of deferring the charge to a pickup payment session. */
    collectNow?: boolean;
  }) => api.post('/api/employee/extensions/commit', body),
  // CASH / UPI / SPLIT → COLLECTED, awaiting the manager (data.payment "pending");
  // CREDIT → confirmed at once, the amount stays owed (data.credit). UPI is
  // backed by proof_file_id (older builds: ONLINE + 12-digit onlineTransactionRef).
  collectExtension: (
    extensionPublicId: string,
    body: {
      method: 'CASH' | 'ONLINE' | 'UPI' | 'SPLIT' | 'CREDIT';
      onlineTransactionRef?: string;
      proof_file_id?: string;
      // SPLIT: cash > 0 and UPI > 0, adding up to the extension amount
      cashAmount?: number;
      onlineAmount?: number;
      collateral?: string;
    },
  ) => api.post(`/api/employee/extensions/${extensionPublicId}/collect`, body),
  // Releases an unpaid (not CONFIRMED) extension and restores the old return time.
  cancelExtension: (extensionPublicId: string, reason?: string) =>
    api.post(`/api/employee/extensions/${extensionPublicId}/cancel`, reason ? { reason } : {}),

  // ── reschedule a CONFIRMED booking (BRIEF4 P4c) — own branch only ──────────
  // { success, data: RescheduleOptions } (types/api.ts): whether it can move
  // (reschedulable + code/reason), its fixed length, the pickup range, office
  // hours and what is in the way. 404 BOOKING_NOT_FOUND for another branch.
  rescheduleOptions: (bookingPublicId: string) =>
    api.get<{ success: boolean; data: RescheduleOptions }>(
      `/api/employee/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
    ),
  // newStartAt: IST "YYYY-MM-DDTHH:mm"; the return moves by the same amount,
  // the price doesn't change. 200 { message, data: RescheduleResult }; 4xx
  // { code, message } — VALIDATION_ERROR, BOOKING_NOT_RESCHEDULABLE,
  // PICKUP_PENDING_CONFIRMATION, PAYMENT_SESSION_OPEN, PAYMENT_IN_PROGRESS,
  // EXTENSION_PENDING, RESCHEDULE_NO_CHANGE, RESCHEDULE_IN_PAST,
  // BOOKING_MAX_PERIOD_EXCEEDED, BRANCH_SCHEDULE_VIOLATION, DL_IN_USE,
  // VEHICLE_TYPE_LIMIT_EXCEEDED, VEHICLE_UNAVAILABLE, RESCHEDULE_BUSY, RESCHEDULE_CONFLICT.
  rescheduleBooking: (bookingPublicId: string, body: { newStartAt: string; reason?: string }) =>
    api.post<{ success: boolean; message: string; data: RescheduleResult }>(
      `/api/employee/bookings/${encodeURIComponent(bookingPublicId)}/reschedule`,
      body,
    ),

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
      // percent, 0..100
      fuelLevel?: number;
      // "1".."10" bars; used when the branch fuel module is enabled
      pickupFuelLevel?: string;
      pickupImageIds?: string[];
      captureImages?: { fileId: string; label: string }[];
      // Original driving licence status (#3), optional (X1); re-initiating applies a changed choice.
      dlStatus?: DlCollectionStatus | null;
      dlDepositNote?: string | null;
      // Deprecated alias kept for old builds (dlStatus wins). Never send false.
      licenseCollected?: boolean;
      // X2: DL number typed at the counter — same rules as completePickup.
      drivingLicenceNumber?: string;
    },
  ) => api.post(`/api/employee/bookings/${bookingId}/pickup-session/initiate`, body),
  // Fleet changes the original-licence status (#3) — CONFIRMED / PICKED_UP only
  // (409 DL_STATUS_LOCKED otherwise). 200 { message, data: UpdateDlStatusResult }.
  updateDlStatus: (publicId: string, body: UpdateDlStatusBody) =>
    api.patch(`/api/employee/bookings/${publicId}/dl-status`, body),
  getActivePickupSession: (bookingId: string) =>
    api.get(`/api/employee/bookings/${bookingId}/pickup-session`),
  getPickupCaptureConfig: (bookingId: string) =>
    api.get(`/api/employee/pickup/${bookingId}/capture-config`),
  addDepositToPickupSession: (bookingId: string, body: { amount: number; reason: string }) =>
    api.post(`/api/employee/bookings/${bookingId}/pickup-session/add-deposit`, body),
  removeDepositFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-deposit`),
  // 200 adds `coupon: CounterCouponQuote`. Refusals carry couponRejected: true —
  // 409 COUPON_ALREADY_APPLIED / COUPON_STACKING_NOT_ALLOWED, 422 COUPON_NOTHING_TO_DISCOUNT
  // or any coupon failure code; always show the server's message.
  applyDiscountToPickupSession: (bookingId: string, body: { discountCode: string }) =>
    api.post<{ message: string; data: unknown; coupon?: CounterCouponQuote }>(
      `/api/employee/bookings/${bookingId}/pickup-session/apply-discount`,
      body,
    ),
  removeDiscountFromPickupSession: (bookingId: string) =>
    api.delete(`/api/employee/bookings/${bookingId}/pickup-session/remove-discount`),
  recordRefund: (
    sessionPublicId: string,
    body: { method: 'CASH' | 'ONLINE' | 'UPI'; amount: number; idempotencyKey: string; notes?: string; proof_file_id?: string },
  ) => api.post(`/api/employee/sessions/${sessionPublicId}/record-refund`, body),

  // ── UPI payment-proof photo (#3) — multipart field 'file', image ≤10 MB ────
  // 201 { data: PaymentProof } (lib/counterPayment); send data.proofFileId as
  // proof_file_id. 400 FILE_REQUIRED / INVALID_FILE_TYPE / INVALID_IMAGE /
  // IMAGE_TOO_SMALL, 413 FILE_TOO_LARGE — all with a message.
  uploadPaymentProof: (formData: FormData) =>
    api.post<{ success: boolean; message: string; data: PaymentProof }>('/api/employee/payment/proof', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    }),
  // A fresh 15-minute URL for a proof of this branch; 404 PAYMENT_PROOF_NOT_FOUND.
  getPaymentProof: (proofFileId: string) =>
    api.get<{ success: boolean; data: PaymentProof }>(`/api/employee/payment/proof/${encodeURIComponent(proofFileId)}`),
};

// ─── Customers tab (Fleet) ─────────────────────────────────────────────────
// The branch manager's Customers tab, same handlers / data / rules
// (types/customers.ts). customerId = Customer publicId (User publicId works too).
// Errors carry { code, message }: 404 CUSTOMER_NOT_FOUND / BOOKING_NOT_FOUND,
// 400 INVALID_QUERY / BLACKLIST_REASON_REQUIRED / BLACKLIST_REASON_TOO_LONG,
// 409 CUSTOMER_ALREADY_BLACKLISTED / CUSTOMER_NOT_BLACKLISTED.
const customersBase = (customerId: string) => `/api/employee/customers/${encodeURIComponent(customerId)}`;

export const employeeCustomersApi = {
  // Every registered customer, newest first; search = name or phone (≤100 chars).
  list: (params: { search?: string; filter?: CustomerFilter; page?: number; limit?: number }) =>
    api.get<CustomerListResponse>('/api/employee/customers', { params }),
  // Profile, blacklist, pending credit and the first 20 rents per bucket.
  get: (customerId: string) =>
    api.get<{ success: boolean; data: CustomerDetail }>(customersBase(customerId)),
  rents: (customerId: string, params: { bucket: RentBucket; page: number; limit?: number }) =>
    api.get<RentsPage>(`${customersBase(customerId)}/rents`, { params }),
  booking: (customerId: string, bookingId: string) =>
    api.get<{ success: boolean; data: CustomerBookingDetail }>(
      `${customersBase(customerId)}/bookings/${encodeURIComponent(bookingId)}`,
    ),
  // reason: 3–500 chars. Existing bookings are not cancelled.
  blacklist: (customerId: string, reason: string) =>
    api.post<{ success: boolean; message: string; data: BlacklistResult }>(
      `${customersBase(customerId)}/blacklist`,
      { reason },
    ),
  unblacklist: (customerId: string, note?: string) =>
    api.post<{ success: boolean; message: string }>(
      `${customersBase(customerId)}/unblacklist`,
      note ? { note } : {},
    ),
};

// Legacy remaining balance (#3 / #11) — POST …/initiate-remaining-payment.
export type RemainingPaymentBody =
  | { method: 'CASH' | 'ONLINE_RAZORPAY' }
  | { method: 'UPI'; proof_file_id?: string; utr?: string }
  | { method: 'SPLIT'; cashAmount: number; onlineAmount: number; proof_file_id?: string; utr?: string }
  | { method: 'CREDIT'; collateral: string };

// ─── discount ───────────────────────────────────────────────────────────────

export interface CouponValidateBody {
  couponCode: string;
  vehiclePublicId?: string;
  groupKey?: string;
  startAt: string;
  endAt: string;
  /** Plan the customer picked; omitted = the branch default (#6). */
  paymentFlow?: PaymentFlow;
}

/**
 * The server's re-priced breakdown with the coupon applied (numbers). Render
 * totals from here — never `oldTotal − discountAmount` (discountAmount is the
 * coupon's rent-without-GST part).
 */
// Item 17: the classic fields are in taxable terms (rent without GST); the
// GST-inclusive fields (RentInclGstFields) are the price the customer sees.
export interface CouponPreviewPricing extends RentInclGstFields {
  basePrice: number;
  durationDiscountAmount: number;
  durationDiscountPercent: number;
  durationDiscountLabel: string | null;
  /** A slab matched but the coupon replaced it (no stacking): hide the duration line. */
  durationSuppressed: boolean;
  couponDiscountAmount: number;
  /** Total discount (duration + coupon). */
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxRate: number;
  /** Rental after discounts + GST (no deposit). */
  finalTotal: number;
  deposit: number;
  /** finalTotal + deposit. */
  payableTotal: number;
}

export interface CouponValidateValid {
  valid: true;
  couponCode: string;
  /** Coupon layer only (pre-GST), Decimal string. */
  discountAmount: string;
  /** What the coupon takes off the GST-inclusive rent (item 17) — show this one. Absent on older servers. */
  discountInclGst?: string;
  discountType?: string;
  discountValue?: string;
  // Absent on older servers.
  pricing?: CouponPreviewPricing;
  payableTotal?: number;
  /** Plan the coupon was checked for (the effective plan). */
  paymentFlow?: PaymentFlow;
  /** The sent paymentFlow isn't allowed for these amounts / this branch. */
  paymentFlowAdjusted?: boolean;
  /** Recomputed with the post-coupon total — drives the plan chooser. */
  paymentOptions?: PaymentOptions;
}

export interface CouponValidateInvalid {
  valid: false;
  code: string;
  reason: string;
}

export type CouponValidateResult = CouponValidateValid | CouponValidateInvalid;

export const discountApi = {
  validateCoupon: (body: CouponValidateBody) =>
    api.post<{ data: CouponValidateResult }>(couponValidatePath(), body),
};

// A signed-in customer previews through /api/user/discount/validate (their own
// customer id: USER-scoped and manager "friend" coupons, per-user limits and
// loyalty coupons only work there). Guests — and a staff session, which the
// customer route refuses — use the anonymous public preview.
export function couponValidatePath(): string {
  const { token, user } = useAuthStore.getState();
  return token && user?.role !== 'STAFF' ? '/api/user/discount/validate' : '/api/public/discount/validate';
}

/**
 * 4xx body of a coupon the server refused while booking (422 at customer
 * booking create; 409/422 on the pickup counter). Always carries `message`.
 */
export interface CouponRejectedBody {
  success: false;
  code: string;
  message: string;
  couponRejected: true;
  appliedCouponCode?: string | null;
}

// Pickup-counter coupon (Unified Payments). Money fields are 2-dp STRINGS.
// totalCredit = the coupon off the GST-inclusive rent (item 17) = discountAmount
// (its rent-without-GST part) + gstAmount — the bill line.
export interface CounterCouponQuote {
  couponCode: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  gstAmount: string;
  totalCredit: string;
  /** = totalCredit: the coupon off the GST-inclusive rent (item 17) — show this one. */
  discountInclGst?: string;
  rentalBase: string;
  owedBeforeCoupon: string;
  /** OWED: limited to the rental still due; COMBINED_CAP: the branch's maximum discount. */
  cappedBy: 'OWED' | 'COMBINED_CAP' | null;
}

export function couponRejection(err: any): CouponRejectedBody | null {
  const body = err?.response?.data;
  return body?.couponRejected === true ? (body as CouponRejectedBody) : null;
}

// POST /api/public/vehicles/booking — 200 body (fields this app reads).
export interface CustomerBookingCreateResponse {
  holdId: string;
  /** The plan actually charged (may differ from the one sent). */
  payment_flow?: PaymentFlow;
  /** null when the request carried no payment_flow (item 18: the plan is the server's). */
  paymentFlowRequested?: PaymentFlow | null;
  paymentFlowAdjusted?: boolean;
  paymentFlowAdjustReason?: string | null;
  paymentFlowAdjustMessage?: string | null;
  paymentOptions?: PaymentOptions;
  isAdvancePayment?: boolean;
  data?: {
    totals?: {
      grandFinalTotal?: number;
      grandDeposit?: number;
      grandDiscountTotal?: number;
      grandDurationDiscountTotal?: number;
      grandCouponDiscountTotal?: number;
      // GST-inclusive rent totals (item 17); the grand*Total discounts above are taxable-terms.
      grandRentInclGst?: number;
      grandDiscountInclGst?: number;
      grandRentAfterDiscountInclGst?: number;
      grandRentWithoutGst?: number;
      durationDiscountLabel?: string | null;
      appliedCouponCode?: string | null;
      advanceAmount?: number;
      /** Razorpay order amount (advance or full). */
      payNowAmount?: number;
      /** Balance due at pickup (0 for FULL). */
      dueAtPickup?: number;
      remainingBalance?: number;
      transactionId?: string;
      razorpay?: RazorpayOrder | null;
    };
  };
}

// ─── notifications (#19) ────────────────────────────────────────────────────
// One inbox per role, always scoped server-side to the signed-in user.
// Errors: 400 INVALID_CURSOR (drop the cursor, reload page 1), 400
// INVALID_PUSH_TOKEN, 404 NOTIFICATION_NOT_FOUND.

function notificationsBase(audience: NotificationAudience): string {
  return audience === 'STAFF' ? '/api/employee/notifications' : '/api/user/notifications';
}

export const notificationsApi = {
  // { data: NotificationPage } — newest first. limit 1–50 (default 20).
  list: (audience: NotificationAudience, params?: { cursor?: string; limit?: number; unreadOnly?: boolean }) =>
    api.get<{ data: NotificationPage }>(notificationsBase(audience), { params }),
  // { data: { unreadCount } }
  unreadCount: (audience: NotificationAudience) =>
    api.get<{ data: { unreadCount: number } }>(`${notificationsBase(audience)}/unread-count`),
  // { data: { notification, unreadCount } } — idempotent.
  markRead: (audience: NotificationAudience, publicId: string) =>
    api.patch<{ data: { notification: AppNotification; unreadCount: number } }>(
      `${notificationsBase(audience)}/${encodeURIComponent(publicId)}/read`,
    ),
  // { data: { updated, unreadCount: 0 } }
  markAllRead: (audience: NotificationAudience) =>
    api.patch<{ data: { updated: number; unreadCount: number } }>(`${notificationsBase(audience)}/read-all`),
  // The token is re-assigned to whoever registered it last on the server.
  registerPushToken: (audience: NotificationAudience, body: { token: string; platform: 'ios' | 'android' }) =>
    api.post(`${notificationsBase(audience)}/push-token`, body),
  // { data: { removed: 0 | 1 } }. Short timeout: it runs during sign-out.
  unregisterPushToken: (audience: NotificationAudience, token: string) =>
    api.delete(`${notificationsBase(audience)}/push-token`, { data: { token }, timeout: 5_000 }),
};

// ─── deferred deep links (#16) ─────────────────────────────────────────────
// No auth. The website records the shared vehicle (keyed by network + platform,
// 1 h) before sending a phone to the store; the app claims it once on first
// launch. { data: { path, vehicleId, kind, createdAt } | null } — the claim
// deletes the entry. Errors (treat all as "nothing to open"): 400
// DEFERRED_LINK_PLATFORM_INVALID, 429 RATE_LIMITED, 503 DEFERRED_LINK_UNAVAILABLE.

export interface DeferredLinkClaim {
  /** Encoded for URLs — navigate with vehicleId instead. */
  path: string;
  /** Raw group key or vehicle publicId. */
  vehicleId: string;
  kind: 'group' | 'vehicle';
  createdAt: string;
}

export const deepLinkApi = {
  // Short timeout: it runs at startup and must never hold the app up.
  claim: (platform: 'android' | 'ios') =>
    api.post<{ success: boolean; data: DeferredLinkClaim | null }>(
      '/api/public/deferred-links/claim',
      { platform },
      { timeout: 6_000 },
    ),
};
