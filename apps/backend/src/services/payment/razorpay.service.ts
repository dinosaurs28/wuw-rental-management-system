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

// ── Orders: amount lookup ────────────────────────────────────────────────────

export interface RazorpayOrderSummary {
  id: string;
  /** Order amount in paise. */
  amount: number;
  status: string;
}

/** Fetches an order's amount and status. Null when Razorpay is unreachable or the order is unknown. */
export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrderSummary | null> {
  try {
    const order: any = await getClient().orders.fetch(orderId);
    return { id: order.id, amount: Number(order.amount), status: String(order.status ?? "") };
  } catch (error: any) {
    console.error(
      `[razorpay] order fetch failed orderId=${orderId}:`,
      error?.error?.description ?? error?.message,
    );
    return null;
  }
}

// ── UPI QR Codes (customers paying from another phone) ───────────────────────

export interface UpiQrCode {
  /** `qr_xxxxxxxxxxxx`. */
  id: string;
  /** Razorpay short link that serves the QR image (PNG). */
  imageUrl: string;
  status: "active" | "closed";
  /** `paid` | `on_demand` | null (still open) — anything else means it lapsed at close_by. */
  closeReason: string | null;
  /** Unix seconds, or null when the code has no scheduled close. */
  closeBy: number | null;
  /** Fixed amount in paise. */
  paymentAmount: number;
  paymentsAmountReceived: number;
  paymentsCountReceived: number;
}

export interface UpiQrPaymentEntity {
  /** `pay_xxxxxxxxxxxx`. */
  id: string;
  /** Paise. */
  amount: number;
  /** created | authorized | captured | refunded | failed */
  status: string;
  method: string | null;
  /** Unix seconds. */
  createdAt: number | null;
  /** Payer VPA and bank reference (UTR), when Razorpay reports them. */
  vpa: string | null;
  rrn: string | null;
}

/** Thrown when Razorpay refuses or cannot create a QR code. */
export class UpiQrGatewayError extends Error {
  constructor(
    message: string,
    /** Razorpay's error description, used to detect a close_by rejection. */
    public readonly detail: string,
  ) {
    super(message);
    this.name = "UpiQrGatewayError";
  }
}

function toUpiQrCode(qr: any): UpiQrCode {
  return {
    id: String(qr.id),
    imageUrl: String(qr.image_url ?? ""),
    status: qr.status === "closed" ? "closed" : "active",
    closeReason: qr.close_reason ?? null,
    closeBy: qr.close_by != null ? Number(qr.close_by) : null,
    paymentAmount: Number(qr.payment_amount ?? 0),
    paymentsAmountReceived: Number(qr.payments_amount_received ?? 0),
    paymentsCountReceived: Number(qr.payments_count_received ?? 0),
  };
}

/** Maps a Razorpay payment entity (API or webhook) to the fields we act on. */
export function toUpiQrPayment(p: any): UpiQrPaymentEntity {
  return {
    id: String(p.id),
    amount: Number(p.amount ?? 0),
    status: String(p.status ?? ""),
    method: p.method ?? null,
    createdAt: p.created_at != null ? Number(p.created_at) : null,
    vpa: p.vpa ?? p.upi?.vpa ?? null,
    rrn: p.acquirer_data?.rrn ?? null,
  };
}

/** A payment that has actually moved money — the same rule fetchOrderStatus uses. */
export function isSettledGatewayPayment(p: { status: string }): boolean {
  return p.status === "captured" || p.status === "authorized";
}

/**
 * Creates a single-use, fixed-amount UPI QR code. `closeBy` null leaves the code
 * open until it is paid or closed on demand (callers then close it themselves).
 */
export async function createUpiQrCode(params: {
  amountInPaise: number;
  closeBy: Date | null;
  name: string;
  description: string;
  notes: Record<string, string>;
}): Promise<UpiQrCode> {
  if (!(params.amountInPaise >= 100)) {
    throw new UpiQrGatewayError(`Cannot create a UPI QR for ${params.amountInPaise} paise`, "amount");
  }
  try {
    const qr: any = await getClient().qrCode.create({
      type: "upi_qr",
      name: params.name.slice(0, 40),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: params.amountInPaise,
      description: params.description.slice(0, 120),
      ...(params.closeBy ? { close_by: Math.floor(params.closeBy.getTime() / 1000) } : {}),
      notes: params.notes,
    } as any);
    return toUpiQrCode(qr);
  } catch (error: any) {
    if (error instanceof UpiQrGatewayError) throw error;
    const detail = String(error?.error?.description ?? error?.message ?? "unknown error");
    console.error("[razorpay] QR create failed:", detail);
    throw new UpiQrGatewayError(`Failed to create UPI QR: ${detail}`, detail);
  }
}

/** Fetches a QR code. Null when Razorpay is unreachable. */
export async function fetchUpiQrCode(qrId: string): Promise<UpiQrCode | null> {
  try {
    return toUpiQrCode(await getClient().qrCode.fetch(qrId));
  } catch (error: any) {
    console.error(`[razorpay] QR fetch failed qrId=${qrId}:`, error?.error?.description ?? error?.message);
    return null;
  }
}

/**
 * Closes a QR code so it accepts no further payment. Null when the call failed
 * (already closed, or Razorpay unreachable) — callers re-fetch to find out which.
 */
export async function closeUpiQrCode(qrId: string): Promise<UpiQrCode | null> {
  try {
    return toUpiQrCode(await getClient().qrCode.close(qrId));
  } catch (error: any) {
    console.warn(`[razorpay] QR close failed qrId=${qrId}:`, error?.error?.description ?? error?.message);
    return null;
  }
}

/** Payments made against a QR code. Null when Razorpay is unreachable ("unknown", never "unpaid"). */
export async function fetchUpiQrPayments(qrId: string): Promise<UpiQrPaymentEntity[] | null> {
  try {
    const res: any = await getClient().qrCode.fetchAllPayments(qrId, { count: 10 });
    const items: any[] = res?.items ?? [];
    return items.map(toUpiQrPayment);
  } catch (error: any) {
    console.error(
      `[razorpay] QR payments fetch failed qrId=${qrId}:`,
      error?.error?.description ?? error?.message,
    );
    return null;
  }
}
