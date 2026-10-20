/**
 * Rules for voiding a payment (Oct 2026, client: "you need be able to void some
 * payment"). A void reverses a wrong entry: the branch manager (own branch), an
 * admin (any branch) or a Fleet Executive (own branch) marks a CONFIRMED
 * staff-recorded PaymentTransaction as VOIDED with a reason. Pure — no database
 * — so it is unit-tested (payment-void-rules.test.ts).
 *
 * What can be voided: CONFIRMED manual entries recorded by staff — cash, counter
 * UPI, bank transfer and split payments (booking payments, extension and
 * drop-bill collections, deposits, credit clearances), and manual refunds /
 * payouts recorded by mistake ("Refund to customer" `ctr:` rows included).
 * What can't: online gateway payments (Razorpay / PhonePe, the UPI QR — captured
 * by the gateway, refunded through Refund), entries not CONFIRMED (collected
 * cash awaiting confirmation is rejected instead) and entries already voided.
 *
 * How it lands in the money (the booking status is never changed):
 *   - the row keeps its amounts; status VOIDED takes it out of every total —
 *     each reader counts CONFIRMED (and COLLECTED) rows only, so booking money /
 *     amount due, financial state, Settlements, shift expected cash, the period
 *     report and invoices drop it with no special case;
 *   - money in voided → the booking owes that amount again (Settlements picks
 *     it up); a pickup it unlocked or a drop it completed is not reverted;
 *   - a refund voided → its RefundRequest becomes VOIDED (the period report
 *     counts COMPLETED ones) and the customer is owed the refunded money back
 *     again; a `ctr:` refund's goodwill unwinds with it (goodwill is summed from
 *     CONFIRMED refund rows only);
 *   - a split payment row (cash + UPI in one entry) is voided whole; a
 *     collection written as several rows (e.g. rent + deposit) voids one row at
 *     a time — the other rows stay;
 *   - a safety-deposit payment voided: the money is no longer counted as paid.
 *     Taken in a payment session, the deposit stays on the bill and is due
 *     again; taken on its own (legacy pickup / BM record payment), that payment
 *     was the deposit charge, so the held deposit drops with it;
 *   - cash in a shift still OPEN comes out of its expected drawer at once; a
 *     shift already CLOSED keeps its counted / expected cash (flagged
 *     voidShiftClosed, shown in the period report).
 */
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";

export const PAYMENT_VOID_REASON_MIN = 3;
export const PAYMENT_VOID_REASON_MAX = 500;

export const ONLINE_PAYMENT_VOID_MESSAGE = "Online payments can't be voided — use Refund";
export const SHIFT_CLOSED_VOID_WARNING = "Shift already closed — counted cash won't change";

export type PaymentVoidErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "BOOKING_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "ALREADY_VOIDED"
  | "ONLINE_PAYMENT"
  | "NOT_VOIDABLE";

export class PaymentVoidError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: PaymentVoidErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PaymentVoidError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...this.extra };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates the void request ({ reason }). Throws PaymentVoidError (400 VALIDATION_ERROR). */
export function parsePaymentVoidBody(body: unknown): { reason: string } {
  const b = isRecord(body) ? body : {};
  if (typeof b.reason !== "string") {
    throw new PaymentVoidError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", "Enter the reason for voiding this payment.", { field: "reason" });
  }
  const reason = b.reason.trim();
  if (reason.length < PAYMENT_VOID_REASON_MIN) {
    throw new PaymentVoidError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", `The reason must be at least ${PAYMENT_VOID_REASON_MIN} characters.`, { field: "reason" });
  }
  if (reason.length > PAYMENT_VOID_REASON_MAX) {
    throw new PaymentVoidError(StatusCode.BAD_REQUEST, "VALIDATION_ERROR", `The reason can be at most ${PAYMENT_VOID_REASON_MAX} characters.`, { field: "reason" });
  }
  return { reason };
}

type DecimalLike = { toString(): string } | number | string;

export interface VoidCandidate {
  status: string;
  purpose: string;
  method: string;
  totalAmount: DecimalLike;
  onlineAmount: DecimalLike;
  onlineGateway: string | null;
  idempotencyKey: string | null;
  notes: string | null;
}

