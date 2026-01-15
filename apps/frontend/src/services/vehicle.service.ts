import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export interface VehicleFilters {
    branch?: string;
    category?: string;
    search?: string;
    sort?: 'price_low_to_high' | 'price_high_to_low';
    limit?: number;
    offset?: number;
}

export interface VehicleImage {
    file: {
        url: string;
    };
}

export interface Vehicle {
    publicId: string;
    make: string;
    model: string;
    category: string;
    branch: string;
    imageUrl: VehicleImage[];
    pricing: {
        daily: number;
    };
}

export interface VehiclesResponse {
    count: number;
    data: Vehicle[];
}

export const fetchVehicles = async (filters: VehicleFilters): Promise<VehiclesResponse> => {
    try {
        const params = new URLSearchParams();

        if (filters.branch) params.append('branch', filters.branch);
        if (filters.category) params.append('category', filters.category);
        if (filters.search) params.append('search', filters.search);
        if (filters.sort) params.append('sort', filters.sort);
        if (filters.limit) params.append('limit', filters.limit.toString());
        if (filters.offset) params.append('offset', filters.offset.toString());

        const response = await axios.get<VehiclesResponse>(`${API_URL}/public/vehicles`, { params });
        return response.data;
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        throw error;
    }
};
