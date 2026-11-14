/**
 * Pure rules for reading a Razorpay order and its payments (Nov 2026 payment
 * bugs: "paid but not confirmed", "some payments failed"). No SDK, no database,
 * so they are unit tested on their own.
 */

export type OrderState = "SUCCESS" | "PENDING" | "FAILED";

export interface OrderPaymentLike {
  id: string;
  status: string;
  amount?: number | string | null;
  method?: string | null;
}

export interface ResolvedOrderState {
  state: OrderState;
  /** The payment that decided the state (captured / authorized / pending / failed), if any. */
  payment: OrderPaymentLike | null;
  /**
   * The settling payment is only AUTHORIZED: the money is blocked on the
   * customer's account but not with us. Razorpay auto-refunds an uncaptured
   * payment after a few days, so it must be captured before the booking is
   * treated as paid.
   */
  needsCapture: boolean;
}

/**
 * Resolves an order to one state from its payments. A captured (or
 * authorized) payment wins over any number of failed attempts, because
 * Checkout lets the customer retry within the same order.
 *
 * Razorpay order statuses are only created → attempted → paid, so an order
 * with failed attempts is "attempted" and still payable: PENDING, never FAILED.
 */
export function resolveOrderState(
  orderStatus: string | null | undefined,
  items: OrderPaymentLike[],
): ResolvedOrderState {
  const captured = items.find((p) => p.status === "captured");
  if (captured) return { state: "SUCCESS", payment: captured, needsCapture: false };

  const authorized = items.find((p) => p.status === "authorized");
  if (authorized) return { state: "SUCCESS", payment: authorized, needsCapture: true };

  const pending = items.find((p) => p.status === "created" || p.status === "pending");
  if (pending || orderStatus === "created" || orderStatus === "attempted") {
    return { state: "PENDING", payment: pending ?? null, needsCapture: false };
  }

  const failed = items.find((p) => p.status === "failed");
  return { state: "FAILED", payment: failed ?? null, needsCapture: false };
}

/**
 * Razorpay answers a capture of an already-captured payment with a
 * BAD_REQUEST "already been captured" — that is a success for us (a racing
 * webhook / poll / auto-capture got there first).
 */
export function isAlreadyCapturedError(description: string | null | undefined): boolean {
  return /already been captured|already captured/i.test(description ?? "");
}

// ── Late-payment reconcile sweep ─────────────────────────────────────────────

/** How far back the sweep looks for unpaid online holds (Razorpay's UPI/netbanking late captures land within hours). */
export const RECONCILE_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * How long to wait before asking Razorpay about the same order again, by the
 * hold's age: every sweep while it is fresh, then backing off so abandoned
 * holds cost a handful of API calls, not hundreds. Null = stop checking.
 */
export function reconcileBackoffSeconds(ageMs: number): number | null {
  if (ageMs < 0) return 5 * 60;
  if (ageMs > RECONCILE_WINDOW_MS) return null;
  const minutes = ageMs / 60_000;
  if (minutes < 60) return 5 * 60; // first hour: every sweep
  if (minutes < 6 * 60) return 30 * 60; // up to 6 h: every 30 min
  return 3 * 60 * 60; // then every 3 h until the window closes
}

/**
 * Whether a booking is an online (Razorpay order) booking that has not been
 * settled and can still be confirmed by a late capture: HOLD (still running)
 * or HOLD_EXPIRED (lapsed / released by the client). CANCELLED bookings are
 * left to the refund path, settled ones are done.
 */
export function isReconcilableOnlineHold(b: {
  status: string;
  paymentStatus: string;
  transactionId: string | null;
}): boolean {
  return (
    typeof b.transactionId === "string" &&
    b.transactionId.startsWith("order_") &&
    b.paymentStatus !== "SUCCESS" &&
    (b.status === "HOLD" || b.status === "HOLD_EXPIRED")
  );
}
