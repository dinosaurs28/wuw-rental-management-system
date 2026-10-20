/**
 * Rules for "Refund to customer" (Oct 2026, client: "Option refund provided to
 * customer without any restrictions"). The branch manager (own branch) or an
 * admin pays money back to the customer on any booking, in any status, at any
 * time — after the drop is settled too — by cash, UPI or bank transfer, recorded
 * as paid out now. Pure — no database — so it is unit-tested
 * (customer-refund-rules.test.ts).
 *
 * Unlike the other refunds there is no cap: any amount above ₹0. Paying back
 * more than the booking's net money received (confirmed money in less refunds
 * already paid out) is allowed but needs an explicit confirmation
 * (`confirmOverReceived: true`), which the dialog asks for with a warning.
 *
 * How it lands in the money (never double counted, the booking status untouched):
 *   - one OVERPAYMENT_REFUND PaymentTransaction (CONFIRMED, key `ctr:`) — the
 *     refund row every money total, the shift and the Transactions page already
 *     read — and one COMPLETED RefundRequest — what the period report counts.
 *     The two are the same money: readers take one or the other (manual cancel's
 *     committedRefunds takes the larger), never both.
 *   - the refund first pays back what the booking owed the customer back at that
 *     moment (paid beyond what it owes: max(0, −netPayable)); anything beyond that
 *     is a goodwill refund, stored on the row as goodwillAmount, which also comes
 *     off what the booking owes (computeBookingOwed). So a refund never makes the
 *     balance due rise (a settled drop doesn't reappear in Settlements, an
 *     upcoming rent's pickup balance doesn't grow), and an over-payment it covers
 *     can't be refunded again.
 *   - cash is linked to the actor's open cash shift (the drawer reconciles); with
 *     no shift open it is still recorded, with no shift — shown as "outside a
 *     shift" on the refund row and in the reports.
 */
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { parseRupees } from "./manual-cancel-rules.js";

export const CUSTOMER_REFUND_REASON_MIN = 3;
export const CUSTOMER_REFUND_REASON_MAX = 500;
export const CUSTOMER_REFUND_REFERENCE_MAX = 64;
/** Largest amount a Decimal(10,2) column holds. */
export const CUSTOMER_REFUND_AMOUNT_MAX = new Decimal("99999999.99");

/** idempotencyKey prefix of a "Refund to customer" row: `ctr:<booking publicId>:<request id>`. */
export const CUSTOMER_REFUND_KEY_PREFIX = "ctr:";

/** RefundRequest.reason prefix of a "Refund to customer". */
export const CUSTOMER_REFUND_REASON_PREFIX = "Refund to customer";

/** How the money goes back to the customer — all paid out now by the branch. */
export const CUSTOMER_REFUND_METHODS = ["CASH", "UPI", "BANK_TRANSFER"] as const;
export type CustomerRefundMethod = (typeof CUSTOMER_REFUND_METHODS)[number];

export const CUSTOMER_REFUND_METHOD_LABELS: Record<CustomerRefundMethod, string> = {
  CASH: "Cash",
  UPI: "UPI transfer",
  BANK_TRANSFER: "Bank transfer",
};

export type CustomerRefundErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "BOOKING_NOT_FOUND"
  | "CONFIRM_OVER_RECEIVED"
  | "DUPLICATE_REFUND";

export class CustomerRefundError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: CustomerRefundErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CustomerRefundError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

const ZERO = new Decimal(0);

// ── Request body ─────────────────────────────────────────────────────────────

export interface ParsedCustomerRefund {
  amount: Decimal;
  method: CustomerRefundMethod;
  reason: string;
  /** UPI / bank transfer only: the transfer's reference / UTR (optional) */
  reference: string | null;
  /** UPI / bank transfer only: the uploaded payment-proof photo id (optional) */
  proofFileId: string | null;
  /** The actor saw the "more than received" warning and ticked it */
  confirmOverReceived: boolean;
  /** Client-generated id of this submission: a retry of the same one is refused, not paid twice */
  requestId: string | null;
}

const invalid = (message: string, field?: string) =>
  new CustomerRefundError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", message, field ? { field } : {});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Validates the request. Throws CustomerRefundError (400 VALIDATION_ERROR). */
