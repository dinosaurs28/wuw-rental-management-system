/**
 * "Reschedule rental period" (client TODO 4, Nov 2026): the pure rules behind
 * the Fleet / BM move of a CONFIRMED booking (not picked up yet) to a new
 * start AND a new end picked independently. No database (unit-tested in
 * reschedule-period.test.ts); reschedule.service.ts does the I/O.
 *
 * Times: both ≥ now − RESCHEDULE_PERIOD_PAST_SLACK_MINUTES (5 min, the late
 * pickup slack — the start may be "now" for an immediate pickup), end > start,
 * at least 12 hours (a 12-hour package held to the branch's closing on the
 * pickup day counts as 12 hours) — a monthly booking keeps its 30–180-day rule
 * (assertBookingWindow).
 *
 * Price: both windows are priced NOW by the pricing engine with the booking's
 * own terms (coupon locked in, stored weekend days and festival rules, the
 * monthly plan for a MONTHLY booking, 12-hour package flag). The difference
 * new − old is added to what the booking stores (items, totals, GST split,
 * snapshot), so a pure shift with the same weekday / weekend / festival mix
 * costs exactly the same (difference 0), whatever happened to the rates since
 * it was booked, and anything folded in after booking (a pickup discount) is
 * kept.
 *
 * Money: totalFinal moves by the difference. An open balance (advance booking,
 * balance not collected) moves with it; a higher price on a booking already
 * paid re-opens a balance for the difference (collected at pickup by the usual
 * pickup bill / remaining-balance flow); a lower price leaves the over-payment
 * on the booking (paid > owed) to be refunded through the existing paths — the
 * Fleet / BM "Refund to customer" and the BM settlement. Nothing is refunded
 * automatically.
 */
import Decimal from "decimal.js";
import { LATE_PICKUP_GRACE_MINUTES } from "@repo/schemas";

const ZERO = new Decimal(0);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** A start / end may be this much before the request (the late-pickup slack). */
export const RESCHEDULE_PERIOD_PAST_SLACK_MINUTES = LATE_PICKUP_GRACE_MINUTES;
/** Shortest rental period a reschedule may set (a held-to-closing 12-hour package aside). */
export const RESCHEDULE_PERIOD_MIN_HOURS = 12;

export type PeriodTimeCode =
  | "RESCHEDULE_IN_PAST"
  | "RESCHEDULE_END_IN_PAST"
  | "RESCHEDULE_END_NOT_AFTER_START"
  | "RESCHEDULE_PERIOD_TOO_SHORT"
  | "RESCHEDULE_NO_CHANGE";

export interface PeriodTimeProblem {
  code: PeriodTimeCode;
  message: string;
}

/**
 * The time rules of a new period (no branch hours / window / availability —
 * those come after). `clampedHalfDay` = the window is the 12-hour package held
 * to closing on the pickup day (shorter on the clock, billed as 12 hours).
 */
export function periodTimeProblem(input: {
  now: Date;
  current: { startAt: Date; endAt: Date };
  startAt: Date;
  endAt: Date;
  monthly: boolean;
  clampedHalfDay: boolean;
}): PeriodTimeProblem | null {
  const { now, current, startAt, endAt } = input;
  const floor = now.getTime() - RESCHEDULE_PERIOD_PAST_SLACK_MINUTES * MINUTE_MS;
  if (
    Math.abs(startAt.getTime() - current.startAt.getTime()) < MINUTE_MS &&
    Math.abs(endAt.getTime() - current.endAt.getTime()) < MINUTE_MS
  ) {
    return {
      code: "RESCHEDULE_NO_CHANGE",
      message: "That is the booking's current rental period. Change the start or the end.",
    };
  }
  if (startAt.getTime() < floor) {
    return {
      code: "RESCHEDULE_IN_PAST",
      message: "The new start time has already passed. Choose a start from now on.",
    };
  }
  if (endAt.getTime() < floor) {
    return {
      code: "RESCHEDULE_END_IN_PAST",
      message: "The new end time has already passed. Choose an end after the start.",
    };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return {
      code: "RESCHEDULE_END_NOT_AFTER_START",
      message: "The return must be after the pickup.",
    };
  }
  if (!input.monthly && !input.clampedHalfDay && endAt.getTime() - startAt.getTime() < RESCHEDULE_PERIOD_MIN_HOURS * HOUR_MS) {
    return {
      code: "RESCHEDULE_PERIOD_TOO_SHORT",
      message: `A rental is at least ${RESCHEDULE_PERIOD_MIN_HOURS} hours. Choose a later return.`,
    };
  }
  return null;
}

