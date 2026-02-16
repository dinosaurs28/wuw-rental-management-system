import { useQuery } from '@tanstack/react-query';
import { fetchVehicleDetails, type VehicleDetailsParams } from '@/services/vehicle.service';

export const useVehicleDetails = (
    vehicleId: string,
    startDate: Date | null,
    endDate: Date | null
) => {
    const formatDate = (date: Date) => {
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    };

    const params: VehicleDetailsParams = {
        vehicleId,
        startDate: startDate ? formatDate(new Date(startDate)) : undefined,
        endDate: endDate ? formatDate(new Date(endDate)) : undefined,
    };

    return useQuery({
        queryKey: ['vehicle-details', vehicleId, params.startDate, params.endDate],
        queryFn: () => fetchVehicleDetails(params),
        enabled: !!vehicleId,
        staleTime: 60 * 1000, // 1 minute cache
    });
};
