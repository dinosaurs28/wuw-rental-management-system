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
  /** Current odometer — prefill for the replacement's start odometer */
  odo?: number;
  /** Last recorded Vehicle.fuelLevel, as a percent */
  fuelLevel?: number;
  /** The same reading as fuel bars "1".."10" (null = unknown) — prefill for the start fuel */
  fuelBars?: string | null;
  insuranceExpiry?: string;
  /** Same category as the current car (listed first) */
  sameCategory?: boolean;
  /** Higher category than the current car */
  isUpgrade?: boolean;
  /** Has a FASTag: its opening balance is entered at a mid-rental swap */
  hasFastag?: boolean;
  /** Photos of this car a mid-rental swap needs (swapContext.photosRequired) */
  photoRequirement?: SwapPhotoRequirement;
  /**
   * Pro-rated difference of the GST-inclusive rents for the rest of the rental
   * (item 17; 2 dp string, never negative), charged with no GST added (item 8).
   * null = the cars couldn't be priced (see pricingError).
   */
  priceDifference?: string | null;
}

/** A labelled shot of the branch's pickup capture config. */
export interface SwapCaptureField {
  name: string;
  required: boolean;
}

/**
 * Photos of the replacement a mid-rental swap needs: every required labelled
 * shot of the branch's pickup capture config for its category, and at least
 * minPhotos photos in all (4 when the branch has no config).
 */
export interface SwapPhotoRequirement {
  fields: SwapCaptureField[];
  minPhotos: number;
}

/** A photo of the replacement taken at a mid-rental swap. */
export interface SwapPhoto {
  publicId: string;
  captureLabel: string | null;
  url: string;
  mime: string;
  createdAt?: string;
}

/** PRE_PICKUP = booking CONFIRMED; ACTIVE_RENTAL = booking PICKED_UP (car with the customer). */
export type SwapStage = "PRE_PICKUP" | "ACTIVE_RENTAL";

/** `swapContext` of GET …/available-vehicles. */
export interface SwapContext {
  bookingId: string;
  bookingStatus: string;
  stage: SwapStage;
  /** All four handover readings are required (ACTIVE_RENTAL) */
  readingsRequired: boolean;
  startAt: string;
  endAt: string;
  /** The price difference covers [remainingFrom, endAt] */
  remainingFrom: string;
  /** Share of the rental still ahead, 4 dp string */
  remainingFraction: string;
  currentVehicle: {
    id: number;
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    categoryId: number;
    categoryName: string;
    categoryRank: number;
    odo: number;
    /** Percent */
    fuelLevel: number;
    /** fuelLevel as bars "1".."10"; null = unknown */
    fuelBars?: string | null;
    /** Has a FASTag: its closing balance is entered at a mid-rental swap */
    hasFastag?: boolean;
  };
  /** Photos of the replacement + FASTag balances are required (ACTIVE_RENTAL; absent on older servers) */
  photosRequired?: boolean;
  /** The returning car's end odometer can't be below this (null = unknown, no check) */
  currentVehicleStartOdometer: number | null;
  pricingAvailable: boolean;
  pricingError: string | null;
  /** "Charge customer" default per reason */
  chargeDifferenceDefaults: Record<SwapReason, boolean>;
}

/**
 * A same-type car of the branch that can't take over the booking, with the
 * server's reason (shown collapsed under the candidates). Absent from older servers.
 */
export interface SwapExcludedVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  categoryName: string;
  code: string;
  reason: string;
}

export interface SwapCandidates {
  vehicles: AvailableVehicle[];
  excluded: SwapExcludedVehicle[];
  swapContext: SwapContext | null;
}

/**
 * Initial "Charge customer" value per reason when the list carries no
 * swapContext (customer-asked swaps are proposed as billed). The server never
 * bills a request that omits `chargeDifference`, so always send it.
 */
export const DEFAULT_CHARGE_DIFFERENCE: Record<SwapReason, boolean> = {
  CUSTOMER_REQUEST: true,
  UPGRADE: true,
  MAINTENANCE: false,
  DAMAGE: false,
  DOWNGRADE: false,
  OTHER: false,
};

export const SWAP_REASON_LABELS: Record<SwapReason, string> = {
  CUSTOMER_REQUEST: "Customer Request",
  MAINTENANCE: "Maintenance",
  UPGRADE: "Upgrade",
  DOWNGRADE: "Downgrade",
  DAMAGE: "Damage",
  OTHER: "Other",
};

export interface VehicleSwapRequest {
  newVehicleId: number;
  reason: SwapReason;
  reasonNotes?: string;
  markOriginalForMaintenance?: boolean;
  originalVehicleNotes?: string;
  /** Handover readings — all four required when the booking is PICKED_UP */
  originalVehicleEndOdometer?: number;
  originalVehicleFuelLevel?: string;
  newVehicleStartOdometer?: number;
  newVehicleFuelLevel?: string;
  /** Bill the price difference at drop; omitted = not billed */
  chargeDifference?: boolean;
  /**
   * Photos of the replacement (pickup photo uploads). The web always sends it
   * (empty before pickup): the server then requires them mid-rental.
   */
  replacementPhotos?: Array<{ fileId: string; label?: string }>;
  /** FASTag balances (₹) at a mid-rental swap, for cars with a FASTag */
  oldVehicleFastagBalance?: number;
  newVehicleFastagBalance?: number;
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
  /** "CONFIRMED" = before pickup, "PICKED_UP" = mid-rental, null = older rows */
  bookingStatusAtSwap?: string | null;
  originalVehicleEndOdometer?: number | null;
  originalVehicleFuelLevel?: string | null;
  newVehicleStartOdometer?: number | null;
  newVehicleFuelLevel?: string | null;
  /** Decimal string (e.g. "1500" or "299.91"): difference of the GST-inclusive rents, billed with no GST added */
  priceDifference?: string | null;
  /** false with a priceDifference > 0 = waived */
  chargeDifference?: boolean;
  /** Decimal strings: the returning car's / the replacement's FASTag balance at a mid-rental swap */
  oldVehicleFastagBalance?: string | null;
  newVehicleFastagBalance?: string | null;
  /** Photos of the replacement taken at the swap */
  photos?: SwapPhoto[];
  /** A mid-rental swap with no photo of the replacement (older app build) */
  photosMissing?: boolean;
  booking?: {
    publicId: string;
    status: string;
    customer?: { user: { name: string; email: string | null } };
  };
  originalVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    category?: { name: string; rank: number };
  };
  newVehicle?: {
    publicId: string;
    make: string;
    model: string;
    regNo: string;
    category?: { name: string; rank: number };
  };
  swappedBy?: {
    publicId?: string;
    name: string;
    email: string;
    role?: string;
  };
}

export interface SwapHistoryFilters {
  startDate?: string;
  endDate?: string;
  vehicleId?: number;
  reason?: SwapReason;
  bookingId?: number;
}