// ── Price difference ─────────────────────────────────────────────────────────

type Dec = Decimal | number | string | { toString(): string };
const d = (v: Dec | null | undefined) => new Decimal(v == null ? "0" : v.toString());

/** The engine figures of one vehicle for one window (a PricingResult subset). */
export interface PricedWindow {
  basePrice: Dec;
  discountAmount: Dec;
  durationDiscountAmount: Dec;
  couponDiscountAmount: Dec;
  taxAmount: Dec;
  cgstAmount: Dec;
  sgstAmount: Dec;
  /** Rent incl. GST after discounts (deposit excluded) */
  finalTotal: Dec;
  gross: { price: Dec; durationDiscount: Dec; couponDiscount: Dec; manualDiscount: Dec; discount: Dec; total: Dec };
  rentWithoutGst: Dec;
}

/** new − old of every money field the booking stores for one vehicle. */
export interface ItemDelta {
  base: Decimal;
  discount: Decimal;
  durationDiscount: Decimal;
  couponDiscount: Decimal;
  tax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  final: Decimal;
  grossPrice: Decimal;
  grossDurationDiscount: Decimal;
  grossCouponDiscount: Decimal;
  grossManualDiscount: Decimal;
  grossDiscount: Decimal;
  grossTotal: Decimal;
  rentWithoutGst: Decimal;
}

export function itemDelta(before: PricedWindow, after: PricedWindow): ItemDelta {
  const sub = (pick: (p: PricedWindow) => Dec) => d(pick(after)).sub(d(pick(before))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    base: sub((p) => p.basePrice),
    discount: sub((p) => p.discountAmount),
    durationDiscount: sub((p) => p.durationDiscountAmount),
    couponDiscount: sub((p) => p.couponDiscountAmount),
    tax: sub((p) => p.taxAmount),
    cgst: sub((p) => p.cgstAmount),
    sgst: sub((p) => p.sgstAmount),
    final: sub((p) => p.finalTotal),
    grossPrice: sub((p) => p.gross.price),
    grossDurationDiscount: sub((p) => p.gross.durationDiscount),
    grossCouponDiscount: sub((p) => p.gross.couponDiscount),
    grossManualDiscount: sub((p) => p.gross.manualDiscount),
    grossDiscount: sub((p) => p.gross.discount),
    grossTotal: sub((p) => p.gross.total),
    rentWithoutGst: sub((p) => p.rentWithoutGst),
  };
}

export function sumDeltas(deltas: ItemDelta[]): ItemDelta {
  const keys = [
    "base", "discount", "durationDiscount", "couponDiscount", "tax", "cgst", "sgst", "final",
    "grossPrice", "grossDurationDiscount", "grossCouponDiscount", "grossManualDiscount", "grossDiscount",
    "grossTotal", "rentWithoutGst",
  ] as const;
  const out = Object.fromEntries(keys.map((k) => [k, ZERO])) as unknown as ItemDelta;
  for (const delta of deltas) for (const k of keys) out[k] = out[k].add(delta[k]);
  return out;
}

/** A stored BookingItem's money fields after the difference (the invariant base − discount + tax = final holds). */
export function applyItemDelta(
  item: { baseTotal: Dec; discountAmount: Dec; taxAmount: Dec; cgstAmount: Dec; sgstAmount: Dec; finalTotal: Dec },
  delta: ItemDelta,
) {
  const baseTotal = d(item.baseTotal).add(delta.base);
  const discountAmount = d(item.discountAmount).add(delta.discount);
  return {
    baseTotal,
    discountAmount,
    discountPercent: baseTotal.gt(0) ? discountAmount.div(baseTotal).mul(100).toDecimalPlaces(2) : ZERO,
    taxAmount: d(item.taxAmount).add(delta.tax),
    cgstAmount: d(item.cgstAmount).add(delta.cgst),
    sgstAmount: d(item.sgstAmount).add(delta.sgst),
    finalTotal: d(item.finalTotal).add(delta.final),
  };
}

