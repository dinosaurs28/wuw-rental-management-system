/**
 * Cash shift rules (Oct 2026: the branch manager closes shifts). Pure — no
 * database — so they are unit-tested directly (cash-shift-rules.test.ts) and
 * shared by the close transaction, the API checks and the payment paths.
 *
 * Expected cash (what the manager must receive at close)
 * ──────────────────────────────────────────────────────
 *   expected cash = opening float
 *                 + cash collected   (cash part of every IN payment linked to the
 *                                     shift that is COLLECTED or CONFIRMED)
 *                 − cash refunded    (cash part of every CONFIRMED refund paid out
 *                                     of the shift: OVERPAYMENT_REFUND /
 *                                     CANCELLATION_REFUND)
 *
 * REJECTED, VOIDED, FAILED, INITIATED and REFUNDED rows count nowhere. UPI /
 * card money (the online part) never enters the drawer: it is reported as
 * non-cash, for information only. The opening float is included because the
 * executive hands back the whole drawer. Computed by the server at close,
 * inside the transaction that locks the shift — never typed by anyone.
 *
 *   difference = cash received (typed by the manager) − expected cash
 *                (negative = short, positive = over; a note is required ≠ 0)
 */
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";

export const REFUND_PURPOSES = ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"] as const;
/** Statuses whose money is real (in the drawer / in the account). */
export const LIVE_STATUSES = ["COLLECTED", "CONFIRMED"] as const;

export type CashShiftErrorCode =
  | "SHIFT_NOT_FOUND"
  | "SHIFT_ALREADY_OPEN"
  | "SHIFT_NOT_OPEN"
  | "SHIFT_NOT_YOURS"
  | "SHIFT_OTHER_BRANCH"
  | "SHIFT_CLOSE_MANAGER_ONLY"
  | "DISCREPANCY_EXPLANATION_REQUIRED"
  | "EXPECTED_CASH_CHANGED"
  | "SHIFT_NOT_FLAGGED"
  | "SHIFT_LOCKED"
  | "RECONCILE_FORBIDDEN"
  | "INVALID_DATE_RANGE";

/** Controllers reply with `status` and `toJSON()` (the shared 4xx error contract). */
export class CashShiftError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: CashShiftErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CashShiftError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

/**
 * A non-manager on the manager's "Verify & close". (Since Nov 2026 an executive
 * closes their own cash-free shift on the employee route — selfCloseEligibility.)
 */
export const FE_CLOSE_MESSAGE = "Only your branch manager can verify and close this shift. Hand over your cash to close it.";

const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | number | string | null | undefined): Decimal =>
  new Decimal(v?.toString() ?? "0");
export const money2 = (d: Decimal): string => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export interface ShiftTxnRow {
  purpose: string;
  status: string;
  cashAmount: { toString(): string } | number | string;
  onlineAmount: { toString(): string } | number | string;
  /** Voided after its shift closed: it was live at close, so it still counts there. */
  voidedAfterClose?: boolean | null;
}

/** A row's money counts in its shift: live, or voided only after the shift closed. */
export function countsInShift(r: Pick<ShiftTxnRow, "purpose" | "status" | "voidedAfterClose">): boolean {
  if (r.status === "VOIDED") return !!r.voidedAfterClose;
  return isRefundPurpose(r.purpose) ? r.status === "CONFIRMED" : (LIVE_STATUSES as readonly string[]).includes(r.status);
}

export interface ShiftFigures {
  openingCash: Decimal;
  cashCollected: Decimal;
  cashRefunded: Decimal;
  expectedCash: Decimal;
  nonCashCollected: Decimal;
  nonCashRefunded: Decimal;
  /** Live rows (COLLECTED / CONFIRMED), refunds included. */
  paymentCount: number;
}

export const isRefundPurpose = (purpose: string): boolean =>
  (REFUND_PURPOSES as readonly string[]).includes(purpose);

/**
 * Every money figure of a shift from its linked transactions. Mirrors the
 * live-totals SQL in cash-shift.service.ts (cashIn / cashOut / nonCash).
 */
export function shiftFigures(openingCash: { toString(): string } | number | string, rows: ShiftTxnRow[]): ShiftFigures {
  let cashCollected = ZERO;
  let cashRefunded = ZERO;
  let nonCashCollected = ZERO;
  let nonCashRefunded = ZERO;
  let paymentCount = 0;
  for (const r of rows) {
    // A refund is paid out when recorded (CONFIRMED); money in is COLLECTED or CONFIRMED
    if (!countsInShift(r)) continue;
    if (isRefundPurpose(r.purpose)) {
      cashRefunded = cashRefunded.add(dec(r.cashAmount));
      nonCashRefunded = nonCashRefunded.add(dec(r.onlineAmount));
      paymentCount++;
      continue;
    }
    cashCollected = cashCollected.add(dec(r.cashAmount));
    nonCashCollected = nonCashCollected.add(dec(r.onlineAmount));
    paymentCount++;
  }
  const opening = dec(openingCash);
  return {
    openingCash: opening,
    cashCollected,
    cashRefunded,
    expectedCash: expectedCash({ openingCash: opening, cashCollected, cashRefunded }),
    nonCashCollected,
    nonCashRefunded,
    paymentCount,
  };
}

