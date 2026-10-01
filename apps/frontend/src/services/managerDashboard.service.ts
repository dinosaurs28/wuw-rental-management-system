import apiClient from "@/lib/axios";
import type {
  BookingListCounts,
  BookingListType,
  OverdueReturnsResponse,
  OverdueReturnsSnapshot,
} from "@/types/overdueReturns";
import type { BookingQrPhotoData, QrPhotoResponse } from "@/types/qrPhoto";
import type { DlStatus } from "@/services/dlStatus.service";

// ── Staff Activity Full Types ─────────────────────────────────────────────────
export type StaffActivityLog = {
  id: number;
  publicId: string;
  actorPublicId: string;
  actorName: string;
  actorRole: string;
  branchId: number;
  branchName: string;
  actionType: string;
  entityType: string;
  entityRef: string;
  description: string;
  metadata: any | null;
  createdAt: string;
};

export type StaffActivityParams = {
  page?: number;
  limit?: number;
  actorPublicId?: string;
  actionType?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
};

export type StaffActivityResponse = {
  data: StaffActivityLog[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

// Types
export interface KPIStats {
  activeBookings?: number;
  pendingApprovals?: number;
  activeVehicles: number;
  inactiveVehicles: number;
  maintenanceVehicles: number;
  openDamageReports: number;
  staffOnDuty: number;
}

export interface Booking {
  id: string;
  customerName: string;
  vehicleName: string;
  startDate: string;
  endDate: string;
  status: "PENDING" | "CONFIRMED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  reason?: string; // For pending approvals
  isAdvancePayment?: boolean;
  remainingBalance?: number;
  remainingPaidAt?: string | null;
  /** Original licence custody (#3); null = not recorded. */
  dlStatus?: DlStatus;
  dlDepositNote?: string | null;
}

export interface DamageReport {
  id: string;
  vehicleName: string;
  reportedBy: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "IN_PROGRESS" | "APPROVED" | "REJECTED";
  createdAt: string;
  vehicleImage?: string | null;
  /** Billed to the customer at drop — the manager only sets the vehicle status. */
  chargedAtDrop?: boolean;
  /** Recorded by staff at drop. */
  raisedAtDrop?: boolean;
  /** false → disposition only (charged at drop or company expense). */
  managerCharges?: boolean;
  estimatedCost?: number;
}

export interface StaffActivity {
  id: string;
  employeeName: string;
  action: string;
  timestamp: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface CancellationStats {
  todayCancelledCount: number;
  last7DaysCancelledCount: number;
  last30DaysCancelledCount: number;
  totalCancelledCount: number;
  autoCancelledCount: number;
  manualCancelledCount: number;
}

export interface CancelledBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  totalFinal: string;
  advanceAmount: string | null;
  customer: {
    user: { name: string; phone: string | null; email: string };
  };
  items: {
    vehicle: { make: string; model: string; regNo: string };
  }[];
  cancellationInvoice: { advanceAmount: string; cancellationFee: string } | null;
}

export interface FleetBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  totalFinal: string;
  status: "CONFIRMED" | "PICKED_UP";
  days?: number;
  rentalPeriodType?: string | null;
  /** Daily / Monthly tab the booking belongs to. */
  bookingType?: BookingListType;
  /** Original licence custody (#3); null = not recorded. */
  dlStatus?: DlStatus;
  /** What was left instead of the licence (DEPOSIT only). */
  dlDepositNote?: string | null;
  dlStatusUpdatedAt?: string | null;
  customer: {
    publicId: string;
    alternatePhone?: string | null;
    user: { name: string; email: string; phone?: string | null };
  };
  items: {
    vehicle: {
      make: string;
      model: string;
      regNo: string;
      images: { file: { url: string } }[];
    };
  }[];
}

/** One Daily / Monthly tab of a BM Fleet list. */
export interface FleetTabResult {
  bookings: FleetBooking[];
  /** Both tabs' row counts; null if the server sent none. */
  counts: BookingListCounts | null;
  /** Rows in this tab on the server (may exceed bookings.length when capped by limit). */
  total: number;
}

export interface NoShowBooking {
  publicId: string;
  startAt: string;
  endAt: string;
  totalFinal: string;
  isAdvancePayment: boolean;
  advanceAmount: string | null;
  remainingBalance: string | null;
  depositMethod: string | null;
  createdAt: string;
  customer: {
    publicId: string;
    user: { name: string; phone: string | null; email: string };
  };
  items: {
    vehicle: {
      make: string;
      model: string;
      regNo: string;
      images: { file: { url: string } }[];
    };
  }[];
}

export const managerDashboardService = {
  getDashboardStats: async () => {
    const response = await apiClient.get("/branchManager/dashboard/stats", {
      timeout: 10000,
    });
    const data = response.data.data;

    return {
      activeVehicles: data.vehicles.available,
      inactiveVehicles: data.vehicles.inactive,
      maintenanceVehicles: data.vehicles.maintenance,
      openDamageReports: data.damageReports.open,
      staffOnDuty: data.staff.total,
    };
  },

  getKPIs: async () => {
    return managerDashboardService.getDashboardStats();
  },

  getActiveBookings: async (date?: string): Promise<Booking[]> => {
    const params = date ? { date } : {};
    const response = await apiClient.get(
      "/branchManager/dashboard/bookings/active",
      { params, timeout: 10000 },
    );
    const rawBookings = response.data.data.bookings || [];

    return rawBookings.map((b: any) => ({
      id: b.publicId || String(b.id),
      customerName: b.customer?.user?.name || "Unknown",
      vehicleName: b.items?.[0]?.vehicle
        ? `${b.items[0].vehicle.make} ${b.items[0].vehicle.model}`
        : "Unknown Vehicle",
      startDate: b.startAt,
      endDate: b.endAt,
      status: b.status,
      reason: "",
      isAdvancePayment: b.isAdvancePayment,
      remainingBalance: b.remainingBalance ? Number(b.remainingBalance) : undefined,
      remainingPaidAt: b.remainingPaidAt,
      dlStatus: b.dlStatus ?? null,
      dlDepositNote: b.dlDepositNote ?? null,
    }));
  },

  getPendingApprovals: async (): Promise<Booking[]> => {
    const response = await apiClient.get(
      "/branchManager/dashboard/bookings/pending",
      { timeout: 10000 },
    );
    const rawBookings = response.data.data.bookings || [];

    return rawBookings.map((b: any) => ({
      id: b.publicId || String(b.id),
      customerName: b.customer?.user?.name || "Unknown",
      vehicleName: b.items?.[0]?.vehicle
        ? `${b.items[0].vehicle.make} ${b.items[0].vehicle.model}`
        : "Unknown Vehicle",
      startDate: b.startAt,
      endDate: b.endAt,
      status: b.status,
      reason: "Pending Approval",
    }));
  },

  getDamageReports: async (
    page = 1,
    limit = 10,
    search = "",
  ): Promise<DamageReport[]> => {
    const response = await apiClient.get("/branchManager/damage-reports", {
      params: { page, limit, search },
      timeout: 10000,
    });

    const rawReports = response.data.data.reports || [];
    return rawReports.map((r: any) => ({
      id: String(r.id), // Use internal ID as string for frontend consistency
      publicId: r.publicId || String(r.id),
      vehicleName: r.vehicle
        ? `${r.vehicle.make} ${r.vehicle.model}`
        : "Unknown",
      reportedBy: "System",
      severity: "MEDIUM", // Placeholder
      status: r.status,
      createdAt: r.createdAt,
      vehicleImage: r.vehicle?.image,
      chargedAtDrop: !!r.chargedAtDrop,
      raisedAtDrop: !!r.raisedAtDrop,
      managerCharges: r.managerCharges ?? !r.chargedAtDrop,
      estimatedCost: r.estimatedCost != null ? Number(r.estimatedCost) : undefined,
    }));
  },

  getStaffActivity: async (limit = 10): Promise<StaffActivity[]> => {
    const response = await apiClient.get(
      "/branchManager/dashboard/staff/activity",
      { params: { limit }, timeout: 10000 },
    );
    const rawLogs = response.data.data || [];

    return rawLogs.map((log: any) => ({
      id: log.publicId || String(log.id),
      employeeName: log.actorName || "Staff Member",
      action: log.description || log.actionType,
      timestamp: log.createdAt,
    }));
  },

  getStaffActivityFull: async (params: StaffActivityParams): Promise<StaffActivityResponse> => {
    const response = await apiClient.get("/branchManager/dashboard/staff/activity", { params });
    return response.data;
  },

  /** Branch Fleet Executives (role STAFF). The endpoint pages at 10 unless `limit` is given. */
  getEmployees: async (limit?: number): Promise<Employee[]> => {
    const response = await apiClient.get("/branchManager/dashboard/employees", {
      timeout: 10000,
      ...(limit ? { params: { limit } } : {}),
    });
    const rawEmployees = response.data.data || [];

    return rawEmployees.map((e: any) => ({
      id: e.publicId || String(e.id),
      name: e.name,
      role: e.role,
      status: "ACTIVE",
    }));
  },

  getFleetPickedUp: async (limit = 50, date?: string): Promise<FleetBooking[]> => {
    const response = await apiClient.get("/branchManager/dashboard/bookings/pending", {
      params: { limit, ...(date ? { date } : {}) },
      timeout: 10000,
    });
    return response.data.data.bookings || [];
  },

  getFleetUpcoming: async (limit = 50, date?: string): Promise<FleetBooking[]> => {
    const response = await apiClient.get("/branchManager/dashboard/bookings/active", {
      params: { limit, ...(date ? { date } : {}) },
      timeout: 10000,
    });
    return response.data.data.bookings || [];
  },

  /**
   * One Daily / Monthly tab of a Fleet list: "picked_up" (out on road,
   * /bookings/pending) or "upcoming" (CONFIRMED, /bookings/active). Monthly
   * ignores the date. `counts` covers both tabs.
   */
  getFleetTab: async (
    list: "picked_up" | "upcoming",
    type: BookingListType,
    limit = 200,
  ): Promise<FleetTabResult> => {
    const path =
      list === "picked_up"
        ? "/branchManager/dashboard/bookings/pending"
        : "/branchManager/dashboard/bookings/active";
    const response = await apiClient.get(path, { params: { limit, type }, timeout: 10000 });
    const data = response.data.data ?? {};
    return {
      bookings: data.bookings ?? [],
      counts: data.counts ?? null,
      total: data.pagination?.total ?? (data.bookings ?? []).length,
    };
  },

  /**
   * Overdue / no-show returns for the manager's branch, most overdue first.
   * GET /branchManager/dashboard/bookings/overdue — always 200 (empty = []).
   */
  getOverdueReturns: async (
    params: { page?: number; limit?: number; type?: BookingListType } = {},
  ): Promise<OverdueReturnsSnapshot> => {
    const response = await apiClient.get<OverdueReturnsResponse>(
      "/branchManager/dashboard/bookings/overdue",
      { params, timeout: 10000 },
    );
    return { ...response.data, fetchedAt: Date.now() };
  },

  getNoShowEligible: async (page = 1, limit = 20, graceHours = 0) => {
    const response = await apiClient.get(
      "/branchManager/dashboard/bookings/no-show-eligible",
      { params: { page, limit, graceHours }, timeout: 10000 },
    );
    return response.data as {
      success: boolean;
      data: NoShowBooking[];
      pagination: { total: number; page: number; limit: number; totalPages: number };
      graceHours: number;
    };
  },

  cancelNoShow: async (
    bookingId: string,
    reason: string,
    refundCustomer = false,
    refundMethod?: string,
    refundAmount?: number,
  ) => {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/cancel-no-show`,
      { reason, refundCustomer, refundMethod, refundAmount },
      { timeout: 10000 },
    );
    return response.data;
  },

  getCancellationStats: async (): Promise<CancellationStats> => {
    const response = await apiClient.get("/branchManager/dashboard/cancellations/stats", { timeout: 10000 });
    return response.data.data as CancellationStats;
  },

  getCancellationHistory: async (params: {
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CancelledBooking[]; pagination: { total: number; page: number; limit: number; totalPages: number } }> => {
    const response = await apiClient.get("/branchManager/dashboard/cancellations", {
      params,
      timeout: 10000,
    });
    return { data: response.data.data, pagination: response.data.pagination };
  },

  triggerNoShowAutoCancel: async (): Promise<{ cancelledCount: number; bookingIds: string[] }> => {
    const response = await apiClient.post("/branchManager/dashboard/cancellations/trigger-cron", {}, { timeout: 60000 });
    return response.data.data as { cancelledCount: number; bookingIds: string[] };
  },

  getInsuranceExpiryReports: async () => {
    const response = await apiClient.get(
      "/branchManager/dashboard/reports/insurance-expiry",
      { timeout: 10000 },
    );
    return response.data.data;
  },

  getManagerConfirmations: async (): Promise<any[]> => {
    const response = await apiClient.get(
      "/branchManager/dashboard/bookings/manager-confirmations",
      { timeout: 10000 },
    );
    return response.data.data || [];
  },

  getConfirmationDetails: async (bookingId: string): Promise<any> => {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/confirmation-details`,
      { timeout: 10000 },
    );
    return response.data.data;
  },

  // Customer QR code photo (#4) for a booking of this branch: the booking's
  // snapshot, else the customer's current photo.
  getBookingQrPhoto: async (bookingId: string): Promise<BookingQrPhotoData> => {
    const response = await apiClient.get<QrPhotoResponse<BookingQrPhotoData>>(
      `/branchManager/dashboard/bookings/${bookingId}/qr-photo`,
      { timeout: 10000 },
    );
    return response.data.data;
  },

  // Replaces the booking's QR code photo (HOLD/CONFIRMED only; 409 QR_PHOTO_FROZEN
  // after pickup) and makes it the customer's current photo.
  uploadBookingQrPhoto: async (
    bookingId: string,
    file: File,
  ): Promise<QrPhotoResponse<BookingQrPhotoData>> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<QrPhotoResponse<BookingQrPhotoData>>(
      `/branchManager/dashboard/bookings/${bookingId}/qr-photo`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 },
    );
    return response.data;
  },

  collectSafetyDeposit: async (bookingId: string, data: any) => {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/safety-deposit`,
      data,
      { timeout: 10000 },
    );
    return response.data;
  },

  confirmPickupWithDeposit: async (bookingId: string, data: any) => {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/manager-confirm-pickup`,
      data,
      { timeout: 10000 },
    );
    return response.data;
  },

  confirmReturnManager: async (bookingId: string) => {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/manager-confirm-return`,
      {},
      { timeout: 10000 },
    );
    return response.data;
  },

  refundSafetyDeposit: async (bookingId: string, amount: number) => {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/refund-deposit`,
      { amount },
      { timeout: 10000 },
    );
    return response.data;
  },

  // Safety deposits Fleet requested at pickup that need the BM's approval
  getSafetyDepositRequests: async (): Promise<SafetyDepositRequestRow[]> => {
    const response = await apiClient.get("/branchManager/safety-deposit-requests", {
      timeout: 10000,
    });
    return response.data.data || [];
  },

  approveSafetyDepositRequest: async (
    publicId: string,
    approvedAmount: number,
  ): Promise<{ message: string }> => {
    const response = await apiClient.post(
      `/branchManager/safety-deposit-requests/${publicId}/approve`,
      { approvedAmount },
      { timeout: 10000 },
    );
    return response.data;
  },

  rejectSafetyDepositRequest: async (
    publicId: string,
    rejectionReason: string,
  ): Promise<{ message: string }> => {
    const response = await apiClient.post(
      `/branchManager/safety-deposit-requests/${publicId}/reject`,
      { rejectionReason },
      { timeout: 10000 },
    );
    return response.data;
  },
};

/** Window event fired after a confirmation / deposit request is acted on (nav badge refresh). */
export const MANAGER_CONFIRMATIONS_CHANGED_EVENT = "manager-confirmations-changed";

/** Pickups/returns awaiting confirmation + pending safety-deposit requests (nav badge). */
export async function getPendingConfirmationsCount(): Promise<number> {
  const results = await Promise.allSettled([
    managerDashboardService.getManagerConfirmations(),
    managerDashboardService.getSafetyDepositRequests(),
  ]);
  return results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.length : 0), 0);
}

export interface SafetyDepositRequestRow {
  publicId: string;
  /** Decimal as a string. */
  requestedAmount: string;
  reason: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  createdAt: string;
  booking: {
    publicId: string;
    /** Absent from servers that predate the confirmations page. */
    status?: string;
    customer?: { user: { name: string | null } } | null;
    items?: { vehicle: { make: string; model: string; regNo: string } }[];
  };
  requestedBy: { publicId: string; name: string; role: string };
}
