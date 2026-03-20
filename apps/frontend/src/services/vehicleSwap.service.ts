import apiClient from "@/lib/axios";
import type {
  AvailableVehicle,
  VehicleSwapRequest,
  VehicleSwap,
  SwapHistoryFilters,
} from "@/types/vehicleSwap";

export interface BookingVehicleDetails {
  make: string;
  model: string;
  regNo: string;
  image: string | null;
}

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
