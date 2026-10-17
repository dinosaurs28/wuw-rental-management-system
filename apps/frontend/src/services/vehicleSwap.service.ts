import apiClient from "@/lib/axios";
import type {
  AvailableVehicle,
  VehicleSwapRequest,
  VehicleSwap,
  SwapHistoryFilters,
  SwapCandidates,
  SwapKmPreview,
} from "@/types/vehicleSwap";

export interface BookingVehicleDetails {
  make: string;
  model: string;
  regNo: string;
  image: string | null;
}

export const employeeVehicleSwapService = {
  /**
   * Get available vehicles for swap (employee)
   */
  async getAvailableVehicles(bookingId: string): Promise<AvailableVehicle[]> {
    const response = await apiClient.get(
      `/employee/bookings/${bookingId}/available-vehicles`,
    );
    return response.data.data;
  },

  /**
   * Perform vehicle swap (employee)
   */
  async performSwap(
    bookingId: string,
    swapRequest: VehicleSwapRequest,
  ): Promise<VehicleSwap> {
    const response = await apiClient.post(
      `/employee/bookings/${bookingId}/swap-vehicle`,
      swapRequest,
    );
    return response.data.data;
  },

  /**
   * Replacement candidates plus the swap context (stage, readings rule,
   * current car, price-difference defaults) — employee
   */
  async getSwapCandidates(bookingId: string): Promise<SwapCandidates> {
    const response = await apiClient.get(
      `/employee/bookings/${bookingId}/available-vehicles`,
    );
    return {
      vehicles: response.data.data ?? [],
      excluded: response.data.excluded ?? [],
      swapContext: response.data.swapContext ?? null,
    };
  },

  /**
   * Swap history of one booking, newest first (employee)
   */
  async getBookingSwapHistory(bookingId: string): Promise<VehicleSwap[]> {
    const response = await apiClient.get(
      `/employee/bookings/${bookingId}/swap-history`,
    );
    return response.data.data ?? [];
  },

  /** The returning car's km at a mid-rental swap, by the drop's rule (employee) */
  async previewSwapKm(bookingId: string, endOdometer: number, newVehicleId?: number): Promise<SwapKmPreview> {
    const response = await apiClient.get(`/employee/bookings/${bookingId}/swap-km-preview`, {
      params: { endOdometer, ...(newVehicleId != null && { newVehicleId }) },
    });
    return response.data.data;
  },

  /** Photo of the replacement for a mid-rental swap (the pickup photo upload) */
  async uploadSwapPhoto(formData: FormData): Promise<{ fileId: string; url: string }> {
    const response = await apiClient.post("/employee/pickup/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  async deleteSwapPhoto(fileId: string): Promise<void> {
    await apiClient.delete(`/employee/pickup/image/${fileId}`);
  },
};

export const vehicleSwapService = {
  /**
   * Get current vehicle details for a booking
   */
  async getBookingVehicleDetails(
    bookingId: string,
  ): Promise<BookingVehicleDetails | null> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/vehicle-details`,
    );
    return response.data.data;
  },

  /**
   * Get available vehicles for swap
   */
  async getAvailableVehicles(bookingId: string): Promise<AvailableVehicle[]> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/available-vehicles`,
    );
    return response.data.data;
  },

  /** The returning car's km at a mid-rental swap, by the drop's rule (branch manager) */
  async previewSwapKm(bookingId: string, endOdometer: number, newVehicleId?: number): Promise<SwapKmPreview> {
    const response = await apiClient.get(`/branchManager/dashboard/bookings/${bookingId}/swap-km-preview`, {
      params: { endOdometer, ...(newVehicleId != null && { newVehicleId }) },
    });
    return response.data.data;
  },

  /**
   * Replacement candidates plus the swap context (stage, readings rule,
   * current car, price-difference defaults)
   */
  async getSwapCandidates(bookingId: string): Promise<SwapCandidates> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/available-vehicles`,
    );
    return {
      vehicles: response.data.data ?? [],
      excluded: response.data.excluded ?? [],
      swapContext: response.data.swapContext ?? null,
    };
  },

  /**
   * Perform vehicle swap
   */
  async performSwap(
    bookingId: string,
    swapRequest: VehicleSwapRequest,
  ): Promise<VehicleSwap> {
    const response = await apiClient.post(
      `/branchManager/dashboard/bookings/${bookingId}/swap-vehicle`,
      swapRequest,
    );
    return response.data.data;
  },

  /**
   * Get swap history for a booking
   */
  async getBookingSwapHistory(bookingId: string): Promise<VehicleSwap[]> {
    const response = await apiClient.get(
      `/branchManager/dashboard/bookings/${bookingId}/swap-history`,
    );
    return response.data.data;
  },

  /** Photo of the replacement for a mid-rental swap */
  async uploadSwapPhoto(formData: FormData): Promise<{ fileId: string; url: string }> {
    const response = await apiClient.post("/branchManager/dashboard/swap-photos/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  async deleteSwapPhoto(fileId: string): Promise<void> {
    await apiClient.delete(`/branchManager/dashboard/swap-photos/${fileId}`);
  },

  /**
   * Get swap history with filters
   */
  async getSwapHistory(filters: SwapHistoryFilters): Promise<VehicleSwap[]> {
    const params = new URLSearchParams();

    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.vehicleId)
      params.append("vehicleId", filters.vehicleId.toString());
    if (filters.reason) params.append("reason", filters.reason);
    if (filters.bookingId)
      params.append("bookingId", filters.bookingId.toString());

    const response = await apiClient.get(
      `/branchManager/dashboard/swap-history?${params.toString()}`,
    );
    return response.data.data;
  },
};
