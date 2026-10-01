import type { OverdueReturn, OverdueReturnState } from "@/types/overdueReturns";

// Helpers shared by the Fleet (employee dashboard) and Branch Manager (Fleet
// Status) overdue-return views (#8).

/** 45 → "45m", 200 → "3h 20m", 3120 → "2d 4h". */
export function formatOverdueDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / (24 * 60));
  const h = Math.floor((minutes % (24 * 60)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Minutes overdue right now: the server's figure at `serverNow`, advanced by
 * the local time elapsed since the response arrived (so browser clock skew
 * never matters).
 */
export function liveOverdueMinutes(
  row: Pick<OverdueReturn, "overdueMinutes">,
  fetchedAt: number,
  now: number,
): number {
  return Math.max(0, row.overdueMinutes + Math.floor(Math.max(0, now - fetchedAt) / 60_000));
}

/**
 * returnState as of `liveMinutes`: a row the server marked IN_GRACE becomes
 * OVERDUE once it is more than graceMinutes late (same rule as the server).
 */
export function liveReturnState(
  row: Pick<OverdueReturn, "returnState" | "graceMinutes">,
  liveMinutes: number,
): OverdueReturnState {
  if (row.returnState === "IN_GRACE" && row.graceMinutes !== null && liveMinutes > row.graceMinutes) {
    return "OVERDUE";
  }
  return row.returnState;
}

export const RETURN_STATE_META: Record<
  OverdueReturnState,
  { label: string; className: string; color: string; bg: string }
> = {
  OVERDUE: {
    label: "Overdue",
    className: "bg-red-50 text-red-700 border-red-200",
    color: "#b91c1c",
    bg: "#fef2f2",
  },
  IN_GRACE: {
    label: "In grace",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    color: "#b45309",
    bg: "#fffbeb",
  },
  AWAITING_MANAGER_CONFIRMATION: {
    label: "Awaiting manager",
    className: "bg-gray-100 text-gray-600 border-gray-200",
    color: "#4b5563",
    bg: "#f3f4f6",
  },
  RETURN_IN_PROGRESS: {
    label: "Return in progress",
    className: "bg-gray-100 text-gray-600 border-gray-200",
    color: "#4b5563",
    bg: "#f3f4f6",
  },
};

/** States where the vehicle is already back at the branch (not counted as overdue). */
export const isVehicleBack = (state: OverdueReturnState) =>
  state === "AWAITING_MANAGER_CONFIRMATION" || state === "RETURN_IN_PROGRESS";

// en-US: short months are always three letters ("Sep", not en-GB's "Sept").
const IST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/** ISO → "01 Oct 2026, 06:05 PM" in IST, whatever the browser's timezone. */
export function formatIstDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const parts = IST_PARTS.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()}`;
}

/** `tel:` link for a stored phone number (digits and a leading + only). */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
