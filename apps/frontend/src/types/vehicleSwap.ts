export const SwapReason = {
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  MAINTENANCE: 'MAINTENANCE',
  UPGRADE: 'UPGRADE',
  DOWNGRADE: 'DOWNGRADE',
  DAMAGE: 'DAMAGE',
  OTHER: 'OTHER',
} as const;

export type SwapReason = typeof SwapReason[keyof typeof SwapReason];

export interface AvailableVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: string;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
  images: Array<{ url: string | null }>;
}

export interface VehicleSwapRequest {
  newVehicleId: number;
  reason: SwapReason;
  reasonNotes?: string;
  markOriginalForMaintenance?: boolean;
  originalVehicleNotes?: string;
}

export interface VehicleSwap {
  id: number;
  publicId: string;
  bookingId: number;
  originalVehicleId: number;
  newVehicleId: number;
  reason: SwapReason;
  reasonNotes?: string;
  originalVehicleStatus?: string;
  originalVehicleNotes?: string;
  swappedAt: string;
  originalVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
  };
  newVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
  };
  swappedBy?: {
    name: string;
    email: string;
  };
}

export interface SwapHistoryFilters {
  startDate?: string;
  endDate?: string;
  vehicleId?: number;
  reason?: SwapReason;
  bookingId?: number;
}
