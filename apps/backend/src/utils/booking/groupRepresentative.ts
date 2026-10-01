import { getUnavailableVehicleIds } from "../availability/availabilityBatch.js";

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
 * advance from", shared by the public group-details endpoint and customer
 * booking creation so the advance shown is the advance charged:
 *
 *   the lowest-odometer AVAILABLE vehicle that is free for the dates
 *   (CONFIRMED/PICKED_UP bookings and Redis holds both count as busy).
 *
 * Without dates, the lowest-odometer AVAILABLE vehicle. Callers pass the group's
 * vehicles already filtered to the make/model and sorted by odometer ascending.
 */
export async function pickGroupRepresentative<
  T extends { id: number; publicId: string; status: string },
>(
  groupVehicles: T[],
  start: Date | null,
  end: Date | null,
): Promise<{ representative: T | null; available: T[] }> {
  const bookable = groupVehicles.filter((v) => v.status === "AVAILABLE");
  if (!start || !end || bookable.length === 0) {
    return { representative: bookable[0] ?? null, available: bookable };
  }

  const unavailable = await getUnavailableVehicleIds(
    bookable.map((v) => v.id),
    start,
    end,
    new Map(bookable.map((v) => [v.id, v.publicId])),
  );
  const available = bookable.filter((v) => !unavailable.has(v.id));
  return { representative: available[0] ?? null, available };
}
