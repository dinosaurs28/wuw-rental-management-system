import { prisma, BookingStatus, PaymentStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { fetchOrderStatus } from "./razorpay.service.js";
import { confirmBookingPayment } from "./bookingConfirmation.service.js";
import {
  isReconcilableOnlineHold,
  RECONCILE_WINDOW_MS,
  reconcileBackoffSeconds,
} from "./razorpay-order-state.js";

export type BookingReconcileResult =
  /** Razorpay had the money and the booking is now confirmed. */
  | "CONFIRMED"
  /** Already settled before we looked. */
  | "ALREADY_CONFIRMED"
  /** Paid, but the booking is cancelled — refund path (logged + notified by confirmBookingPayment). */
  | "REFUND_REQUIRED"
  | "PENDING"
  | "FAILED"
  /** Razorpay unreachable or capture outcome unknown — try again later. */
  | "UNKNOWN"
  /** Not an online Razorpay hold. */
  | "NOT_APPLICABLE";

/**
 * Settles a customer / counter online booking straight from Razorpay, with no
 * client and no webhook involved: when its order holds a captured (or
 * capturable) payment, the booking is confirmed through the same idempotent
 * service as verify / webhook / status poll. Never cancels or fails anything —
 * a PENDING or FAILED answer is only reported back.
 *
 * Used before a hold is released (hold expiry, customer / staff "cancel hold")
 * and by the periodic late-payment sweep, so a payment whose webhook never
 * arrived and whose customer never came back still confirms the booking.
 */
export async function reconcileBookingRazorpayOrder(
  bookingId: number,
  actor: { ip?: string; userAgent?: string } = {},
): Promise<BookingReconcileResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, publicId: true, status: true, paymentStatus: true, transactionId: true },
  });
  if (!booking) return "NOT_APPLICABLE";
  if (booking.paymentStatus === PaymentStatus.SUCCESS) return "ALREADY_CONFIRMED";
  if (!isReconcilableOnlineHold(booking)) return "NOT_APPLICABLE";

  const orderId = booking.transactionId!;
  const gateway = await fetchOrderStatus(orderId);
  if (!gateway) return "UNKNOWN";
  if (gateway.state !== "SUCCESS") return gateway.state;

  const { alreadyConfirmed, skipped } = await confirmBookingPayment({
    bookingId: booking.id,
    transactionId: orderId,
    isCash: false,
    gatewayPaymentId: gateway.paymentId,
    actor,
  });
  if (skipped) return "REFUND_REQUIRED";
  console.log(
    `[razorpayReconcile] booking=${booking.publicId} (${booking.status}) order=${orderId} payment=${gateway.paymentId} ` +
      (alreadyConfirmed ? "was already confirmed" : "CONFIRMED from Razorpay (no webhook / client confirmation had landed)"),
  );
  return alreadyConfirmed ? "ALREADY_CONFIRMED" : "CONFIRMED";
}

const SWEEP_BATCH = 100;

/**
 * One pass of the late-payment sweep: online bookings from the last 72 h that
 * are still unpaid (HOLD past a couple of minutes, or HOLD_EXPIRED) are
 * checked against Razorpay, each on a back-off so abandoned holds cost a few
 * API calls. A Redis SET NX per booking keeps several backend processes from
 * checking the same order at once.
 */
export async function runRazorpayReconcileSweep(now = new Date()): Promise<{ checked: number; confirmed: number }> {
  const since = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  // A hold younger than this is still being paid in the customer's checkout
  const freshHoldCutoff = new Date(now.getTime() - 2 * 60 * 1000);

  const candidates = await prisma.booking.findMany({
    where: {
      transactionId: { startsWith: "order_" },
      paymentStatus: PaymentStatus.CREATED,
      createdAt: { gte: since },
      OR: [
        { status: BookingStatus.HOLD_EXPIRED },
        { status: BookingStatus.HOLD, createdAt: { lte: freshHoldCutoff } },
      ],
    },
    select: { id: true, publicId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SWEEP_BATCH,
  });

  let checked = 0;
  let confirmed = 0;
  for (const b of candidates) {
    const backoff = reconcileBackoffSeconds(now.getTime() - b.createdAt.getTime());
    if (backoff === null) continue;
    try {
      const gate = await redis.set(`rzp_reconcile:${b.publicId}`, "1", "EX", backoff, "NX");
      if (gate !== "OK") continue;
    } catch {
      // Redis down: still check, the confirmation itself is idempotent
    }
    checked += 1;
    try {
      const result = await reconcileBookingRazorpayOrder(b.id, { userAgent: "razorpay-reconcile-sweep" });
      if (result === "CONFIRMED") confirmed += 1;
    } catch (err) {
      console.error(`[razorpayReconcile] booking=${b.publicId} reconcile failed:`, err);
    }
  }
  if (checked > 0) {
    console.log(`[razorpayReconcile] sweep checked=${checked} confirmed=${confirmed}`);
  }
  return { checked, confirmed };
}
