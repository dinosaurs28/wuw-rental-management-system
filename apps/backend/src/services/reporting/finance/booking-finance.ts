/**
 * Admin Reports — finance business rules (sections 2.1–2.5), shared with the
 * Dashboard and the bookings / fleet reports. Read-only.
 *
 * REVENUE (per booking, recognised on Booking.startAt; statuses CONFIRMED,
 * PICKED_UP, RETURNED — the same booking set as the Sales report):
 *   rent    = totalFinal − totalDeposit — GST-inclusive rent after every discount,
 *             including confirmed extensions (they are folded into totalFinal).
 *             The refundable category deposit inside totalFinal is not revenue.
 *   extras  = computeBookingOwed().returnCharges — drop bill charges net of the
 *             drop discount (+ edits), legacy return charges, drop damage outside
 *             a bill. No GST on them since Oct 3 2026 (older ones keep theirs).
 *   revenue = rent + extras − refundsGoodwill ("Refund to customer" beyond what was
 *             owed back: given up, so it lowers revenue as it lowers what is owed).
 *   bookingValue = totalFinal — the Sales report / old dashboard figure, kept so a
 *             page can reconcile: bookingValue − deposit + extras − goodwill = revenue.
 *   gst     = BookingItem CGST+SGST + confirmed-extension GST (Sales "GST" column).
 *   Cancelled bookings carry no revenue (as in Sales). Normal refunds (over-payment,
 *   cancellation) never were revenue, so revenue is not "net of refunds".
 *
 * DUES (per booking, snapshot "as of now"):
 *   due = max(0, totalOwed − netConfirmed) — identical to financial-state amountDue
 *         (CONFIRMED money in less refunds paid out; COLLECTED cash awaiting the
 *         manager's confirmation is NOT yet paid — shown as pendingConfirmation).
 *   Bookings: not deleted, PICKED_UP or RETURNED, or CONFIRMED with startAt ≤ now.
 *   A CONFIRMED booking still to start is "not yet due" (left out of totals).
 *   Due from: startAt (rent is owed at pickup); for a RETURNED booking whose unpaid
 *   part is all drop charges (due ≤ extras), returnedAt ?? endAt.
 *   Age = IST calendar days from the due date to today; buckets 0–7, 8–30, 31+.
 */
import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { prisma, BookingStatus } from "@repo/database/client";
import { computeBookingsOwed, summarizeBookingMoney, type BookingOwed } from "../../payment/booking-owed.service.js";
import { getExtraOutputGstByBooking } from "../../../utils/reporting/extraOutputGst.js";
import { normaliseParts, isGatewayPayment } from "../../financials/payment-type.js";
import { SYSTEM_TIMEZONE } from "../../timezone/timezone.service.js";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: { toString(): string } | number | null | undefined): number =>
  v == null ? 0 : Number(v.toString());

export const REVENUE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
  BookingStatus.RETURNED,
];

// ── Revenue ───────────────────────────────────────────────────────────────────

export interface BookingRevenue {
  rent: number;
  extras: number;
  deposit: number;
  goodwill: number;
  revenue: number;
  bookingValue: number;
  gst: number;
}

/** The revenue arithmetic (pure). Cancelled / hold bookings → all zero except bookingValue. */
export function revenueOf(
  b: { status: string; totalFinal: number; totalDeposit: number },
  owed: Pick<BookingOwed, "returnCharges" | "refundsGoodwill"> | null | undefined,
  gst = 0,
): BookingRevenue {
  if (!(REVENUE_STATUSES as string[]).includes(b.status)) {
    return { rent: 0, extras: 0, deposit: 0, goodwill: 0, revenue: 0, bookingValue: r2(b.totalFinal), gst: 0 };
  }
  const deposit = r2(b.totalDeposit);
  const rent = r2(b.totalFinal - deposit);
  const extras = r2(num(owed?.returnCharges));
  const goodwill = r2(num(owed?.refundsGoodwill));
  return {
    rent,
    extras,
    deposit,
    goodwill,
    revenue: r2(rent + extras - goodwill),
    bookingValue: r2(b.totalFinal),
    gst: r2(gst),
  };
}

