import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL

export interface BranchResponse {
    message: string;
    data: {
        publicId: string;
        name: string;
    }[];
}

export const fetchBranches = async (): Promise<BranchResponse['data']> => {
    try {
        const response = await axios.get<BranchResponse>(`${API_URL}/public/branches`);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching branches:', error);
        throw error;
    }
};
