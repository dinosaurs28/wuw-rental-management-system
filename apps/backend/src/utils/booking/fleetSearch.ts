/**
 * Search box of the branch manager's Fleet tab (Out on Road, Upcoming, Recovery):
 * a rent matches when one of its vehicles' registration number contains the
 * text, or every word of it is in the vehicle's "make model" or registration
 * number — case-insensitive, partial, spaces and hyphens ignored in the
 * registration number.
 *
 * parseFleetQuery / vehicleMatchesFleetQuery are pure (fleetSearch.test.ts);
 * the endpoints turn a query into the matching vehicle ids of the branch and
 * filter (and count) their bookings by them, so pagination and the tab counts
 * reflect the search.
 */
import { prisma, type Prisma } from "@repo/database/client";

/** Longest search text kept. */
export const FLEET_QUERY_MAX = 60;

export interface FleetQuery {
  /** Lower-cased text with spaces collapsed, for make / model */
  text: string;
  /** Upper-cased letters and digits only, for the registration number ("" when none) */
  reg: string;
}

const regKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The `q` query param as a search, or null when absent / blank. */
export function parseFleetQuery(raw: unknown): FleetQuery | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ").slice(0, FLEET_QUERY_MAX).toLowerCase();
  if (!text) return null;
  return { text, reg: regKey(text) };
}

/**
 * Whether a vehicle matches the search: the registration number contains it
 * (spaces / hyphens ignored), or every word of it is in "make model" or the
 * registration number ("toyota cry", "swift ka20").
 */
export function vehicleMatchesFleetQuery(
  v: { make: string; model: string; regNo: string },
  q: FleetQuery,
): boolean {
  const name = `${v.make} ${v.model}`.toLowerCase();
  const reg = regKey(v.regNo);
  if (q.reg.length > 0 && reg.includes(q.reg)) return true;
  return q.text.split(" ").every((word) => {
    if (name.includes(word)) return true;
    const key = regKey(word);
    return key.length > 0 && reg.includes(key);
  });
}

/** Ids of the branch's vehicles (including retired ones still on rents) matching the search. */
export async function fleetSearchVehicleIds(branchId: number, q: FleetQuery): Promise<number[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: { branchId },
    select: { id: true, make: true, model: true, regNo: true },
  });
  return vehicles.filter((v) => vehicleMatchesFleetQuery(v, q)).map((v) => v.id);
}

/** Bookings with one of these vehicles (an empty list matches none). */
export const fleetSearchBookingWhere = (vehicleIds: number[]): Prisma.BookingWhereInput => ({
  items: { some: { vehicleId: { in: vehicleIds } } },
});
