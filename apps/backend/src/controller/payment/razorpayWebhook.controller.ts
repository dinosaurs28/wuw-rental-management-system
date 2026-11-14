import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, ExtensionStatus } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import {
  captureAuthorizedPayment,
  verifyWebhookSignature,
} from "../../services/payment/razorpay.service.js";
import {
  confirmBookingPayment,
  confirmExtensionPayment,
} from "../../services/payment/bookingConfirmation.service.js";
import {
  flagCheckoutPaymentAfterQr,
  handleUpiQrWebhookEvent,
} from "../../services/payment/upi-qr.service.js";
import { isReconcilableOnlineHold } from "../../services/payment/razorpay-order-state.js";

/**
 * Events we act on. Everything else is acknowledged and dropped.
 * payment.authorized: when the account's capture settings leave a payment
 * authorized, it is captured here first — never confirmed uncaptured, since
 * Razorpay refunds an uncaptured payment after a few days.
 */
const CONFIRM_EVENTS = new Set(["payment.captured", "order.paid", "payment.authorized"]);
const FAIL_EVENTS = new Set(["payment.failed"]);
const QR_EVENTS = new Set(["qr_code.credited", "qr_code.closed"]);

/**
 * Razorpay webhook receiver. The route is mounted with `express.raw` so
 * `req.body` is the unparsed Buffer — the HMAC will not match a re-serialized
 * object. Razorpay retries on any non-2xx, so anything we cannot act on is
 * acknowledged with 200 rather than errored.
 */
