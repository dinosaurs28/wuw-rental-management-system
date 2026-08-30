import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { config } from "dotenv";
config();

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

let client: Razorpay | null = null;

/**
 * Razorpay client is created lazily so the process still boots when the keys
 * are absent (local dev, CI). Every payment path fails loudly instead.
 */
function getClient(): Razorpay {
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error(
      "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET",
    );
  }
  if (!client) {
    client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return client;
}

/** Public key id handed to the checkout clients. Never expose KEY_SECRET. */
export function getRazorpayKeyId(): string {
  if (!KEY_ID) throw new Error("RAZORPAY_KEY_ID is not set");
  return KEY_ID;
}

export interface RazorpayOrderResult {
  /** Razorpay order id, `order_xxxxxxxxxxxx`. Stored as Booking.transactionId. */
  orderId: string;
  /** Public key id — clients need it to open checkout. */
  keyId: string;
  /** Amount in paise, as accepted by Razorpay. */
  amount: number;
  /** Amount in rupees, for display. */
  amountInRupees: number;
  currency: string;
  receipt: string;
}

export type GatewayState = "SUCCESS" | "PENDING" | "FAILED";

export interface GatewayPaymentStatus {
  state: GatewayState;
  orderId: string;
  /** `pay_xxxxxxxxxxxx` once a payment has been attempted, else null. */
  paymentId: string | null;
  /** Amount actually captured, in paise. */
  amountPaid: number;
  /** upi | card | netbanking | wallet | ... */
  method: string | null;
  raw: unknown;
}

export interface CreateOrderOptions {
  /** Short receipt reference (booking publicId, extension publicId, ...). Max 40 chars. */
  receipt?: string;
  /** Free-form notes echoed back on the order and in webhooks. Values must be strings. */
  notes?: Record<string, string>;
  /** Used to build a stable notes.customer_id for reconciliation. */
  customerPublicId?: string;
}

/**
 * Creates a Razorpay order. The returned orderId is the gateway reference
 * persisted by every caller — Booking.transactionId,
 * Booking.remainingPaymentId, or BookingExtension.gatewayTransactionId.
 */
export async function createRazorpayOrder(
  amount: number,
  options: CreateOrderOptions = {},
): Promise<RazorpayOrderResult> {
  if (!(amount > 0)) {
    throw new Error(`Cannot create a Razorpay order for amount ${amount}`);
  }

  // Razorpay works in the smallest currency unit and rejects fractional paise.
  const amountInPaise = Math.round(amount * 100);
  const receipt = (options.receipt ?? `rcpt_${uuidv4().replace(/-/g, "")}`).slice(0, 40);

  const notes: Record<string, string> = { ...(options.notes ?? {}) };
  if (options.customerPublicId) notes.customer_id = options.customerPublicId;

  try {
    const order = await getClient().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt,
      // Capture automatically so a successful checkout needs no second call.
      payment_capture: true,
      notes,
    });

    return {
      orderId: order.id,
      keyId: getRazorpayKeyId(),
      amount: amountInPaise,
      amountInRupees: amountInPaise / 100,
      currency: order.currency ?? "INR",
      receipt,
    };
  } catch (error: any) {
    const detail = error?.error?.description ?? error?.message ?? "unknown error";
    console.error("[razorpay] order create failed:", detail);
    throw new Error(`Failed to initiate payment: ${detail}`);
  }
}

/**
 * Resolves an order to a single settled state by inspecting its payments.
 * Returns null only when Razorpay is unreachable — callers must treat null as
 * "unknown, retry later" and never as a failure.
 */
export async function fetchOrderStatus(
  orderId: string,
): Promise<GatewayPaymentStatus | null> {
  try {
    const rzp = getClient();
    const order: any = await rzp.orders.fetch(orderId);
    const payments: any = await rzp.orders.fetchPayments(orderId);
    const items: any[] = payments?.items ?? [];

    // A captured (or authorized) payment wins over any number of failed ones.
    const settled =
      items.find((p) => p.status === "captured") ??
      items.find((p) => p.status === "authorized");

    if (settled) {
      return {
        state: "SUCCESS",
        orderId,
        paymentId: settled.id,
        amountPaid: settled.amount,
        method: settled.method ?? null,
        raw: { order, payment: settled },
      };
    }

    const pending = items.find((p) => p.status === "created" || p.status === "pending");
    if (pending || order?.status === "created" || order?.status === "attempted") {
      return {
        state: "PENDING",
        orderId,
        paymentId: pending?.id ?? null,
        amountPaid: 0,
        method: pending?.method ?? null,
        raw: { order, payments: items },
      };
    }

    const failed = items.find((p) => p.status === "failed");
    return {
      state: "FAILED",
      orderId,
      paymentId: failed?.id ?? null,
      amountPaid: 0,
      method: failed?.method ?? null,
      raw: { order, payments: items },
    };
  } catch (error: any) {
    console.error(
      `[razorpay] status fetch failed orderId=${orderId}:`,
      error?.error?.description ?? error?.message,
    );
    return null;
  }
}

/** Constant-time compare that never throws on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the handler signature returned by Razorpay Checkout:
 * HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET).
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!KEY_SECRET) throw new Error("RAZORPAY_KEY_SECRET is not set");
  if (!params.orderId || !params.paymentId || !params.signature) return false;

  const expected = createHmac("sha256", KEY_SECRET)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");

  return safeEqual(expected, params.signature);
}

/**
 * Verifies the X-Razorpay-Signature header on a webhook.
 * MUST be given the raw request body — a re-serialized JSON object will not
 * reproduce the same HMAC.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("[razorpay] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook");
    return false;
  }
  if (!signature) return false;

  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"))
    .digest("hex");

  return safeEqual(expected, signature);
}

/** True when the id looks like a Razorpay order, i.e. an online booking. */
export function isRazorpayOrderId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("order_");
}
