import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export interface GSTRule {
  id?: number;
  gstNumber: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

export const fetchGSTRule = async (): Promise<GSTRule | null> => {
  try {
    const response = await axios.get(`${API_URL}/branchManager/gst`, {
      withCredentials: true,
    });
    return response.data.data;
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
};

export const createOrUpdateGSTRule = async (data: Omit<GSTRule, "id">) => {
  const response = await axios.post(`${API_URL}/branchManager/gst`, data, {
    withCredentials: true,
  });
  return response.data;
};