/** Revenue per booking id (ids are selected by the caller — startAt anchor). */
export async function getRevenueByBooking(ids: number[]): Promise<Map<number, BookingRevenue>> {
  const out = new Map<number, BookingRevenue>();
  if (ids.length === 0) return out;
  const [bookings, owed, extGst] = await Promise.all([
    prisma.booking.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        totalFinal: true,
        totalDeposit: true,
        items: { select: { cgstAmount: true, sgstAmount: true } },
      },
    }),
    computeBookingsOwed(ids),
    getExtraOutputGstByBooking(ids),
  ]);
  for (const b of bookings) {
    const ext = extGst.get(b.id);
    const gst =
      b.items.reduce((s, it) => s + num(it.cgstAmount) + num(it.sgstAmount), 0) +
      (ext ? ext.extensionCgst + ext.extensionSgst : 0);
    out.set(
      b.id,
      revenueOf({ status: b.status, totalFinal: num(b.totalFinal), totalDeposit: num(b.totalDeposit) }, owed.get(b.id), gst),
    );
  }
  return out;
}

// ── Dues ──────────────────────────────────────────────────────────────────────

export type AgingBucket = "0-7" | "8-30" | "31+";
export const AGING_BUCKETS: AgingBucket[] = ["0-7", "8-30", "31+"];
export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-7": "0–7 days",
  "8-30": "8–30 days",
  "31+": "Over 30 days",
};

export function agingBucket(ageDays: number): AgingBucket {
  if (ageDays <= 7) return "0-7";
  if (ageDays <= 30) return "8-30";
  return "31+";
}

/** IST calendar days from `from` to `now` (0 = same IST day; never negative). */
export function istAgeDays(from: Date, now: Date): number {
  const a = DateTime.fromJSDate(from, { zone: SYSTEM_TIMEZONE }).startOf("day");
  const b = DateTime.fromJSDate(now, { zone: SYSTEM_TIMEZONE }).startOf("day");
  return Math.max(0, Math.round(b.diff(a, "days").days));
}

export interface BookingDue {
  totalOwed: number;
  netConfirmed: number;
  /** COLLECTED money in awaiting the manager's confirmation (not yet counted as paid) */
  pendingConfirmation: number;
  due: number;
  /** due > 0 and counted in dues (false for not-yet-due / cancelled) */
  counted: boolean;
  notYetDue: boolean;
  dueFrom: Date | null;
  dueFromBasis: "PICKUP" | "RETURN" | null;
  ageDays: number | null;
  bucket: AgingBucket | null;
}

/** The dues arithmetic (pure). */
export function dueOf(
  b: { status: string; startAt: Date; endAt: Date; returnedAt: Date | null; deletedAt?: Date | null },
  owed: Pick<BookingOwed, "totalOwed" | "returnCharges">,
  money: { netConfirmed: number; pending: number },
  now: Date,
): BookingDue {
  const totalOwed = r2(num(owed.totalOwed));
  const netConfirmed = r2(money.netConfirmed);
  const due = r2(Math.max(0, totalOwed - netConfirmed));
  const base = { totalOwed, netConfirmed, pendingConfirmation: r2(money.pending), due };
  const eligible =
    !b.deletedAt &&
    (b.status === BookingStatus.PICKED_UP ||
      b.status === BookingStatus.RETURNED ||
      b.status === BookingStatus.CONFIRMED);
  const notYetDue = eligible && b.status === BookingStatus.CONFIRMED && b.startAt.getTime() > now.getTime();
  if (!eligible || notYetDue || due <= 0) {
    return { ...base, counted: false, notYetDue: notYetDue && due > 0, dueFrom: null, dueFromBasis: null, ageDays: null, bucket: null };
  }
  const extras = r2(num(owed.returnCharges));
  const fromReturn = b.status === BookingStatus.RETURNED && extras > 0 && due <= extras;
  const dueFrom = fromReturn ? (b.returnedAt ?? b.endAt) : b.startAt;
  const ageDays = istAgeDays(dueFrom, now);
  return {
    ...base,
    counted: true,
    notYetDue: false,
    dueFrom,
    dueFromBasis: fromReturn ? "RETURN" : "PICKUP",
    ageDays,
    bucket: agingBucket(ageDays),
  };
}

