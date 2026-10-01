/**
 * Display helpers shared by the vehicle-swap screens (Fleet + BM).
 * Amounts arrive as Decimal strings — always Number() them.
 */

/** `?swap=1` on the Fleet return page opens the swap dialog (dashboard row "Swap" link). */
export const SWAP_QUERY_PARAM = "swap";

/** Fleet return page with the swap dialog opened. */
export function employeeSwapPath(bookingPublicId: string): string {
  return `/employee/dashboard/return/${bookingPublicId}?${SWAP_QUERY_PARAM}=1`;
}

/** BM swap page for a booking. */
export function managerSwapPath(bookingPublicId: string): string {
  return `/manager/bookings/${bookingPublicId}/swap-vehicle`;
}

/**
 * Show a "Swap" entry on a list row: an active rental that isn't overdue
 * (the server asks for an extension first — BOOKING_OVERDUE).
 */
export function canSwapVehicle(booking: { status: string; endAt: string }): boolean {
  return booking.status === "PICKED_UP" && new Date(booking.endAt).getTime() > Date.now();
}

/** Fuel is recorded in bars, 1–10 (same scale as pickup / drop). */
export const SWAP_FUEL_BAR_OPTIONS = Array.from({ length: 10 }, (_, i) => String(i + 1));

/** Largest odometer the form accepts (the column is a 32-bit int). */
export const SWAP_MAX_ODOMETER = 9_999_999;

/** Decimal string / number → number, or null when missing or not a number. */
export function swapAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ₹1,299.91 — always 2 dp (the price difference is pro-rated to the paisa). */
export function formatSwapRupees(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatKm(value: number): string {
  return `${new Intl.NumberFormat("en-IN").format(value)} km`;
}

/** "PICKED_UP" → mid-rental, "CONFIRMED" → before pickup, anything else (older rows) → null. */
export function swapStageLabel(bookingStatusAtSwap: string | null | undefined): string | null {
  if (bookingStatusAtSwap === "PICKED_UP") return "Mid-rental";
  if (bookingStatusAtSwap === "CONFIRMED") return "Before pickup";
  return null;
}

/** Refusals that mean the chosen car is no longer a valid pick — reload the list and choose again. */
export const SWAP_PICK_AGAIN_CODES: ReadonlySet<string> = new Set([
  "VEHICLE_NOT_AVAILABLE",
  "VEHICLE_NOT_FOUND",
  "VEHICLE_TYPE_MISMATCH",
  "CATEGORY_DOWNGRADE",
  "SAME_VEHICLE",
  "BOOKING_CHANGED",
]);

/** `code` of a `{ success:false, code, message }` error response. */
export function swapErrorCode(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } } | undefined)?.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}

/** Whole-number odometer within range, or null. */
export function parseOdometer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n <= SWAP_MAX_ODOMETER ? n : null;
}
