/**
 * Formatting helpers shared by the cash shift screens (BM list, Fleet history,
 * shift banner). Shift money arrives as 2-dp strings; business days are IST.
 */

export const IST_TIME_ZONE = "Asia/Kolkata";

const istDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE });

/** Today's IST calendar date (YYYY-MM-DD). Never toISOString(): that is the UTC date. */
export function istToday(): string {
  return istDayFormatter.format(new Date());
}

/** Moves an IST calendar date (YYYY-MM-DD) by whole days. */
export function addIstDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  // Pure calendar arithmetic on a UTC date, so the browser's zone never matters.
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** "Wed, 01 Oct 2026" for an IST calendar date. */
export function formatIstDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "01 Oct, 09:30 am" in IST. */
export function formatIstDateTime(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "09:30 am" in IST. */
export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Money in paise, for exact comparisons. NaN-safe (unparseable ⇒ 0). */
export function toPaise(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const moneyFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "₹ 1,850.00". `null`/`undefined` render "—" (e.g. closing cash while a
 * shift is OPEN), so a missing figure is never shown as ₹0.00.
 */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `₹ ${moneyFormatter.format(toPaise(value) / 100)}`;
}

export type VarianceTone = "short" | "over" | "even";

/** Signed variance: negative = SHORT, positive = OVER. Null while OPEN. */
export function describeVariance(
  value: string | number | null | undefined,
): { text: string; tone: VarianceTone; label: string } | null {
  if (value === null || value === undefined || value === "") return null;
  const paise = toPaise(value);
  const abs = moneyFormatter.format(Math.abs(paise) / 100);
  if (paise < 0) return { text: `−₹ ${abs}`, tone: "short", label: "short" };
  if (paise > 0) return { text: `+₹ ${abs}`, tone: "over", label: "over" };
  return { text: `₹ ${abs}`, tone: "even", label: "matched" };
}

export const VARIANCE_TONE_CLASSES: Record<VarianceTone, string> = {
  short: "text-red-600",
  over: "text-amber-600",
  even: "text-green-700",
};

/**
 * Sanitises a typed rupee amount: digits and one dot, at most 2 decimals.
 * Returns null when the keystroke should be rejected.
 */
export function sanitizeRupeeInput(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  return /^\d*(\.\d{0,2})?$/.test(cleaned) ? cleaned : null;
}

export const LEGACY_VARIANCE_NOTE =
  "Closed under the old rule (variance vs BM-confirmed cash), so the stored expected and variance don't add up with the other figures. Totals leave its variance out.";