/** Adds `by` to a stored snapshot number (absent stays absent). */
function bump(target: Record<string, unknown>, key: string, by: Decimal) {
  if (target[key] == null || by.isZero()) return;
  const v = Number(target[key]);
  if (!Number.isFinite(v)) return;
  target[key] = Number(new Decimal(v).add(by).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
}

/**
 * pricingSnapshot after the move: each item's money moves by its difference
 * and takes the new window's breakdown (period, billed as, free km, weekend /
 * festival); the totals move by the summed difference. Keys the snapshot never
 * had are not added (an older snapshot keeps its shape).
 */
export function snapshotAfterReprice(
  pricingSnapshot: unknown,
  items: Array<{ vehicleId: number; delta: ItemDelta; days: number; breakdown: Record<string, unknown> }>,
): Record<string, unknown> {
  const snapshot = { ...((pricingSnapshot ?? {}) as Record<string, unknown>) };
  if (Array.isArray(snapshot.items)) {
    snapshot.items = snapshot.items.map((raw: unknown, index: number) => {
      if (!raw || typeof raw !== "object") return raw;
      const row = { ...(raw as Record<string, unknown>) };
      const entry = items.find((i) => i.vehicleId === row.vehicleId) ?? items[index];
      if (!entry) return raw;
      const x = entry.delta;
      bump(row, "baseTotal", x.base);
      bump(row, "discountAmount", x.discount);
      bump(row, "durationDiscountAmount", x.durationDiscount);
      bump(row, "couponDiscountAmount", x.couponDiscount);
      bump(row, "taxAmount", x.tax);
      bump(row, "cgstAmount", x.cgst);
      bump(row, "sgstAmount", x.sgst);
      bump(row, "finalTotal", x.final);
      bump(row, "rentInclGst", x.grossPrice);
      bump(row, "durationDiscountInclGst", x.grossDurationDiscount);
      bump(row, "couponDiscountInclGst", x.grossCouponDiscount);
      bump(row, "manualDiscountInclGst", x.grossManualDiscount);
      bump(row, "discountInclGst", x.grossDiscount);
      bump(row, "rentAfterDiscountInclGst", x.grossTotal);
      bump(row, "rentWithoutGst", x.rentWithoutGst);
      bump(row, "gst", x.tax);
      bump(row, "cgst", x.cgst);
      bump(row, "sgst", x.sgst);
      if (row.days != null) row.days = entry.days;
      const { weekend: _w, festival: _f, ...previous } = (row.pricingBreakdown ?? {}) as Record<string, unknown>;
      row.pricingBreakdown = { ...previous, ...entry.breakdown };
      return row;
    });
  }
  const total = sumDeltas(items.map((i) => i.delta));
  if (snapshot.totals && typeof snapshot.totals === "object") {
    const totals = { ...(snapshot.totals as Record<string, unknown>) };
    bump(totals, "grandBaseTotal", total.base);
    bump(totals, "grandDiscountTotal", total.discount);
    bump(totals, "grandTaxTotal", total.tax);
    bump(totals, "grandCGSTTotal", total.cgst);
    bump(totals, "grandSGSTTotal", total.sgst);
    bump(totals, "grandFinalTotal", total.final);
    bump(totals, "grandDurationDiscountTotal", total.durationDiscount);
    bump(totals, "grandCouponDiscountTotal", total.couponDiscount);
    bump(totals, "grandRentInclGst", total.grossPrice);
    bump(totals, "grandDurationDiscountInclGst", total.grossDurationDiscount);
    bump(totals, "grandCouponDiscountInclGst", total.grossCouponDiscount);
    bump(totals, "grandManualDiscountInclGst", total.grossManualDiscount);
    bump(totals, "grandDiscountInclGst", total.grossDiscount);
    bump(totals, "grandRentAfterDiscountInclGst", total.grossTotal);
    bump(totals, "grandRentWithoutGst", total.rentWithoutGst);
    snapshot.totals = totals;
  }
  return snapshot;
}

// ── Balance ──────────────────────────────────────────────────────────────────

export interface BalanceFlags {
  isAdvancePayment: boolean;
  advanceAmount: Dec;
  remainingBalance: Dec;
  remainingPaidAt: Date | null;
  totalFinal: Dec;
}

export interface BalanceOutcome {
  newTotalFinal: Decimal;
  /** Booking fields to write (only those that change) */
  update: {
    totalFinal: Decimal;
    remainingBalance?: Decimal;
    isAdvancePayment?: boolean;
    advanceAmount?: Decimal;
    /** true = clear remainingPaidAt / remainingPaymentId / remainingPaidDuring (a balance re-opened) */
    reopenBalance?: boolean;
  };
  /** Balance the pickup bill collects after the move */
  dueAtPickup: Decimal;
  /** Paid beyond the new total, to refund through the existing paths (never auto-refunded) */
  refundable: Decimal;
  /** OPEN_BALANCE_ADJUSTED | BALANCE_REOPENED | OVERPAID | COVERED_BY_OVERPAYMENT | UNCHANGED */
  kind: "OPEN_BALANCE_ADJUSTED" | "BALANCE_REOPENED" | "OVERPAID" | "COVERED_BY_OVERPAYMENT" | "UNCHANGED";
}

/**
 * Where the difference lands. `overpaidNow` = what the booking was already
 * paid beyond what it owed before the move (netConfirmed − totalOwed, ≥ 0).
 *
 *  - open balance (advance, not collected): remainingBalance += difference;
 *    below 0 it stays 0 and the rest is refundable.
 *  - balance closed (paid in full / balance collected / on credit):
 *      higher → an earlier over-payment covers it first; the rest re-opens the
 *      balance (isAdvancePayment, advanceAmount = new total − balance, so
 *      "paid" reads as everything before the move);
 *      lower  → refundable (paid > owed).
 */
export function balanceAfterReprice(b: BalanceFlags, difference: Dec, overpaidNow: Dec = 0): BalanceOutcome {
  const diff = d(difference).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const oldTotal = d(b.totalFinal);
  const newTotalFinal = oldTotal.add(diff).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const overpaid = Decimal.max(ZERO, d(overpaidNow));
  const open = b.isAdvancePayment && !b.remainingPaidAt;
  const remaining = open ? Decimal.max(ZERO, d(b.remainingBalance)) : ZERO;

  if (diff.isZero()) {
    return { newTotalFinal, update: { totalFinal: newTotalFinal }, dueAtPickup: remaining, refundable: overpaid, kind: "UNCHANGED" };
  }

  if (open) {
    const next = remaining.add(diff);
    const balance = Decimal.max(ZERO, next).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      newTotalFinal,
      update: { totalFinal: newTotalFinal, remainingBalance: balance },
      dueAtPickup: balance,
      refundable: Decimal.max(ZERO, next.negated()).add(overpaid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      kind: next.lt(0) ? "OVERPAID" : "OPEN_BALANCE_ADJUSTED",
    };
  }

  if (diff.gt(0)) {
    const due = Decimal.max(ZERO, diff.sub(overpaid)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (due.isZero()) {
      return {
        newTotalFinal,
        update: { totalFinal: newTotalFinal },
        dueAtPickup: ZERO,
        refundable: overpaid.sub(diff).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        kind: "COVERED_BY_OVERPAYMENT",
      };
    }
    return {
      newTotalFinal,
      update: {
        totalFinal: newTotalFinal,
        remainingBalance: due,
        isAdvancePayment: true,
        advanceAmount: newTotalFinal.sub(due),
        reopenBalance: true,
      },
      dueAtPickup: due,
      refundable: ZERO,
      kind: "BALANCE_REOPENED",
    };
  }

  return {
    newTotalFinal,
    update: { totalFinal: newTotalFinal },
    dueAtPickup: ZERO,
    refundable: overpaid.add(diff.negated()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    kind: "OVERPAID",
  };
}

/**
 * Suffix for the one-per-booking idempotency keys of a remaining-balance payment
 * (`remaining:<method>:<booking>`): a balance re-opened by a period reschedule
 * (BALANCE_REOPENED, recorded as `reopenedFrom` in pricingSnapshot.reschedules)
 * is collected again, so each re-opening gets its own key (`:r1`, `:r2` …).
 * "" for a booking never re-opened — the keys stay exactly as before.
 */
export function remainingKeySuffix(pricingSnapshot: unknown): string {
  const history = (pricingSnapshot as { reschedules?: unknown } | null | undefined)?.reschedules;
  if (!Array.isArray(history)) return "";
  const reopened = history.filter((r) => !!r && typeof r === "object" && (r as { reopenedFrom?: unknown }).reopenedFrom).length;
  return reopened > 0 ? `:r${reopened}` : "";
}
