import { getBlockedForAnyWindowIds, getUnavailableVehicleIds } from "../availability/availabilityBatch.js";
import { isListableStatus } from "../availability/vehicleEligibility.js";

/** Make/model comparison form used in group keys. */
export function normalizeGroupStr(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

/** groupKey = make__model__categoryId__branchId (make/model may contain spaces). */
export function parseGroupKey(
  groupKey: string,
): { make: string; model: string; categoryId: number; branchId: number } | null {
  const idx = groupKey.indexOf("__");
  if (idx === -1) return null;
  const rest1 = groupKey.slice(idx + 2);
  const idx2 = rest1.indexOf("__");
  if (idx2 === -1) return null;
  const rest2 = rest1.slice(idx2 + 2);
  const idx3 = rest2.indexOf("__");
  if (idx3 === -1) return null;
  const make = groupKey.slice(0, idx);
  const model = rest1.slice(0, idx2);
  const categoryId = parseInt(rest2.slice(0, idx3), 10);
  const branchId = parseInt(rest2.slice(idx3 + 2), 10);
  if (isNaN(categoryId) || isNaN(branchId)) return null;
  return { make, model, categoryId, branchId };
}

/**
 * One rule for "which unit of a make/model group do we price and quote the
 * advance from", shared by the group-details endpoints and booking creation
 * so the advance shown is the advance charged:
 *
 *   the lowest-odometer listable vehicle (AVAILABLE or OUT_FOR_RENTAL — see
 *   vehicleEligibility.ts) that is free for the dates (CONFIRMED/PICKED_UP
 *   bookings, overdue rentals, hand-set OUT_FOR_RENTAL and Redis holds all
 *   count as busy), one at the branch (AVAILABLE) before one still out.
 *
 * A car out on a rental qualifies for a window after that rental ends — only
 * when no unit at the branch is free, so a late return rarely holds up the
 * next pickup; one that is overdue never does. Without dates, the same order
 * over the listable vehicles not blocked for every window. Callers pass the
 * group's vehicles already filtered to the make/model and sorted by odometer
 * ascending.
 */
export async function pickGroupRepresentative<
  T extends { id: number; publicId: string; status: string },
>(
  groupVehicles: T[],
  start: Date | null,
  end: Date | null,
): Promise<{ representative: T | null; available: T[] }> {
  const bookable = groupVehicles.filter((v) => isListableStatus(v.status));
  if (bookable.length === 0) return { representative: null, available: [] };

  if (!start || !end) {
    const blocked = await getBlockedForAnyWindowIds(bookable.map((v) => v.id));
    const available = bookable.filter((v) => !blocked.has(v.id));
    const representative = available.find((v) => v.status === "AVAILABLE") ?? available[0] ?? null;
    return { representative, available };
  }

  const unavailable = await getUnavailableVehicleIds(
    bookable.map((v) => v.id),
    start,
    end,
    new Map(bookable.map((v) => [v.id, v.publicId])),
  );
  const available = bookable.filter((v) => !unavailable.has(v.id));
  const representative = available.find((v) => v.status === "AVAILABLE") ?? available[0] ?? null;
  return { representative, available };
}
