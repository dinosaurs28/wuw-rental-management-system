import type { OfferDiscountType, OfferLinkType } from "@/services/offers.service";

// Shared helpers for offer posters (#15): the landing hero slider and the
// Branch Manager's "Offers & banners" page. Business time is IST.

const IST_OFFSET_MS = 330 * 60 * 1000;
const IST = "Asia/Kolkata";

const rupees = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "20% off, up to ₹500" / "₹200 off". */
export function formatOfferDiscount(coupon: {
  discountType: OfferDiscountType;
  value: number;
  maxDiscountCap: number | null;
}): string {
  if (coupon.discountType === "PERCENTAGE") {
    const pct = `${Number(coupon.value.toFixed(2))}% off`;
    return coupon.maxDiscountCap != null && coupon.maxDiscountCap > 0
      ? `${pct}, up to ${rupees(coupon.maxDiscountCap)}`
      : pct;
  }
  return `${rupees(coupon.value)} off`;
}

/** "31 Oct" (IST); adds the year when it isn't the current one. */
export function formatIstDay(iso: string): string {
  const d = new Date(iso);
  const sameYear =
    new Intl.DateTimeFormat("en-IN", { timeZone: IST, year: "numeric" }).format(d) ===
    new Intl.DateTimeFormat("en-IN", { timeZone: IST, year: "numeric" }).format(new Date());
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** "3 Oct 2026, 10:00 am" (IST). */
export function formatIstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** ISO instant → IST wall time "YYYY-MM-DDTHH:mm" (what the BM endpoints and datetime inputs use). */
export function isoToIstInput(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** IST wall time "YYYY-MM-DDTHH:mm" → epoch ms (NaN when malformed). */
export function istInputToMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN;
  return new Date(`${value}:00.000Z`).getTime() - IST_OFFSET_MS;
}

/** Now in IST wall time, to the minute. */
export function istInputNow(): string {
  return isoToIstInput(new Date().toISOString());
}

/** IST wall time `days` from today at 23:59. */
export function istInputEndOfDayIn(days: number): string {
  const day = isoToIstInput(new Date(Date.now() + days * 86_400_000).toISOString()).slice(0, 10);
  return `${day}T23:59`;
}

/** Website route of a poster's link: group page, single vehicle, or the vehicles list. */
export function offerHref(linkType: OfferLinkType | null, linkTarget: string | null): string {
  if (linkTarget && linkType === "VEHICLE_GROUP") return `/vehicle/group/${encodeURIComponent(linkTarget)}`;
  if (linkTarget && linkType === "VEHICLE") return `/vehicle/${encodeURIComponent(linkTarget)}`;
  return "/vehicles";
}

/** Copies text to the clipboard (with a fallback for non-secure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