/** expected cash = opening float + cash collected − cash refunded. */
export function expectedCash(p: {
  openingCash: { toString(): string } | number | string;
  cashCollected: { toString(): string } | number | string;
  cashRefunded: { toString(): string } | number | string;
}): Decimal {
  return dec(p.openingCash).add(dec(p.cashCollected)).sub(dec(p.cashRefunded));
}

/**
 * Who may close a shift: the branch manager of the shift's branch, or an admin.
 * A Fleet Executive never — not even their own (403 SHIFT_CLOSE_MANAGER_ONLY).
 */
export function assertCanCloseShift(
  actor: { role: string; branchId: number | null | undefined },
  shift: { branchId: number },
): void {
  if (actor.role === "ADMIN") return;
  if (actor.role !== "MANAGER") {
    throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_CLOSE_MANAGER_ONLY", FE_CLOSE_MESSAGE);
  }
  if (shift.branchId !== actor.branchId) {
    throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_OTHER_BRANCH", "This shift belongs to another branch.");
  }
}

export interface CloseDecision {
  cashReceived: Decimal;
  expectedCash: Decimal;
  difference: Decimal;
  matched: boolean;
  /** CLOSED when matched; DISCREPANCY_FLAGGED (= "Mismatch") otherwise. */
  status: "CLOSED" | "DISCREPANCY_FLAGGED";
  note: string | null;
}

/**
 * Validates a manager's close against the shift as it is now (call it inside
 * the transaction that holds the shift row lock).
 *   - the shift must still be OPEN (409 SHIFT_NOT_OPEN — closed shifts are locked)
 *   - when the manager sent the expected figure they saw and it has moved, 409
 *     EXPECTED_CASH_CHANGED (a payment landed since the panel opened)
 *   - a difference needs a note (400 DISCREPANCY_EXPLANATION_REQUIRED)
 */
export function decideClose(p: {
  status: string;
  figures: Pick<ShiftFigures, "expectedCash" | "openingCash" | "cashCollected" | "cashRefunded">;
  cashReceived: number | string | Decimal;
  note?: string | null;
  expectedSeen?: number | string | null;
}): CloseDecision {
  if (p.status !== "OPEN") {
    throw new CashShiftError(StatusCode.CONFLICT, "SHIFT_NOT_OPEN", "This shift is already closed. Closed shifts can't be changed.", {
      shiftStatus: p.status,
    });
  }
  const expected = p.figures.expectedCash.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const breakdown = {
    expectedCash: money2(expected),
    openingCash: money2(p.figures.openingCash),
    cashCollected: money2(p.figures.cashCollected),
    cashRefunded: money2(p.figures.cashRefunded),
  };
  if (p.expectedSeen !== undefined && p.expectedSeen !== null && !dec(p.expectedSeen).toDecimalPlaces(2).eq(expected)) {
    throw new CashShiftError(
      StatusCode.CONFLICT,
      "EXPECTED_CASH_CHANGED",
      `The expected cash for this shift is now ₹${expected.toFixed(2)} (a payment was recorded or changed since you opened it). Check the figures and close again.`,
      breakdown,
    );
  }
  const received = new Decimal(p.cashReceived.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const difference = received.sub(expected);
  const matched = difference.isZero();
  const note = p.note?.trim() || null;
  if (!matched && !note) {
    throw new CashShiftError(
      StatusCode.BAD_REQUEST,
      "DISCREPANCY_EXPLANATION_REQUIRED",
      `Cash received ₹${received.toFixed(2)} is ${difference.isNegative() ? "short" : "over"} by ₹${difference.abs().toFixed(2)} against the ₹${expected.toFixed(2)} expected. Add a note to close the shift.`,
      { ...breakdown, difference: money2(difference), discrepancy: money2(difference), expectedClosing: breakdown.expectedCash },
    );
  }
  return {
    cashReceived: received,
    expectedCash: expected,
    difference,
    matched,
    status: matched ? "CLOSED" : "DISCREPANCY_FLAGGED",
    note,
  };
}

/** Refuses a second OPEN shift for the same executive (the API check before the unique index). */
export function assertNoOpenShift(existing: { id: number } | null | undefined): void {
  if (existing) {
    throw new CashShiftError(
      StatusCode.CONFLICT,
      "SHIFT_ALREADY_OPEN",
      "You already have an open shift. Keep collecting on it — your branch manager closes it when you hand over the cash.",
    );
  }
}

/** True when a Prisma error is the one-open-shift partial unique index refusing a second OPEN row. */
export function isOneOpenShiftViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown }; message?: string } | null;
  if (!e) return false;
  const target = JSON.stringify(e.meta?.target ?? "");
  if (e.code === "P2002") return target.includes("employeeId") || target.includes("one_open");
  return typeof e.message === "string" && e.message.includes("CashShift_one_open_per_employee");
}

/**
 * The shift a payment links to. A Fleet Executive (STAFF) needs an OPEN shift
 * for every payment or refund they record — cash, UPI, card or split — and it
 * links to it ("required"). Managers and admins don't run counter shifts: their
 * own open shift is linked when they have one, otherwise none.
 */
