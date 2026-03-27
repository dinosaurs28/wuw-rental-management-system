import apiClient from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtensionStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_COLLECTED"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED";

export type ExtensionResolutionType =
  | "SAME_VEHICLE"
  | "SWAP_CURRENT_TO_OTHER"
  | "SWAP_FUTURE_BOOKING"
  | "PARTIAL_EXTENSION"
  | "NO_RESOLUTION";

export interface AlternativeVehicle {
  publicId: string;
  regNo: string;
  make: string;
  model: string;
}

export interface AffectedBookingSwap {
  bookingPublicId: string;
  newVehicle: AlternativeVehicle;
}

export interface ResolutionOption {
  type: ExtensionResolutionType;
  label: string;
  description: string;
  availableVehicles?: AlternativeVehicle[];
  affectedBookings?: AffectedBookingSwap[];
  partialNewEndAt?: string;
  additionalAmount: string;
  newTotalFinal: string;
}

export interface ExtensionPricing {
  originalDays: number;
  newDays: number;
  originalTotalFinal: string;
  newTotalFinal: string;
  additionalAmount: string;
}

export interface ExtensionEvaluation {
  extensionPublicId: string;
  bookingPublicId: string;
  currentEndAt: string;
  requestedEndAt: string;
  pricing: ExtensionPricing;
  resolutionOptions: ResolutionOption[];
  recommendedResolution: ExtensionResolutionType;
}

export interface BookingExtension {
  publicId: string;
  bookingPublicId: string;
  extensionStatus: ExtensionStatus;
  oldEndAt: string;
  requestedEndAt: string;
  actualNewEndAt?: string;
  additionalAmount: string;
  newTotalFinal: string;
  resolutionType?: ExtensionResolutionType;
  vehicleSwapOccurred: boolean;
  actorPublicId: string;
  actorRole: string;
  notes?: string;
  createdAt: string;
}

export interface CommitExtensionPayload {
  extensionPublicId: string;
  resolutionType: ExtensionResolutionType;
  selectedVehicleId?: string;
  affectedBookingSwaps?: { bookingPublicId: string; newVehiclePublicId: string }[];
  partialNewEndAt?: string;
  idempotencyKey: string;
}

export interface CommitExtensionResult {
  publicId: string;
  extensionStatus: ExtensionStatus;
  resolutionType: ExtensionResolutionType;
  additionalAmount: string;
  remainAmount: {
    extension: string;
  };
}

export interface CollectExtensionResult {
  remainAmount: {
    extension: string;
  };
  payment: "pending" | "confirmed";
}

// ── Service ───────────────────────────────────────────────────────────────────

export const extensionService = {
  // ── Employee ────────────────────────────────────────────────────────────────

  employeeEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/employee/extensions/evaluate`,
        { bookingPublicId, newEndAt, notes }
      )
      .then((r) => r.data),

  employeeCommit: (payload: CommitExtensionPayload) =>
    apiClient
      .post<{ data: CommitExtensionResult; message: string }>(
        `/employee/extensions/commit`,
        payload
      )
      .then((r) => r.data),

  employeeCollect: (
    extensionPublicId: string,
    payload: { method: "CASH" | "ONLINE"; onlineTransactionRef?: string }
  ) =>
    apiClient
      .post<{ data: CollectExtensionResult; message: string }>(
        `/employee/extensions/${extensionPublicId}/collect`,
        payload
      )
      .then((r) => r.data),

  employeeCancel: (extensionPublicId: string) =>
    apiClient
      .post<{ message: string }>(
        `/employee/extensions/${extensionPublicId}/cancel`
      )
      .then((r) => r.data),

  listEmployeeExtensions: (
    page = 1,
    pageSize = 50,
    bookingPublicId?: string,
    status?: ExtensionStatus
  ) =>
    apiClient
      .get<{ data: { extensions: BookingExtension[]; total: number } }>(
        `/employee/extensions`,
        { params: { page, pageSize, bookingPublicId, status } }
      )
      .then((r) => r.data),

  // ── Manager ─────────────────────────────────────────────────────────────────

  managerEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/branchManager/extensions/evaluate`,
        { bookingPublicId, newEndAt, notes }
      )
      .then((r) => r.data),

  managerCommit: (payload: CommitExtensionPayload) =>
    apiClient
      .post<{ data: BookingExtension; message: string }>(
        `/branchManager/extensions/commit`,
        payload
      )
      .then((r) => r.data),

  managerCancel: (extensionPublicId: string) =>
    apiClient
      .post<{ message: string }>(
        `/branchManager/extensions/${extensionPublicId}/cancel`
      )
      .then((r) => r.data),

  listBranchExtensions: (
    page = 1,
    pageSize = 20,
    bookingPublicId?: string,
    status?: ExtensionStatus
  ) =>
    apiClient
      .get<{ data: { extensions: BookingExtension[]; total: number } }>(
        `/branchManager/extensions`,
        { params: { page, pageSize, bookingPublicId, status } }
      )
      .then((r) => r.data),

  getExtensionDetail: (publicId: string) =>
    apiClient
      .get<{ data: BookingExtension }>(`/branchManager/extensions/${publicId}`)
      .then((r) => r.data.data),

  getDisplacedBookings: () =>
    apiClient
      .get<{ data: any[] }>(`/branchManager/extensions/displaced-bookings`)
      .then((r) => r.data.data),

  // ── Customer ────────────────────────────────────────────────────────────────

  customerEvaluate: (bookingPublicId: string, newEndAt: string, notes?: string) =>
    apiClient
      .post<{ data: ExtensionEvaluation; message: string }>(
        `/user/bookings/${bookingPublicId}/extensions/evaluate`,
        { newEndAt, notes }
      )
      .then((r) => r.data),

  customerCommit: (payload: {
    extensionPublicId: string;
    paymentMethod: "ONLINE";
    onlineTransactionRef: string;
    onlineGateway?: string;
    idempotencyKey: string;
  }) =>
    apiClient
      .post<{ data: BookingExtension; message: string }>(
        `/user/extensions/commit`,
        payload
      )
      .then((r) => r.data),

  customerGetStatus: (extensionPublicId: string) =>
    apiClient
      .get<{ data: BookingExtension }>(`/user/extensions/${extensionPublicId}`)
      .then((r) => r.data.data),
};
