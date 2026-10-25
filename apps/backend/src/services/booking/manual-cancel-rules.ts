/**
 * Rules for the branch manager's manual cancel of a rent (Fleet tab, Oct 2026).
 * Pure — no database — so they are unit-tested (manual-cancel-rules.test.ts).
 *
 * Which rents can be cancelled:
 *   CONFIRMED  (upcoming)  yes — a pickup still waiting for the manager's
 *                          confirmation too (that confirmation is dropped)
 *   PICKED_UP  (active)    yes — the manager says where the car is (back at
 *                          the branch / out of the branch; legacy
 *                          vehicleReturned: true = back) and picks its status
 *                          (Available / Maintenance / Inactive / Out For
 *                          Rental — not Available while it is out of the
 *                          branch; an odometer reading only when it is back);
 *                          not while its return waits for the manager's
 *                          confirmation
 *   HOLD                   no — the payment is still pending; an unpaid hold
 *                          lapses on its own (and a late capture is refused)
 *   RETURNED / CANCELLED / HOLD_EXPIRED  no
 * Also refused while a drop is in progress (an open drop bill or a drop damage
 * awaiting review — the drop bills it), while a payment is in flight, or while
 * cash on the booking awaits the manager's confirmation (the refund is worked
 * out on settled money).
 *
 * Refund: anything from 0 up to what was paid (confirmed money in) less what is
 * already refunded or committed, in paise. Committed = the larger of the refund
 * rows paid out and the refund requests (awaiting approval, approved or
 * completed): a counter refund writes both a refund row and a request, so the
 * two are never added. Cash, UPI transfer and bank transfer are paid back by the
 * branch now (cash needs the manager's open shift); "original online payment" is
 * an approved refund request completed later with the Razorpay refund id, capped
 * at the money captured through Razorpay on the booking.
 */
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { refundProofRefusal } from "../payment/refund-proof-rules.js";

export const MANUAL_CANCEL_REASON_MIN = 3;
export const MANUAL_CANCEL_REASON_MAX = 500;
export const MANUAL_CANCEL_NOTE_MAX = 500;
/** Highest odometer reading accepted (km). */
export const MANUAL_CANCEL_ODOMETER_MAX = 9_999_999;

/** How the money goes back to the customer. */
export const MANUAL_CANCEL_REFUND_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "ORIGINAL_PAYMENT"] as const;
export type ManualCancelRefundMethod = (typeof MANUAL_CANCEL_REFUND_METHODS)[number];

export const MANUAL_CANCEL_REFUND_METHOD_LABELS: Record<ManualCancelRefundMethod, string> = {
  CASH: "Cash",
  UPI: "UPI transfer",
  BANK_TRANSFER: "Bank transfer",
  ORIGINAL_PAYMENT: "Original online payment",
};

/**
 * RefundRequest.reason prefix of a manual cancel's refund to the original online
 * payment (APPROVED, completed later): the BM refunds queue lists these with the
 * requests awaiting approval (refund.service listPendingForBranch).
 */
export const ORIGINAL_PAYMENT_REFUND_REASON_PREFIX = "Rent cancelled (Original online payment)";

/** What a returned car becomes once the rent is cancelled. */
export const MANUAL_CANCEL_VEHICLE_STATUSES = ["AVAILABLE", "MAINTENANCE", "INACTIVE", "OUT_FOR_RENTAL"] as const;
export type ManualCancelVehicleStatus = (typeof MANUAL_CANCEL_VEHICLE_STATUSES)[number];

/** Where an active rent's car is when it is cancelled. */
export const MANUAL_CANCEL_VEHICLE_LOCATIONS = ["AT_BRANCH", "OUT_OF_BRANCH"] as const;
export type ManualCancelVehicleLocation = (typeof MANUAL_CANCEL_VEHICLE_LOCATIONS)[number];

export const MANUAL_CANCEL_VEHICLE_LOCATION_LABELS: Record<ManualCancelVehicleLocation, string> = {
  AT_BRANCH: "The vehicle is back at the branch",
  OUT_OF_BRANCH: "The vehicle is out of the branch",
};

/** Message when Available is chosen for a car that isn't at the branch. */
export const OUT_OF_BRANCH_NOT_AVAILABLE = "The car isn't at the branch, so it can't be bookable.";

export type ManualCancelStage = "UPCOMING" | "ACTIVE";

