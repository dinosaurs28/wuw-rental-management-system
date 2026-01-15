import { useQuery } from '@tanstack/react-query';
import { fetchVehicles,  } from '../services/vehicle.service';

export const useVehicles = (filters: any) => {
    return useQuery({
        queryKey: ['vehicles', filters],
        queryFn: () => fetchVehicles(filters),
        staleTime: 60 * 1000, // 1 minute cache
    });
};