export function parseCustomerRefundBody(body: unknown): ParsedCustomerRefund {
  const b = isRecord(body) ? body : {};

  const amount = parseRupees(b.amount);
  if (!amount || !amount.gt(0)) {
    throw invalid("Enter the amount to refund — more than ₹0, with at most 2 decimals.", "amount");
  }
  if (amount.gt(CUSTOMER_REFUND_AMOUNT_MAX)) {
    throw invalid(`The refund can be at most ₹${CUSTOMER_REFUND_AMOUNT_MAX.toFixed(2)}.`, "amount");
  }

  if (!CUSTOMER_REFUND_METHODS.includes(b.method as CustomerRefundMethod)) {
    throw invalid("Choose how the money is paid back: cash, UPI or bank transfer.", "method");
  }
  const method = b.method as CustomerRefundMethod;

  if (typeof b.reason !== "string") throw invalid("Enter the reason for the refund.", "reason");
  const reason = b.reason.trim();
  if (reason.length < CUSTOMER_REFUND_REASON_MIN) {
    throw invalid(`The reason must be at least ${CUSTOMER_REFUND_REASON_MIN} characters.`, "reason");
  }
  if (reason.length > CUSTOMER_REFUND_REASON_MAX) {
    throw invalid(`The reason can be at most ${CUSTOMER_REFUND_REASON_MAX} characters.`, "reason");
  }

  // Reference and photo describe a transfer: ignored for cash
  let reference: string | null = null;
  let proofFileId: string | null = null;
  if (method !== "CASH") {
    if (b.reference != null && b.reference !== "") {
      if (typeof b.reference !== "string") throw invalid("The reference must be text.", "reference");
      const ref = b.reference.trim();
      if (ref.length > CUSTOMER_REFUND_REFERENCE_MAX) {
        throw invalid(`The reference can be at most ${CUSTOMER_REFUND_REFERENCE_MAX} characters.`, "reference");
      }
      if (ref.length > 0) {
        if (!REFERENCE_PATTERN.test(ref)) {
          throw invalid("The reference can have letters, digits, spaces and . _ - / only.", "reference");
        }
        reference = ref;
      }
    }
    if (b.proofFileId != null && b.proofFileId !== "") {
      if (typeof b.proofFileId !== "string" || b.proofFileId.trim().length === 0 || b.proofFileId.trim().length > 64) {
        throw invalid("proofFileId must be the id of the uploaded photo.", "proofFileId");
      }
      proofFileId = b.proofFileId.trim();
    }
  }

  let requestId: string | null = null;
  if (b.requestId != null && b.requestId !== "") {
    if (typeof b.requestId !== "string" || !REQUEST_ID_PATTERN.test(b.requestId)) {
      throw invalid("requestId must be 8–64 letters, digits, _ or -.", "requestId");
    }
    requestId = b.requestId;
  }

  return {
    amount,
    method,
    reason,
    reference,
    proofFileId,
    confirmOverReceived: b.confirmOverReceived === true,
    requestId,
  };
}

// ── Money ────────────────────────────────────────────────────────────────────

