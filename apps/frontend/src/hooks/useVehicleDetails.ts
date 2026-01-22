import { useQuery } from '@tanstack/react-query';
import { fetchVehicleDetails, type VehicleDetailsParams } from '@/services/vehicle.service';

export const useVehicleDetails = (
    vehicleId: string,
    startDate: Date | null,
    endDate: Date | null
) => {
    const params: VehicleDetailsParams = {
        vehicleId,
        startDate: startDate ? new Date(startDate).toISOString().split('T')[0] : undefined,
        endDate: endDate ? new Date(endDate).toISOString().split('T')[0] : undefined,
    };

    return useQuery({
        queryKey: ['vehicle-details', vehicleId, params.startDate, params.endDate],
        queryFn: () => fetchVehicleDetails(params),
        enabled: !!vehicleId,
        staleTime: 60 * 1000, // 1 minute cache
    });
};