export type ManualCancelErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_CANCELLABLE"
  | "RETURN_PENDING_CONFIRMATION"
  | "CASH_AWAITING_CONFIRMATION"
  | "PAYMENT_IN_PROGRESS"
  | "REFUND_EXCEEDS_PAID"
  | "REFUND_EXCEEDS_ONLINE"
  | "DROP_IN_PROGRESS"
  | "CASH_SHIFT_REQUIRED"
  | "CANCEL_CONFLICT"
  | "REFUND_PROOF_REQUIRED";

export class ManualCancelError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: ManualCancelErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ManualCancelError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

// ── State ────────────────────────────────────────────────────────────────────

export interface CancelState {
  status: string;
  requiresManagerConfirmation: boolean;
}

const STATUS_MESSAGES: Record<string, string> = {
  HOLD: "This booking isn't confirmed yet (its payment is pending). An unpaid booking lapses on its own.",
  RETURNED: "This rent is already completed (the vehicle was returned), so it can't be cancelled.",
  CANCELLED: "This rent is already cancelled.",
  HOLD_EXPIRED: "This booking expired before it was paid, so there's nothing to cancel.",
};

/** UPCOMING (confirmed) or ACTIVE (picked up); null for every other status. */
export function manualCancelStage(status: string): ManualCancelStage | null {
  if (status === "CONFIRMED") return "UPCOMING";
  if (status === "PICKED_UP") return "ACTIVE";
  return null;
}

/** Why this rent can't be cancelled from its state, or null when it can. */
export function cancelRefusalFor(state: CancelState): ManualCancelError | null {
  const stage = manualCancelStage(state.status);
  if (!stage) {
    return new ManualCancelError(
      StatusCode.CONFLICT,
      "BOOKING_NOT_CANCELLABLE",
      STATUS_MESSAGES[state.status] ?? "This booking can't be cancelled.",
      { bookingStatus: state.status },
    );
  }
  if (stage === "ACTIVE" && state.requiresManagerConfirmation) {
    return new ManualCancelError(
      StatusCode.CONFLICT,
      "RETURN_PENDING_CONFIRMATION",
      "This vehicle's return is waiting for your confirmation. Confirm the return on the Confirmations page instead of cancelling the rent.",
    );
  }
  return null;
}

// ── Money ────────────────────────────────────────────────────────────────────

export interface CancelMoney {
  /** CONFIRMED money in (refund rows excluded) */
  paid: Decimal;
  /** Refunds paid out or committed (committedRefunds) */
  refunded: Decimal;
  /** Cash collected and still awaiting the manager's confirmation */
  pendingCash: Decimal;
  /** CONFIRMED money in captured through Razorpay (what "original online payment" can go back to) */
  razorpayCaptured: Decimal;
}

const ZERO = new Decimal(0);

/**
 * Refunds already paid out or committed on the booking: the larger of the refund
 * rows paid out (OVERPAYMENT_REFUND / CANCELLATION_REFUND) and the refund requests
 * awaiting approval, approved or completed. A counter refund writes both a refund
 * row and a request for the same money, so they are never added together; a
 * request alone (an approved online refund not paid out yet) still counts.
 */
