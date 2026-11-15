/**
 * Pickup / drop photos and damage of one vehicle in its rent history (Nov 14
 * 2026, client: "for each vehicle's rent history, show the Pickup images and
 * Drop images, and any Damage, in the same history"). Pure rules, no database.
 *
 * Which photos show THIS car on a rental:
 *  - PRE_DELIVERY (the pickup photos) show the car handed over at pickup — the
 *    first mid-rental swap's original car, else the booking's car.
 *  - SWAP_DELIVERY photos of a mid-rental swap show its replacement (newVehicle).
 *  - POST_RETURN (the drop photos) show the car that came back — the booking's
 *    car now (a swap moves the booking item to the replacement). A car swapped
 *    out mid-rental has no drop photos (the swap photographs the replacement only).
 *  - Damage reports carry their vehicle: only this car's.
 */

export interface MidRentalSwapRef {
  id: number;
  originalVehicleId: number;
  newVehicleId: number;
  swappedAt: Date;
}

export interface VehicleMediaScope {
  /** The pickup photos (PRE_DELIVERY) show this car */
  pickup: boolean;
  /** Mid-rental swaps that handed this car over (their SWAP_DELIVERY photos), in time order */
  swapIds: number[];
  /** The drop photos (POST_RETURN) show this car — it came back at the drop */
  drop: boolean;
}

export function vehicleMediaScope(input: {
  vehicleId: number;
  /** The booking's cars now (BookingItem.vehicleId) */
  itemVehicleIds: number[];
  /** The booking's mid-rental swaps (any order) */
  midSwaps: MidRentalSwapRef[];
  /** The drop is complete (booking RETURNED) */
  returned: boolean;
}): VehicleMediaScope {
  const v = input.vehicleId;
  const swaps = [...input.midSwaps].sort((a, b) => a.swappedAt.getTime() - b.swappedAt.getTime());
  const involving = swaps.filter((s) => s.originalVehicleId === v || s.newVehicleId === v);
  const onBookingNow = input.itemVehicleIds.includes(v);
  // At pickup: its first swap took it off the rental, or no swap ever touched it
  const pickup = involving.length > 0 ? involving[0]!.originalVehicleId === v : onBookingNow;
  return {
    pickup,
    swapIds: swaps.filter((s) => s.newVehicleId === v).map((s) => s.id),
    drop: input.returned && onBookingNow,
  };
}

/** One photo as the rent history sends it. */
export interface RentHistoryPhoto {
  publicId: string;
  /** The capture-config shot ("Front", "Left Side"), when taken that way */
  label: string | null;
  url: string;
  /** Smaller copy for thumbnails; `url` when there is none */
  displayUrl: string;
  takenAt: string;
  mime: string;
}

/** A damage note's readable parts (DamageReport.notes is free JSON). */
export interface DamageNoteView {
  area: string | null;
  description: string | null;
  items: Array<{ area: string | null; severity: string | null; description: string | null }>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function damageNoteView(notes: unknown): DamageNoteView {
  if (typeof notes === "string") return { area: null, description: str(notes), items: [] };
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return { area: null, description: null, items: [] };
  const n = notes as Record<string, unknown>;
  const items = Array.isArray(n.damages)
    ? n.damages
        .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
        .map((d) => ({ area: str(d.area), severity: str(d.severity), description: str(d.description) }))
        .filter((d) => d.area || d.severity || d.description)
    : [];
  return {
    area: str(n.area),
    description: str(n.description) ?? str(n.notes) ?? str(n.remarks),
    items,
  };
}

/**
 * Where a damage charge stands:
 *  - COMPANY_EXPENSE  staff chose company expense — never billed to the customer
 *  - PAID             billed on the drop bill and that drop bill was settled
 *  - ON_DROP_BILL     billed on the drop bill, the drop not settled yet
 *  - AWAITING_REVIEW  the manager hasn't reviewed (priced / charged) it yet
 *  - CHARGED          the manager charged it in the damage review
 *  - NOT_CHARGED      reviewed with nothing charged, or rejected
 */
export type DamagePaymentStatus =
  | "COMPANY_EXPENSE"
  | "PAID"
  | "ON_DROP_BILL"
  | "AWAITING_REVIEW"
  | "CHARGED"
  | "NOT_CHARGED";

export function damagePaymentStatus(input: {
  /** dropDamageBilling(report): DROP / MANAGER / COMPANY, null = not raised at drop */
  billing: "DROP" | "MANAGER" | "COMPANY" | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** The amount charged (finalCost ?? estimatedCost) */
  amount: number;
  /** A completed drop bill carries it (billedOnCompletedDrop) */
  billedOnCompletedDrop: boolean;
}): DamagePaymentStatus {
  if (input.billing === "COMPANY") return "COMPANY_EXPENSE";
  if (input.billing === "DROP") return input.billedOnCompletedDrop ? "PAID" : "ON_DROP_BILL";
  if (input.status === "PENDING") return "AWAITING_REVIEW";
  if (input.status === "APPROVED" && input.amount > 0) return "CHARGED";
  return "NOT_CHARGED";
}
