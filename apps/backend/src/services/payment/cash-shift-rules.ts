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

/** What an old app build sees when it tries to close its own shift. */
export const FE_CLOSE_MESSAGE = "Your branch manager closes shifts now. Hand over your cash to close this shift.";

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