/** What the booking owes the customer back right now: what it was paid beyond what it owes (≥ 0). */
export function owedBack(netPayable: Decimal): Decimal {
  return Decimal.max(ZERO, netPayable.negated()).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/**
 * Splits a refund into what pays back money the booking owed the customer
 * (`covered` — a plain refund) and the goodwill beyond it (`goodwill` — also
 * taken off what the booking owes).
 */
export function splitCustomerRefund(amount: Decimal, owedBackNow: Decimal): { covered: Decimal; goodwill: Decimal } {
  const covered = Decimal.min(amount, Decimal.max(ZERO, owedBackNow));
  return { covered, goodwill: amount.sub(covered) };
}

/** Net money received on the booking: confirmed money in less refunds paid out (may be ≤ 0). */
export function netReceived(confirmedIn: Decimal, refundedOut: Decimal): Decimal {
  return confirmedIn.sub(refundedOut).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** How far the refund goes beyond the net money received (0 when it doesn't). */
export function overReceivedBy(amount: Decimal, received: Decimal): Decimal {
  return Decimal.max(ZERO, amount.sub(Decimal.max(ZERO, received)));
}

/** A refund beyond the net money received needs the confirmation tick (a warning, never a block once ticked). */
export function overReceivedRefusal(amount: Decimal, received: Decimal, confirmed: boolean): CustomerRefundError | null {
  const excess = overReceivedBy(amount, received);
  if (!excess.gt(0) || confirmed) return null;
  const base = Decimal.max(ZERO, received);
  return new CustomerRefundError(
    StatusCode.CONFLICT,
    "CONFIRM_OVER_RECEIVED",
    base.gt(0)
      ? `₹${amount.toFixed(2)} is ₹${excess.toFixed(2)} more than the ₹${base.toFixed(2)} received on this booking (after refunds). Tick the confirmation to refund it anyway.`
      : `Nothing received on this booking is left after refunds. Tick the confirmation to refund ₹${amount.toFixed(2)} anyway.`,
    { netReceived: received.toFixed(2), overBy: excess.toFixed(2), field: "confirmOverReceived" },
  );
}

/**
 * What the booking's balance (netPayable = owed − net paid; + due, − owed back)
 * becomes after the refund: the covered part comes off what was paid, the
 * goodwill part off both what was paid and what is owed — so only `covered`
 * moves it, and it never rises above 0 because of a refund.
 */
export function netPayableAfterRefund(netPayable: Decimal, amount: Decimal): Decimal {
  const { covered } = splitCustomerRefund(amount, owedBack(netPayable));
  return netPayable.add(covered);
}

/** Where a refund's cash comes from: the actor's open shift, or (none open) outside any shift. Online: no shift. */
export function cashShiftLink(
  method: CustomerRefundMethod,
  openShift: { id: number; publicId: string } | null,
): { cashShiftId: number | null; cashShiftPublicId: string | null; cashOutsideShift: boolean } {
  if (method !== "CASH") return { cashShiftId: null, cashShiftPublicId: null, cashOutsideShift: false };
  return openShift
    ? { cashShiftId: openShift.id, cashShiftPublicId: openShift.publicId, cashOutsideShift: false }
    : { cashShiftId: null, cashShiftPublicId: null, cashOutsideShift: true };
}

/** How the refund row is recorded: PaymentMethod + gateway. */
export function customerRefundRecord(method: CustomerRefundMethod): { method: "CASH" | "ONLINE"; onlineGateway: string | null } {
  switch (method) {
    case "CASH":
      return { method: "CASH", onlineGateway: null };
    case "UPI":
      return { method: "ONLINE", onlineGateway: "UPI" };
    case "BANK_TRANSFER":
      return { method: "ONLINE", onlineGateway: "BANK_TRANSFER" };
  }
}

/** The idempotencyKey of a refund row: a retried submission (same requestId) hits the unique key. */
export function customerRefundKey(bookingPublicId: string, requestId: string): string {
  return `${CUSTOMER_REFUND_KEY_PREFIX}${bookingPublicId}:${requestId}`;
}

/** Whether a PaymentTransaction is a "Refund to customer" row. */
export function isCustomerRefundKey(idempotencyKey: string | null | undefined): boolean {
  return (idempotencyKey ?? "").startsWith(CUSTOMER_REFUND_KEY_PREFIX);
}

const REFUND_PURPOSES = ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"];

/** A cash refund paid out with no cash shift linked — it isn't in any drawer's reconciliation (a voided one isn't paid out). */
export function isCashRefundOutsideShift(t: {
  purpose: string;
  cashAmount: { toString(): string } | number | string;
  cashShiftId: number | null;
  status?: string;
}): boolean {
  if (t.status === "VOIDED") return false;
  return REFUND_PURPOSES.includes(t.purpose) && t.cashShiftId === null && new Decimal(t.cashAmount.toString()).gt(0);
}

/** The note on the refund row (and the RefundRequest reason). */
export function customerRefundNote(input: Pick<ParsedCustomerRefund, "method" | "reason">, cashOutsideShift: boolean): string {
  const label = CUSTOMER_REFUND_METHOD_LABELS[input.method];
  return `${CUSTOMER_REFUND_REASON_PREFIX} (${label}${cashOutsideShift ? ", no cash shift open" : ""}): ${input.reason}`.slice(0, 1000);
}