export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;

    // Mounted with express.raw, but tolerate a pre-parsed body defensively.
    const rawBody: Buffer | string = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});

    if (!signature) {
      console.warn("[razorpayWebhook] missing x-razorpay-signature header");
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Missing signature" });
    }

    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      console.error("[razorpayWebhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook");
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Webhook not configured" });
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("[razorpayWebhook] Invalid x-razorpay-signature");
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid signature" });
    }

    let event: any;
    try {
      event = JSON.parse(
        typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"),
      );
    } catch {
      console.warn("[razorpayWebhook] body is not valid JSON");
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid payload" });
    }

    const eventName: string = event?.event ?? "unknown";
    const paymentEntity = event?.payload?.payment?.entity;
    const orderId: string | undefined =
      paymentEntity?.order_id ?? event?.payload?.order?.entity?.id;
    const paymentId: string | null = paymentEntity?.id ?? null;

    console.log(`[razorpayWebhook] received event=${eventName} orderId=${orderId} paymentId=${paymentId}`);

    // Persist every verified webhook for reconciliation, before we act on it.
    const webhookLog = await prisma.paymentWebhookLog.create({
      data: {
        publicId: createID(),
        payload: event,
        signature,
        processed: false,
      },
    });

    const markProcessed = async () => {
      await prisma.paymentWebhookLog.update({
        where: { id: webhookLog.id },
        data: { processed: true },
      });
    };

    // UPI QR codes (customer paid by scanning from another phone): settled
    // through the same confirmation services as the order path (#2)
    if (QR_EVENTS.has(eventName)) {
      const message = await handleUpiQrWebhookEvent(event, {
        ip: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      await markProcessed();
      return res.status(StatusCode.OK).json({ message });
    }

    if (!CONFIRM_EVENTS.has(eventName) && !FAIL_EVENTS.has(eventName)) {
      console.log(`[razorpayWebhook] ignoring event=${eventName}`);
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    if (!orderId) {
      console.warn(`[razorpayWebhook] event=${eventName} has no order id — acknowledging`);
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    const actor = {
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    };

    // Authorized only: capture before confirming anything. When the capture
    // can't be done now, acknowledge — the status poll, the hold-release check
    // and the reconcile sweep capture and confirm it through fetchOrderStatus.
    if (eventName === "payment.authorized") {
      if (!paymentId || paymentEntity?.status !== "authorized") {
        await markProcessed();
        return res.status(StatusCode.OK).json({ message: "Acknowledged" });
      }
      // Only capture for an order that can still be applied: an unpaid online
      // hold or a pending extension. Anything else (already paid, cancelled, not
      // ours, a remaining-payment order) is left authorized, so Razorpay
      // auto-refunds it instead of it becoming a manual refund.
      const [holdTarget, extTarget] = await Promise.all([
        prisma.booking.findUnique({
          where: { transactionId: orderId },
          select: { status: true, paymentStatus: true, transactionId: true },
        }),
        prisma.bookingExtension.findUnique({
          where: { gatewayTransactionId: orderId },
          select: { extensionStatus: true },
        }),
      ]);
      const capturable =
        (holdTarget && isReconcilableOnlineHold(holdTarget)) ||
        extTarget?.extensionStatus === ExtensionStatus.PENDING_PAYMENT;
      if (!capturable) {
        console.warn(`[razorpayWebhook] authorized payment=${paymentId} order=${orderId} has no open hold / extension — not capturing`);
        await markProcessed();
        return res.status(StatusCode.OK).json({ message: "Acknowledged — not capturable" });
      }
      const captured = await captureAuthorizedPayment(
        paymentId,
        Number(paymentEntity?.amount),
        paymentEntity?.currency ?? "INR",
      );
      if (!captured) {
        console.error(`[razorpayWebhook] could not capture authorized payment=${paymentId} order=${orderId} — left to reconcile`);
        return res.status(StatusCode.OK).json({ message: "Acknowledged — capture pending" });
      }
    }

    // ── Extension payment path ───────────────────────────────────────────────
    // Check if this order belongs to a BookingExtension before the booking path
    const extension = await prisma.bookingExtension.findUnique({
      where: { gatewayTransactionId: orderId },
      select: { id: true, publicId: true },
    });

    if (extension) {
      if (FAIL_EVENTS.has(eventName)) {
        // Extensions stay PENDING_PAYMENT and are retried or expired elsewhere.
        console.log(`[razorpayWebhook] extension=${extension.publicId} payment failed — left pending`);
        await markProcessed();
        return res.status(StatusCode.OK).json({ message: "Acknowledged" });
      }

      const { alreadyConfirmed, skipped } = await confirmExtensionPayment({
        extensionId: extension.id,
        transactionId: orderId,
        gatewayPaymentId: paymentId,
        actorName: "Razorpay Webhook",
        actor,
      });

      await markProcessed();

      if (skipped) {
        console.error(
          `[razorpayWebhook] REFUND REQUIRED extension=${extension.publicId} orderId=${orderId} paymentId=${paymentId} — not confirmable (${skipped})`,
        );
        return res.status(StatusCode.OK).json({ message: `Acknowledged — extension not confirmable (${skipped}), refund required` });
      }

      console.log(`[razorpayWebhook] extension=${extension.publicId} alreadyConfirmed=${alreadyConfirmed}`);
      // Paid twice: a UPI QR payment had already settled it (#2)
      if (alreadyConfirmed && (await flagCheckoutPaymentAfterQr({ extensionId: extension.id, gatewayPaymentId: paymentId }))) {
        return res.status(StatusCode.OK).json({ message: "Acknowledged — already paid by UPI QR, refund required" });
      }
      return res.status(StatusCode.OK).json({
        message: alreadyConfirmed ? "Already confirmed" : "Extension confirmed",
      });
    }
    // ── End extension payment path ───────────────────────────────────────────

    const booking = await prisma.booking.findUnique({
      where: { transactionId: orderId },
      select: { id: true, publicId: true },
    });

    if (!booking) {
      console.warn(`[razorpayWebhook] booking not found for orderId=${orderId}`);
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    if (FAIL_EVENTS.has(eventName)) {
      // Razorpay fires payment.failed on EVERY failed attempt, and Checkout lets
      // the user retry within the same order (wrong OTP, then a good card).
      // Cancelling here would destroy a booking the customer is still paying
      // for. Resolution is left to a later payment.captured, the user's status
      // poll, or hold expiry — same as the extension path above.
      console.log(`[razorpayWebhook] booking=${booking.publicId} attempt failed — leaving booking untouched`);
      await markProcessed();
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    const { alreadyConfirmed, skipped } = await confirmBookingPayment({
      bookingId: booking.id,
      transactionId: orderId,
      isCash: false,
      gatewayPaymentId: paymentId,
      actor,
    });

    await markProcessed();

    if (skipped === "CANCELLED") {
      // Captured money against a dead booking — needs a manual refund. Still a
      // 200 so Razorpay stops retrying; the webhook log row is the paper trail.
      console.error(
        `[razorpayWebhook] REFUND REQUIRED booking=${booking.publicId} orderId=${orderId} paymentId=${paymentId} — captured against a CANCELLED booking`,
      );
      return res.status(StatusCode.OK).json({ message: "Acknowledged — booking cancelled, refund required" });
    }

    console.log(`[razorpayWebhook] booking=${booking.publicId} alreadyConfirmed=${alreadyConfirmed}`);
    // Paid twice: a UPI QR payment had already settled it (#2)
    if (alreadyConfirmed && (await flagCheckoutPaymentAfterQr({ bookingId: booking.id, gatewayPaymentId: paymentId }))) {
      return res.status(StatusCode.OK).json({ message: "Acknowledged — already paid by UPI QR, refund required" });
    }
    return res.status(StatusCode.OK).json({
      message: alreadyConfirmed ? "Already confirmed" : "Confirmed",
    });
  } catch (error: any) {
    // Catch idempotency key constraint violation gracefully
    if (error?.code === "P2002" && error?.meta?.target?.includes("idempotencyKey")) {
      return res.status(StatusCode.OK).json({ message: "Already processed" });
    }
    console.error("[razorpayWebhook] ERROR:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal error" });
  }
};
