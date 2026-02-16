import apiClient from "@/lib/axios";


export interface PricingDiscountSlab {
    id: number;
    days: number;
    multiplier: number;
    branchId: number;
    categoryId: number;
    category?: {
        id: number;
        name: string;
    }
}

export interface PricingDiscountPayload {
    categoryId: number;
    days: number;
    multiplier: number;
}

export const pricingService = {
    getDiscounts: () =>
        apiClient.get<{ data: PricingDiscountSlab[] }>(`/branchManager/dashboard/pricing`),

    createDiscount: (data: PricingDiscountPayload) =>
        apiClient.post(`/branchManager/dashboard/pricing`, data),

    updateDiscount: (id: number, data: Partial<PricingDiscountPayload>) =>
        apiClient.put(`/branchManager/dashboard/pricing/${id}`, data),

    deleteDiscount: (id: number) =>
        apiClient.delete(`/branchManager/dashboard/pricing/${id}`)
};
