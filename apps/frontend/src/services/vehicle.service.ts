import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export interface VehicleFilters {
    branch?: string;
    category?: string;
    search?: string;
    sort?: 'price_low_to_high' | 'price_high_to_low';
    start?: string;
    end?: string;
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
        if (filters.start) params.append('start', filters.start);
        if (filters.end) params.append('end', filters.end);
        if (filters.limit) params.append('limit', filters.limit.toString());
        if (filters.offset) params.append('offset', filters.offset.toString());

        const response = await axios.get<VehiclesResponse>(`${API_URL}/public/vehicles`, { params });
        return response.data;
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        throw error;
    }
};

// Vehicle Details Types
export interface VehicleDetails {
    publicId: string;
    make: string;
    model: string;
    status: 'AVAILABLE' | 'NOT_AVAILABLE';
    category: string;
    branch: string;
    images: string[];
    pricing: {
        daily: number;
    };
    deposit: number;
    availability: boolean;
    totalDays: number;
    baseTotal: number;
    discountPrice: number;
}

export interface VehicleDetailsResponse {
    message: string;
    data: VehicleDetails;
}

export interface VehicleDetailsParams {
    vehicleId: string;
    startDate?: string;
    endDate?: string;
}

export const fetchVehicleDetails = async (
    params: VehicleDetailsParams
): Promise<VehicleDetailsResponse> => {
    try {
        const queryParams = new URLSearchParams();

        if (params.startDate) queryParams.append('start', params.startDate);
        if (params.endDate) queryParams.append('end', params.endDate);

        const url = queryParams.toString()
            ? `${API_URL}/public/vehicles/${params.vehicleId}?${queryParams.toString()}`
            : `${API_URL}/public/vehicles/${params.vehicleId}`;

        const response = await axios.get<VehicleDetailsResponse>(url);
        return response.data;
    } catch (error) {
        console.error('Error fetching vehicle details:', error);
        throw error;
    }
};
