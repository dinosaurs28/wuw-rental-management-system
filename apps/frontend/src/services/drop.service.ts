import apiClient from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DropDamageSeverity = "Minor" | "Moderate" | "Severe";

/** A damage recorded by staff while the car is being dropped. */
export interface DropDamage {
  publicId: string;
  area: string;
  severity: DropDamageSeverity;
  description: string;
  amount: string;
  chargeCustomer: boolean;
  /**
   * On this drop's bill (session branches: chargeCustomer && amount > 0). False in
   * branches without payment sessions — the manager charges it later via review.
   */
  billedAtDrop: boolean;
  /** The damaged vehicle (bookings can carry more than one). */
  vehicle?: { publicId: string; make: string; model: string; regNo: string } | null;
  photos: { publicId: string; url: string }[];
  createdAt: string;
}

export interface CreateDropDamagePayload {
  /** Required when the booking has more than one vehicle (400 VEHICLE_REQUIRED). */
  vehiclePublicId?: string;
  area: string;
  severity: DropDamageSeverity;
  description: string;
  amount: number;
  /** false = company expense (recorded, not billed). */
  chargeCustomer: boolean;
  /** File publicIds from POST /employee/damage/upload. */
  damageImageIds: string[];
}

/**
 * Codes the drop endpoints attach (`{ message, code }`) when a drop rule blocks
 * the request. Counter codes (SHIFT_REQUIRED, UTR) live in lib/counterErrors.
 */
const DROP_ERROR_CODES = [
  "LICENSE_NOT_RETURNED",
  "DISCOUNT_EXCEEDS_CHARGES",
  "VEHICLE_REQUIRED",
  // compute: an extension is still awaiting payment / the free-km plan can't be resolved
  "EXTENSION_PENDING",
  "KM_ALLOWANCE_UNAVAILABLE",
  // record-payment: damages or the booked period changed since the last compute
  "DROP_BILL_STALE",
] as const;

export type DropErrorCode = (typeof DROP_ERROR_CODES)[number];

export function dropErrorCode(err: unknown): DropErrorCode | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return DROP_ERROR_CODES.find((c) => c === code);
}

// ── Service ───────────────────────────────────────────────────────────────────

export const dropService = {
  /** Damages recorded at drop for this booking. */
  listDamages: async (bookingPublicId: string): Promise<DropDamage[]> => {
    const { data } = await apiClient.get<{ data: { damages: DropDamage[] } }>(
      `/employee/bookings/${bookingPublicId}/return/damages`,
    );
    return data.data.damages;
  },

  /** Record a damage while the booking is PICKED_UP. Session branches recompute the RETURN session afterwards. */
  addDamage: async (
    bookingPublicId: string,
    payload: CreateDropDamagePayload,
  ): Promise<DropDamage> => {
    const { data } = await apiClient.post<{ data: { damage: DropDamage } }>(
      `/employee/bookings/${bookingPublicId}/return/damages`,
      payload,
    );
    return data.data.damage;
  },

  /** Remove a drop damage (only before the drop completes). Session branches recompute afterwards. */
  deleteDamage: async (
    bookingPublicId: string,
    damagePublicId: string,
  ): Promise<{ message: string }> => {
    const { data } = await apiClient.delete<{ message: string }>(
      `/employee/bookings/${bookingPublicId}/return/damages/${damagePublicId}`,
    );
    return data;
  },
};
