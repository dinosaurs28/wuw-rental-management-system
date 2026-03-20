import apiClient from "@/lib/axios";

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
}

export interface DamageReport {
  id: string;
  vehicleName: string;
  reportedBy: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "IN_PROGRESS" | "APPROVED" | "REJECTED";
  createdAt: string;
  vehicleImage?: string | null;
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
    }));
  },

  getStaffActivity: async (): Promise<StaffActivity[]> => {
    const response = await apiClient.get(
      "/branchManager/dashboard/staff/activity-logs",
      { timeout: 10000 },
    );
    const rawLogs = response.data.data || [];

    return rawLogs.map((log: any) => ({
      id: log.publicId || String(log.id),
      employeeName: "Staff Member",
      action: log.action,
      timestamp: log.createdAt,
    }));
  },

  getEmployees: async (): Promise<Employee[]> => {
    const response = await apiClient.get("/branchManager/dashboard/employees", {
      timeout: 10000,
    });
    const rawEmployees = response.data.data || [];

    return rawEmployees.map((e: any) => ({
      id: e.publicId || String(e.id),
      name: e.name,
      role: e.role,
      status: "ACTIVE",
    }));
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
};