/** Confirmed / pending money per booking (summarizeBookingMoney over one query). */
export async function getMoneyByBooking(ids: number[]) {
  const txns = ids.length
    ? await prisma.paymentTransaction.findMany({
        where: { bookingId: { in: ids } },
        select: { bookingId: true, purpose: true, status: true, totalAmount: true },
      })
    : [];
  const by = new Map<number, typeof txns>();
  for (const t of txns) {
    const l = by.get(t.bookingId);
    if (l) l.push(t);
    else by.set(t.bookingId, [t]);
  }
  const out = new Map<number, ReturnType<typeof summarizeBookingMoney>>();
  for (const id of ids) out.set(id, summarizeBookingMoney(by.get(id) ?? []));
  return out;
}

export async function getDuesByBooking(ids: number[], now: Date = new Date()): Promise<Map<number, BookingDue>> {
  const out = new Map<number, BookingDue>();
  if (ids.length === 0) return out;
  const [bookings, owed, money] = await Promise.all([
    prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, startAt: true, endAt: true, returnedAt: true, deletedAt: true },
    }),
    computeBookingsOwed(ids),
    getMoneyByBooking(ids),
  ]);
  for (const b of bookings) {
    const o = owed.get(b.id);
    const m = money.get(b.id);
    if (!o || !m) continue;
    out.set(b.id, dueOf(b, o, { netConfirmed: num(m.netConfirmed), pending: num(m.pending) }, now));
  }
  return out;
}

// ── Payment modes ─────────────────────────────────────────────────────────────

export type ModeKey = "CASH" | "UPI" | "BANK_TRANSFER" | "GATEWAY";
export const MODE_KEYS: ModeKey[] = ["CASH", "UPI", "BANK_TRANSFER", "GATEWAY"];
export const MODE_LABELS: Record<ModeKey, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  GATEWAY: "Online gateway (Razorpay)",
};

export interface ModeSplit {
  CASH: number;
  UPI: number;
  BANK_TRANSFER: number;
  GATEWAY: number;
}

/**
 * Mode split of one PaymentTransaction. The system records only cash vs online
 * (cashAmount / onlineAmount, normalised like BM Financials) plus the free-text
 * onlineGateway:
 *   onlineGateway BANK_TRANSFER / "bank…"           → Bank transfer
 *   a gateway name (razorpay, …; isGatewayPayment)  → Online gateway — card, UPI and
 *       netbanking inside Razorpay are NOT told apart (the instrument isn't stored),
 *       so "Card" is never shown as its own figure
 *   anything else (UPI, null, counter QR)           → UPI
 */
export function modeSplitOf(t: {
  method: string;
  totalAmount: number;
  cashAmount: number;
  onlineAmount: number;
  onlineGateway: string | null;
}): ModeSplit {
  const { cash, online } = normaliseParts({ method: t.method, total: t.totalAmount, cash: t.cashAmount, online: t.onlineAmount });
  const out: ModeSplit = { CASH: cash, UPI: 0, BANK_TRANSFER: 0, GATEWAY: 0 };
  if (online > 0) {
    const g = t.onlineGateway ?? "";
    if (/bank/i.test(g)) out.BANK_TRANSFER = online;
    else if (isGatewayPayment(g)) out.GATEWAY = online;
    else out.UPI = online;
  }
  return out;
}

export function modeLabelOf(split: ModeSplit): string {
  const parts = MODE_KEYS.filter((k) => split[k] > 0).map((k) => MODE_LABELS[k]);
  return parts.length ? parts.join(" + ") : "—";
}

export const toDecimal = (n: number) => new Decimal(n);
