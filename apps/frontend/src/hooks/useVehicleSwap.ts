import { useState, useCallback } from "react";
import { vehicleSwapService } from "@/services/vehicleSwap.service";
import type {
  AvailableVehicle,
  VehicleSwapRequest,
  VehicleSwap,
} from "@/types/vehicleSwap";
import { toast } from "sonner";

export const useVehicleSwap = (bookingId: string) => {
  const [availableVehicles, setAvailableVehicles] = useState<
    AvailableVehicle[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAvailableVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicles = await vehicleSwapService.getAvailableVehicles(bookingId);
      setAvailableVehicles(vehicles);
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message || "Failed to fetch available vehicles";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  const performSwap = useCallback(
    async (swapRequest: VehicleSwapRequest): Promise<VehicleSwap | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await vehicleSwapService.performSwap(
          bookingId,
          swapRequest,
        );
        toast.success("Vehicle swapped successfully!");
        return result;
      } catch (err: any) {
        const errorMsg =
          err.response?.data?.message || "Failed to swap vehicle";
        setError(errorMsg);
        toast.error(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [bookingId],
  );

  return {
    availableVehicles,
    loading,
    error,
    fetchAvailableVehicles,
    performSwap,
  };
};