const REFUND_PURPOSES = ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"];

/** Whether the row is money paid back (a refund / payout) rather than money in. */
export function isRefundPurpose(purpose: string): boolean {
  return REFUND_PURPOSES.includes(purpose);
}

/** Gateways whose payments are captured (and refunded) by the gateway, not recorded by staff. */
const GATEWAY_PATTERN = /razorpay|phonepe|stripe|cashfree|payu|paytm|gateway/i;
/**
 * Keys of rows written from a gateway capture (verify / recheck / QR). The BM
 * damage settlement's Razorpay row (`damage-online:`) carries no gateway name,
 * so its key is what marks it.
 */
const GATEWAY_KEY_PREFIXES = ["recheck:gateway:", "ext:razorpay:", "remaining:razorpay:", "damage-online:"];

/**
 * An online payment captured by a payment gateway (Razorpay / PhonePe, the UPI
 * QR) — never voided: the money really moved through the gateway, so it goes
 * back through Refund. Counter UPI / bank transfers (gateway "UPI" /
 * "BANK_TRANSFER" / none) are staff-recorded entries and can be voided.
 */
export function isOnlineGatewayPayment(t: Pick<VoidCandidate, "onlineAmount" | "onlineGateway" | "idempotencyKey" | "notes">): boolean {
  if (!new Decimal(t.onlineAmount.toString()).gt(0)) return false;
  if (t.onlineGateway && GATEWAY_PATTERN.test(t.onlineGateway)) return true;
  if ((t.notes ?? "").includes("razorpay_payment_id=")) return true;
  const key = t.idempotencyKey ?? "";
  return GATEWAY_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export type VoidEligibility =
  | { voidable: true }
  | { voidable: false; code: Exclude<PaymentVoidErrorCode, "VALIDATION_ERROR" | "UNAUTHORIZED" | "BOOKING_NOT_FOUND" | "PAYMENT_NOT_FOUND">; message: string };

/** Whether this payment row can be voided, and why not. */
export function voidEligibility(t: VoidCandidate): VoidEligibility {
  if (t.status === "VOIDED") {
    return { voidable: false, code: "ALREADY_VOIDED", message: "This payment was already voided." };
  }
  if (isOnlineGatewayPayment(t)) {
    return { voidable: false, code: "ONLINE_PAYMENT", message: ONLINE_PAYMENT_VOID_MESSAGE };
  }
  if (t.status !== "CONFIRMED") {
    return {
      voidable: false,
      code: "NOT_VOIDABLE",
      message:
        t.status === "COLLECTED"
          ? "This cash is still awaiting confirmation — reject it instead of voiding it."
          : `Only confirmed payments can be voided (this one is ${t.status.toLowerCase()}).`,
    };
  }
  if (!new Decimal(t.totalAmount.toString()).gt(0)) {
    return { voidable: false, code: "NOT_VOIDABLE", message: "This entry has no amount to void." };
  }
  return { voidable: true };
}

/** The refusal to send for a row that can't be voided (409), or null. */
export function voidRefusal(t: VoidCandidate): PaymentVoidError | null {
  const e = voidEligibility(t);
  return e.voidable ? null : new PaymentVoidError(StatusCode.CONFLICT, e.code, e.message);
}

/** Whether the void leaves a closed shift's counted cash as it was (cash in a shift no longer OPEN). */
export function voidShiftClosed(t: { cashAmount: DecimalLike }, shift: { status: string } | null): boolean {
  return !!shift && shift.status !== "OPEN" && new Decimal(t.cashAmount.toString()).gt(0);
}

/**
 * The RefundRequest written together with a refund row (same booking, amount
 * and moment — every refund path writes the pair in one transaction): the one
 * a voided refund takes with it. Prefers a matching reason (= the row's notes),
 * then the closest in time; null when none was written (e.g. the FE session
 * refund of an over-payment writes only the row).
 */
export function pairedRefundRequest<R extends { id: number; amount: DecimalLike; status: string; reason: string; createdAt: Date }>(
  refund: { totalAmount: DecimalLike; notes: string | null; createdAt: Date },
  requests: R[],
  windowMs = 10_000,
): R | null {
  const amount = new Decimal(refund.totalAmount.toString());
  const candidates = requests.filter(
    (r) =>
      r.status !== "VOIDED" &&
      r.status !== "REJECTED" &&
      new Decimal(r.amount.toString()).eq(amount) &&
      Math.abs(r.createdAt.getTime() - refund.createdAt.getTime()) <= windowMs,
  );
  if (candidates.length === 0) return null;
  const score = (r: R) => (refund.notes != null && r.reason === refund.notes ? 0 : 1);
  candidates.sort(
    (a, b) =>
      score(a) - score(b) ||
      Math.abs(a.createdAt.getTime() - refund.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - refund.createdAt.getTime()),
  );
  return candidates[0]!;
}

/** What the void does to the booking's balance, in words (toast / audit). */
export function voidEffectNote(t: { purpose: string; totalAmount: DecimalLike; goodwillAmount?: DecimalLike }): string {
  const amount = new Decimal(t.totalAmount.toString());
  if (isRefundPurpose(t.purpose)) {
    const goodwill = new Decimal((t.goodwillAmount ?? 0).toString());
    const owedAgain = amount.sub(goodwill);
    return goodwill.gt(0)
      ? `The refund no longer counts: ₹${owedAgain.toFixed(2)} is owed to the customer again and the ₹${goodwill.toFixed(2)} goodwill is undone.`
      : `The refund no longer counts: ₹${amount.toFixed(2)} is owed to the customer again.`;
  }
  return `The payment no longer counts: the booking owes ₹${amount.toFixed(2)} again.`;
}

export interface VoidedRow {
  purpose: string;
  totalAmount: DecimalLike;
  cashAmount: DecimalLike;
  voidShiftClosed: boolean;
}

export interface VoidSummary {
  count: number;
  /** Money in voided (payments) */
  payments: { count: number; amount: number };
  /** Money out voided (refunds / payouts) */
  refunds: { count: number; amount: number };
  /** Cash voided after its shift had closed: that shift's counted / expected cash didn't change */
  shiftClosed: { count: number; cashAmount: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The period report's voids section: payments and refunds voided in the period. */
export function summarizeVoids(rows: VoidedRow[]): VoidSummary {
  const out: VoidSummary = { count: 0, payments: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 }, shiftClosed: { count: 0, cashAmount: 0 } };
  for (const t of rows) {
    const amount = Number(t.totalAmount.toString());
    out.count += 1;
    const bucket = isRefundPurpose(t.purpose) ? out.refunds : out.payments;
    bucket.count += 1;
    bucket.amount += amount;
    if (t.voidShiftClosed) {
      out.shiftClosed.count += 1;
      out.shiftClosed.cashAmount += Number(t.cashAmount.toString());
    }
  }
  out.payments.amount = r2(out.payments.amount);
  out.refunds.amount = r2(out.refunds.amount);
  out.shiftClosed.cashAmount = r2(out.shiftClosed.cashAmount);
  return out;
}

/** The void fields every payment-history row carries (additive). */
export function voidView(t: VoidCandidate & {
  voidedAt: Date | null;
  voidReason: string | null;
  voidShiftClosed: boolean;
  voidedBy?: { name: string | null } | null;
}) {
  const e = voidEligibility(t);
  return {
    voided: t.status === "VOIDED",
    voidedAt: t.voidedAt?.toISOString() ?? null,
    voidedBy: t.voidedBy?.name ?? null,
    voidReason: t.voidReason ?? null,
    voidShiftClosed: t.voidShiftClosed,
    voidable: e.voidable,
    /** Why it can't be voided (null when it can, or when it already was) */
    voidBlockedReason: e.voidable || e.code === "ALREADY_VOIDED" ? null : e.message,
  };
}

/** Select for the void fields (Prisma). */
export const VOID_FIELDS_SELECT = {
  voidedAt: true,
  voidReason: true,
  voidShiftClosed: true,
  voidedBy: { select: { name: true } },
} as const;