export function shiftForPayment<T extends { id: number }>(
  role: string | null | undefined,
  openShift: T | null | undefined,
): { shift: T | null; required: boolean; missing: boolean } {
  const required = role === "STAFF";
  const shift = openShift ?? null;
  return { shift, required, missing: required && !shift };
}

/** "6h 20m" / "45m" / "2d 3h" — how long a shift has been (or was) open. */
export function shiftDurationLabel(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Fleet Executive self-close (Nov 2026) ────────────────────────────────────
/*
 * A Fleet Executive may close their OWN shift from the Fleet app only when the
 * drawer never held any cash; otherwise the branch manager verifies the cash
 * and closes it ("Verify & close"). Decided on the same live rows the close
 * counts (countsInShift / shiftFigures):
 *
 *   - cash collected  > 0 → BM. The cash part of every IN payment linked to the
 *     shift that is COLLECTED or CONFIRMED — a split's cash part included.
 *   - cash refunded   > 0 → BM. A cash refund paid out of the shift moved cash
 *     through the drawer (it came from the float or from collected cash, or the
 *     executive's own pocket) — the manager has to reconcile it.
 *   - opening float   > 0 → BM. There is cash in the drawer to hand over.
 *   - VOIDED rows count nowhere (a voided row means the money never was), and
 *     neither do REJECTED / FAILED / INITIATED ones: a shift whose only cash row
 *     was voided (or rejected by the manager) may be self-closed.
 *   - UPI / card / bank (non-cash) money never blocks a self-close.
 *
 * A self-close snapshots zeros (cash received 0, difference 0 — there was no
 * cash), closedById = the executive, no reconciler, and confirms NOTHING:
 * non-cash rows still COLLECTED (rare — counter UPI is recorded CONFIRMED) stay
 * for the manager, who sees them under "Unconfirmed payments" in Cash Shift.
 * Self-approval of money is never allowed.
 */

export type SelfCloseReason = "OK" | "NOT_OPEN" | "CASH_COLLECTED" | "CASH_REFUNDED" | "OPENING_FLOAT";

export const SELF_CLOSE_CASH_MESSAGE = "You collected cash in this shift — your branch manager must verify and close it.";
export const SELF_CLOSE_REFUND_MESSAGE = "You paid out a cash refund in this shift — your branch manager must verify and close it.";
export const SELF_CLOSE_FLOAT_MESSAGE = "This shift started with cash in the drawer — your branch manager must verify and close it.";

export interface SelfCloseEligibility {
  canSelfClose: boolean;
  reason: SelfCloseReason;
  /** Why not, for the app ("" when allowed). */
  message: string;
  /** Cash the manager has to receive (opening + collected − refunded), 2 dp. */
  cashToHandOver: string;
  cashCollected: string;
  cashRefunded: string;
  openingCash: string;
}

/** Pure eligibility rule for a Fleet Executive closing their own shift (see above). */
export function selfCloseEligibility(p: {
  status: string;
  figures: Pick<ShiftFigures, "openingCash" | "cashCollected" | "cashRefunded">;
}): SelfCloseEligibility {
  const opening = dec(p.figures.openingCash);
  const collected = dec(p.figures.cashCollected);
  const refunded = dec(p.figures.cashRefunded);
  const base = {
    cashToHandOver: money2(expectedCash({ openingCash: opening, cashCollected: collected, cashRefunded: refunded })),
    cashCollected: money2(collected),
    cashRefunded: money2(refunded),
    openingCash: money2(opening),
  };
  const no = (reason: SelfCloseReason, message: string): SelfCloseEligibility => ({ canSelfClose: false, reason, message, ...base });
  if (p.status !== "OPEN") return no("NOT_OPEN", "This shift is already closed. Closed shifts can't be changed.");
  if (collected.gt(0)) return no("CASH_COLLECTED", SELF_CLOSE_CASH_MESSAGE);
  if (refunded.gt(0)) return no("CASH_REFUNDED", SELF_CLOSE_REFUND_MESSAGE);
  if (opening.gt(0)) return no("OPENING_FLOAT", SELF_CLOSE_FLOAT_MESSAGE);
  return { canSelfClose: true, reason: "OK", message: "", ...base };
}

/** Throws the 403 an executive gets when their shift needs the manager (old builds read `message`). */
export function assertSelfClosable(e: SelfCloseEligibility): void {
  if (e.canSelfClose) return;
  if (e.reason === "NOT_OPEN") {
    throw new CashShiftError(StatusCode.CONFLICT, "SHIFT_NOT_OPEN", e.message);
  }
  // Same code older builds already branch on (SHIFT_CLOSE_MANAGER_ONLY)
  throw new CashShiftError(StatusCode.FORBIDDEN, "SHIFT_CLOSE_MANAGER_ONLY", e.message, {
    reason: e.reason,
    canSelfClose: false,
    cashToHandOver: e.cashToHandOver,
    cashCollected: e.cashCollected,
    cashRefunded: e.cashRefunded,
    openingCash: e.openingCash,
  });
}
