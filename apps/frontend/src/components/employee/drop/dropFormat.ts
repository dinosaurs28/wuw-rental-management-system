/** Formatting shared by the drop screen's rental-time, late-return and bill blocks. */

/**
 * Whole minutes as "N hours" when exact, else "N h M min" ("M min" under an hour).
 * Never rounded, so Original + Extended + Late always adds up to the Total shown.
 */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${rest} min`;
}

/** "02 Oct, 06:05 pm" in IST (business days are IST). */
export function formatIstDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** "06:05 pm" in IST. */
export function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Server money string (2 dp) as "₹1,234.50". */
export function inr(value: string | number): string {
  const n = Number(value);
  return `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "18%" from a server rate (number or "18.00"). */
export function formatRate(rate: string | number): string {
  const n = Number(rate);
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}
