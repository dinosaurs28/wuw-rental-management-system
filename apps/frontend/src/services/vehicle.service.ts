import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export interface VehicleFilters {
    branch?: string;
    category?: string;
    search?: string;
    status?: string;
    sort?: 'price_low_to_high' | 'price_high_to_low';
    limit?: number;
    offset?: number;
    start?: string;
    end?: string;
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
    category: {
        name: string;
    };
    branch: string;
    status?: string;
    regNo?: string;
    imageUrl: VehicleImage[];
    baseDailyPrice: number;
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
        if (filters.status) params.append('status', filters.status);
        if (filters.limit) params.append('limit', filters.limit.toString());
        if (filters.offset) params.append('offset', filters.offset.toString());
        if (filters.start) params.append('start', filters.start);
        if (filters.end) params.append('end', filters.end);

        const response = await axios.get<VehiclesResponse>(`${API_URL}/branchManager/dashboard/vehicles`, {
            params,
            withCredentials: true
        });
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
    year: number;
    regNo: string;
    odo: number;
    status: 'AVAILABLE' | 'MAINTENANCE' | 'NOT_AVAILABLE';
    availability?: boolean;
    seats?: number;
    transmission?: string;
    fuelType?: string;
    description?: string;
    categoryId: number;
    category?: {
        name: string;
    };
    branch?: string;
    branchId: string;
    images: {
        id: string;
        publicId: string;
        isThumbnail: boolean;
        file: {
            url: string;
        }
    }[];
    baseDailyPrice: number;
    insuranceRecords?: {
        policyNumber: string;
        provider: string;
        validTill: string;
    }[];
    policyNumber?: string;
    provider?: string;
    insuranceExpiry?: string;
    pricing: {
        daily: number;
    };
    baseTotal: number;
    discountPrice: number;
    totalDays: number;
    deposit: number;
}

export interface VehicleDetailsResponse {
    message?: string;
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
        const response = await axios.get<VehicleDetailsResponse>(`${API_URL}/branchManager/dashboard/vehicle/${params.vehicleId}`, {
            params: {
                startDate: params.startDate,
                endDate: params.endDate
            },
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching vehicle details:', error);
        throw error;
    }
};

export const createVehicle = async (formData: FormData): Promise<VehicleDetailsResponse> => {
    try {
        const response = await axios.post<VehicleDetailsResponse>(`${API_URL}/branchManager/dashboard/vehicle/add`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error creating vehicle:', error);
        throw error;
    }
};

export const updateVehicle = async (vehicleId: string, formData: FormData): Promise<VehicleDetailsResponse> => {
    try {
        const response = await axios.put<VehicleDetailsResponse>(`${API_URL}/branchManager/dashboard/vehicle/edit/${vehicleId}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            withCredentials: true
        });
        return response.data;
    } catch (error) {
        console.error('Error updating vehicle:', error);
        throw error;
    }
};

export const deleteVehicle = async (vehicleId: string): Promise<void> => {
    try {
        await axios.delete(`${API_URL}/branchManager/dashboard/vehicle/${vehicleId}`, { withCredentials: true });
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        throw error;
    }
};

export interface Category {
    id: number;
    publicId: string;
    name: string;
}

export interface CategoriesResponse {
    data: Category[];
}

export interface InsuranceExpiryReportItem {
    publicId: string;
    vehicleName: string;
    thumbnail: string | null;
    make: string;
    model: string;
    regNo: string;
    policyNumber: string;
    provider: string;
    expiryDate: string;
}

export interface InsuranceExpiryReportResponse {
    data: InsuranceExpiryReportItem[];
}

export const fetchInsuranceExpiryReport = async (search?: string): Promise<InsuranceExpiryReportItem[]> => {
    try {
        const params = new URLSearchParams();
        if (search) params.append('q', search);

        const response = await axios.get<InsuranceExpiryReportResponse>(`${API_URL}/branchManager/dashboard/reports/insurance-expiry`, {
            params,
            withCredentials: true
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching insurance expiry report:', error);
        return [];
    }
};

export const fetchVehicleCategories = async (): Promise<Category[]> => {
    try {
        const response = await axios.get<CategoriesResponse>(`${API_URL}/branchManager/dashboard/categories`, {
            withCredentials: true
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
};
