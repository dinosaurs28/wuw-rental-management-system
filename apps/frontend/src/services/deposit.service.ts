import axios from "axios";
import type { Category } from "./vehicle.service";

const API_URL = import.meta.env.VITE_API_URL;

export interface DepositRule {
  id: number;
  branchId: number;
  categoryId: number;
  amount: string; // Decimal comes as string
  category: Category;
}

export const fetchDepositRules = async (): Promise<DepositRule[]> => {
  const response = await axios.get(
    `${API_URL}/branchManager/dashboard/deposit-rules`,
    {
      withCredentials: true,
    },
  );
  return response.data.data;
};

export const createDepositRule = async (data: {
  categoryId: number;
  amount: number;
}) => {
  const response = await axios.post(
    `${API_URL}/branchManager/dashboard/deposit-rules`,
    data,
    {
      withCredentials: true,
    },
  );
  return response.data;
};

export const updateDepositRule = async (
  id: number,
  data: { amount: number },
) => {
  const response = await axios.put(
    `${API_URL}/branchManager/dashboard/deposit-rules/${id}`,
    data,
    {
      withCredentials: true,
    },
  );
  return response.data;
};

export const deleteDepositRule = async (id: number) => {
  const response = await axios.delete(
    `${API_URL}/branchManager/dashboard/deposit-rules/${id}`,
    {
      withCredentials: true,
    },
  );
  return response.data;
};