export function committedRefunds(refundedOut: Decimal, refundRequests: Decimal): Decimal {
  return Decimal.max(refundedOut, refundRequests).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** What can still be refunded: paid − committed refunds, never below 0, in paise. */
export function refundableAmount(money: Pick<CancelMoney, "paid" | "refunded">): Decimal {
  return Decimal.max(ZERO, money.paid.sub(money.refunded)).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/** A payment row as the Razorpay tally reads it. */
export interface MoneyInRow {
  purpose: string;
  status: string;
  onlineAmount: { toString(): string } | number | string;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
}

const REFUND_PURPOSES = ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"];

/** Captured through Razorpay: the gateway says so, or the ref is a Razorpay order / payment id. */
export function isRazorpayCapture(t: Pick<MoneyInRow, "onlineGateway" | "onlineTransactionRef">): boolean {
  return (
    (t.onlineGateway ?? "").trim().toUpperCase() === "RAZORPAY" ||
    /^(order_|pay_)/.test(t.onlineTransactionRef ?? "")
  );
}

/** Confirmed online money in captured through Razorpay (cash and counter UPI excluded). */
export function razorpayCapturedAmount(rows: MoneyInRow[]): Decimal {
  return rows
    .filter((t) => t.status === "CONFIRMED" && !REFUND_PURPOSES.includes(t.purpose) && isRazorpayCapture(t))
    .reduce((sum, t) => sum.add(new Decimal(t.onlineAmount.toString())), ZERO)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** What can go back to the original online payment: refundable, at most what Razorpay captured. */
export function originalPaymentCap(refundable: Decimal, razorpayCaptured: Decimal): Decimal {
  return Decimal.max(ZERO, Decimal.min(refundable, razorpayCaptured));
}

/** Cash awaiting confirmation blocks the cancel (the refund needs settled money). */
export function moneyRefusal(money: Pick<CancelMoney, "pendingCash">): ManualCancelError | null {
  if (!money.pendingCash.gt(0)) return null;
  return new ManualCancelError(
    StatusCode.CONFLICT,
    "CASH_AWAITING_CONFIRMATION",
    `₹${money.pendingCash.toFixed(2)} of cash on this booking is still awaiting your confirmation. Confirm or reject it (Payments → Cash) first, then cancel.`,
    { pendingCash: money.pendingCash.toFixed(2) },
  );
}

/** Why a refund amount can't be recorded, or null. `amount` is already parsed (finite, ≥ 0, paise). */
export function refundAmountProblem(amount: Decimal, refundable: Decimal): string | null {
  if (amount.isNegative()) return "The refund can't be negative.";
  if (amount.gt(refundable)) {
    return refundable.gt(0)
      ? `The refund can be at most ₹${refundable.toFixed(2)} — what was paid and not already refunded.`
      : "Nothing was paid on this booking that hasn't been refunded, so the refund must be ₹0.";
  }
  return null;
}

/** Why this much can't go back to the original online payment, or null. */
export function originalPaymentProblem(amount: Decimal, cap: Decimal): string | null {
  if (!amount.gt(cap)) return null;
  return cap.gt(0)
    ? `Only ₹${cap.toFixed(2)} was paid online through Razorpay on this booking. Refund the rest by cash, UPI or bank transfer.`
    : "Nothing on this booking was paid online through Razorpay. Refund by cash, UPI or bank transfer.";
}

/** A cash refund comes out of the manager's drawer: it needs their open cash shift. */
export function cashShiftRefusal(method: ManualCancelRefundMethod | null, shiftOpen: boolean): ManualCancelError | null {
  if (method !== "CASH" || shiftOpen) return null;
  return new ManualCancelError(
    StatusCode.CONFLICT,
    "CASH_SHIFT_REQUIRED",
    "Open a cash shift to refund cash, or choose UPI or bank transfer.",
    { field: "refund.method" },
  );
}

/** A drop is under way (an open drop bill, or a drop damage awaiting review): the drop bills it. */
export function dropInProgressRefusal(state: { openReturnSession: boolean; pendingDropDamage: boolean }): ManualCancelError | null {
  if (!state.openReturnSession && !state.pendingDropDamage) return null;
  return new ManualCancelError(
    StatusCode.CONFLICT,
    "DROP_IN_PROGRESS",
    "A drop is in progress for this rent — finish the drop instead (it bills any damage).",
  );
}

/**
 * A legacy counter balance payment through Razorpay started and not recorded
 * (Booking.remainingPaymentId is an order, remainingPaidAt null): the order's
 * state decides. Captured → wait for it to be recorded; created / attempted or
 * the gateway unreachable (null) → in progress; failed / expired → no blocker.
 */
export function remainingPaymentRefusal(gateway: { state: "SUCCESS" | "PENDING" | "FAILED" } | null): ManualCancelError | null {
  if (gateway?.state === "FAILED") return null;
  const message =
    gateway?.state === "SUCCESS"
      ? "The customer's balance payment went through and is still being recorded. Wait for it to be recorded (check the payment status at the counter), then cancel."
      : gateway?.state === "PENDING"
        ? "The customer is paying the balance online at the counter. Wait for that payment to finish or fail, then cancel."
        : "Couldn't check the customer's online balance payment with the payment gateway. Try again in a moment.";
  return new ManualCancelError(StatusCode.CONFLICT, "PAYMENT_IN_PROGRESS", message, {
    gatewayState: gateway?.state ?? null,
  });
}

/** How a refund is recorded: PaymentMethod + gateway, and whether the branch pays it back now. */
export function refundRecordFor(method: ManualCancelRefundMethod): {
  method: "CASH" | "ONLINE";
  onlineGateway: string | null;
  /** false: an approved request completed later (Payments → Refunds) with the Razorpay refund id */
  paidOutNow: boolean;
} {
  switch (method) {
    case "CASH":
      return { method: "CASH", onlineGateway: null, paidOutNow: true };
    case "UPI":
      return { method: "ONLINE", onlineGateway: "UPI", paidOutNow: true };
    case "BANK_TRANSFER":
      return { method: "ONLINE", onlineGateway: "BANK_TRANSFER", paidOutNow: true };
    case "ORIGINAL_PAYMENT":
      return { method: "ONLINE", onlineGateway: "RAZORPAY", paidOutNow: false };
  }
}

// ── Request body ─────────────────────────────────────────────────────────────

export interface ParsedManualCancel {
  reason: string;
  refund: {
    amount: Decimal;
    method: ManualCancelRefundMethod | null;
    note: string | null;
    /**
     * Oct 25 2026: the uploaded payment-success photo (FileObject publicId) —
     * required for a UPI / bank transfer refund, kept for cash, ignored otherwise
     */
    proofFileId: string | null;
  };
  /** ACTIVE rents only (null for an upcoming one) */
  vehicleLocation: ManualCancelVehicleLocation | null;
  /** ACTIVE rents only (null for an upcoming one) */
  vehicleStatus: ManualCancelVehicleStatus | null;
  /** ACTIVE rents back at the branch only — the car's reading (km), optional */
  odometer: number | null;
}

const invalid = (message: string, field?: string) =>
  new ManualCancelError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", message, field ? { field } : {});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A rupee amount: a finite number (or numeric string) ≥ 0 with at most 2 decimals. */
export function parseRupees(value: unknown): Decimal | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\s*\d+(\.\d+)?\s*$/.test(value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  let d: Decimal;
  try {
    d = new Decimal(typeof value === "string" ? value.trim() : value);
  } catch {
    return null;
  }
  if (d.isNegative() || d.decimalPlaces() > 2) return null;
  return d;
}

/**
 * Validates the cancel request for a rent in `stage`. Throws ManualCancelError
 * (400 VALIDATION_ERROR). The refund amount is checked against what can be
 * refunded separately (refundAmountProblem), once the money is read.
 */
export function parseManualCancelBody(body: unknown, stage: ManualCancelStage): ParsedManualCancel {
  const b = isRecord(body) ? body : {};

  if (typeof b.reason !== "string") throw invalid("Enter the reason for cancelling.", "reason");
  const reason = b.reason.trim();
  if (reason.length < MANUAL_CANCEL_REASON_MIN) {
    throw invalid(`The reason must be at least ${MANUAL_CANCEL_REASON_MIN} characters.`, "reason");
  }
  if (reason.length > MANUAL_CANCEL_REASON_MAX) {
    throw invalid(`The reason can be at most ${MANUAL_CANCEL_REASON_MAX} characters.`, "reason");
  }

  if (!isRecord(b.refund)) throw invalid("Enter the refund amount (₹0 for no refund).", "refund.amount");
  const amount = parseRupees(b.refund.amount);
  if (!amount) {
    throw invalid("The refund amount must be ₹0 or more, with at most 2 decimals.", "refund.amount");
  }
  let method: ManualCancelRefundMethod | null = null;
  if (amount.gt(0)) {
    if (!MANUAL_CANCEL_REFUND_METHODS.includes(b.refund.method as ManualCancelRefundMethod)) {
      throw invalid("Choose how the refund is paid back.", "refund.method");
    }
    method = b.refund.method as ManualCancelRefundMethod;
  }
  let note: string | null = null;
  if (b.refund.note != null) {
    if (typeof b.refund.note !== "string") throw invalid("The refund note must be text.", "refund.note");
    const trimmed = b.refund.note.trim();
    if (trimmed.length > MANUAL_CANCEL_NOTE_MAX) {
      throw invalid(`The refund note can be at most ${MANUAL_CANCEL_NOTE_MAX} characters.`, "refund.note");
    }
    note = trimmed.length > 0 ? trimmed : null;
  }
  // The refund's payment-success photo (`refund.proofFileId`; `refund.proof_file_id`
  // accepted too). Required for UPI / bank transfer; cash may carry one; the
  // original online payment (completed later with the Razorpay refund id) never does.
  let proofFileId: string | null = null;
  if (method && method !== "ORIGINAL_PAYMENT") {
    const raw = b.refund.proofFileId ?? b.refund.proof_file_id;
    if (raw != null && raw !== "") {
      if (typeof raw !== "string" || raw.trim().length === 0 || raw.trim().length > 64) {
        throw invalid("refund.proofFileId must be the id of the uploaded photo.", "refund.proofFileId");
      }
      proofFileId = raw.trim();
    }
    const noProof = refundProofRefusal(method, proofFileId !== null, { field: "refund.proofFileId" });
    if (noProof) throw new ManualCancelError(noProof.status, noProof.code, noProof.message, { field: noProof.field });
  }
  const refund = { amount, method, note, proofFileId };

  if (stage === "UPCOMING") {
    return { reason, refund, vehicleLocation: null, vehicleStatus: null, odometer: null };
  }

  // Active rent: where the car is (older clients send vehicleReturned: true = back at the branch)
  const vehicleLocation: ManualCancelVehicleLocation | null = MANUAL_CANCEL_VEHICLE_LOCATIONS.includes(
    b.vehicleLocation as ManualCancelVehicleLocation,
  )
    ? (b.vehicleLocation as ManualCancelVehicleLocation)
    : b.vehicleLocation == null && b.vehicleReturned === true
      ? "AT_BRANCH"
      : null;
  if (!vehicleLocation) {
    throw invalid("Say where the vehicle is: back at the branch or out of the branch.", "vehicleLocation");
  }
  if (!MANUAL_CANCEL_VEHICLE_STATUSES.includes(b.vehicleStatus as ManualCancelVehicleStatus)) {
    throw invalid("Choose the vehicle's status: Available, Maintenance, Inactive or Out For Rental.", "vehicleStatus");
  }
  const vehicleStatus = b.vehicleStatus as ManualCancelVehicleStatus;
  if (vehicleLocation === "OUT_OF_BRANCH" && vehicleStatus === "AVAILABLE") {
    throw invalid(OUT_OF_BRANCH_NOT_AVAILABLE, "vehicleStatus");
  }
  let odometer: number | null = null;
  if (b.odometer != null && b.odometer !== "") {
    if (vehicleLocation !== "AT_BRANCH") {
      throw invalid("An odometer reading can only be recorded when the vehicle is back at the branch.", "odometer");
    }
    const n = typeof b.odometer === "string" ? Number(b.odometer.trim()) : b.odometer;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MANUAL_CANCEL_ODOMETER_MAX) {
      throw invalid("The odometer reading must be a whole number of km.", "odometer");
    }
    odometer = n;
  }
  return {
    reason,
    refund,
    vehicleLocation,
    vehicleStatus,
    odometer,
  };
}

/** Why the cancel left a car's status alone. */
export type VehicleKeptReason = "OTHER_RENTAL" | "DAMAGE_REVIEW" | "DROP_DAMAGE";

/**
 * What an active rent's car becomes when the rent is cancelled — the manager's
 * choice, landed like a vehicle-details edit — unless another active rental now
 * holds it or it is held for a damage review (left alone, reported back), or a
 * drop damage already decided it (that disposition wins over Available).
 */
export function vehicleStatusOutcome(v: {
  currentStatus: string;
  heldByOtherRental: boolean;
  /** vehicleStatusAfterDrop for this car on this booking (null: no drop damage) */
  afterDrop: string | null;
  chosen: ManualCancelVehicleStatus;
}): { status: string; keptReason: VehicleKeptReason | null } {
  if (v.heldByOtherRental) return { status: v.currentStatus, keptReason: "OTHER_RENTAL" };
  if (v.currentStatus === "MANAGER_REPORTED") return { status: v.currentStatus, keptReason: "DAMAGE_REVIEW" };
  if (v.afterDrop && v.afterDrop !== "AVAILABLE" && v.afterDrop !== v.chosen) {
    return { status: v.afterDrop, keptReason: "DROP_DAMAGE" };
  }
  return { status: v.chosen, keptReason: null };
}

/** The toast line for cars whose status the cancel didn't set. */
export function keptVehiclesNote(vehicles: Array<{ regNo: string; status: string; keptReason: VehicleKeptReason | null }>): string | null {
  const kept = vehicles.filter((v) => v.keptReason);
  if (kept.length === 0) return null;
  const why: Record<VehicleKeptReason, string> = {
    OTHER_RENTAL: "it is out on another rental",
    DAMAGE_REVIEW: "it is held for a damage review",
    DROP_DAMAGE: "a drop damage decision for it",
  };
  return kept
    .map((v) => {
      const status = v.status.replace(/_/g, " ").toLowerCase();
      return v.keptReason === "DROP_DAMAGE"
        ? `${v.regNo} is set to ${status} — ${why.DROP_DAMAGE}.`
        : `${v.regNo} stays ${status} — ${why[v.keptReason!]}.`;
    })
    .join(" ");
}

/** Why the returned car's reading can't be recorded, or null (it can't go below the reading it went out with). */
export function odometerProblem(odometer: number, currentOdo: number, vehicleCount: number): string | null {
  if (vehicleCount !== 1) return "An odometer reading can only be recorded for a rent with one vehicle.";
  if (odometer < currentOdo) {
    return `The odometer reading can't be less than the vehicle's last reading (${currentOdo} km).`;
  }
  return null;
}
