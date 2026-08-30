import { useCallback, useRef, useState } from "react";
import axios from "axios";

import {
  loadRazorpayCheckout,
  RazorpayLoadError,
  type RazorpayFailureResponse,
  type RazorpayHandlerResponse,
  type RazorpayInstance,
  type RazorpayOrder,
} from "@/lib/razorpay";
import {
  razorpayService,
  type GatewayPaymentStatus,
  type PaymentRole,
} from "@/services/payment.service";

/** Business name shown at the top of the Checkout modal. */
const MERCHANT_NAME = "WUW Rentals";
/** Brand orange — matches `--primary` in src/index.css. */
const THEME_COLOR = "#FF5F00";

export interface RazorpayPrefill {
  name?: string;
  email?: string;
  contact?: string;
}

export interface OpenCheckoutArgs {
  /** The `razorpay` object returned by the initiating endpoint. */
  razorpay: RazorpayOrder;
  /** Gateway transaction id — used for the fallback status poll. */
  transactionId: string;
  /** Line shown under the merchant name in the modal. */
  description?: string;
  prefill?: RazorpayPrefill;
  notes?: Record<string, string>;

  /**
   * Role gate the verifying session sits behind — selects which of the three
   * mounted verify endpoints to call. The gates are mutually exclusive, so a
   * staff or manager page MUST say so or verification 403s.
   */
  role?: PaymentRole;
  /**
   * Set false for a flow the shared verify handler cannot resolve — it
   * dispatches on the order id against bookings and extensions only, so a flow
   * that parks its order id elsewhere (damage settlement) must skip straight to
   * `pollStatus`, which is that flow's source of truth.
   */
  verify?: boolean;
  /**
   * Fallback poll. Defaults to `GET /payment/status/:transactionId`.
   * Must resolve to a `{ status }` shape using the gateway's capitalization.
   */
  pollStatus?: (transactionId: string) => Promise<GatewayPaymentStatus>;

  /** Payment confirmed — run the same work the old post-redirect success did. */
  onSuccess: (response: RazorpayHandlerResponse | null) => void | Promise<void>;
  /** Payment failed, or verification and the fallback poll both said so. */
  onFailure: (message: string) => void;
  /** User closed the modal without a completed payment. */
  onDismiss?: () => void;
  /**
   * Gateway has taken the money but has not confirmed yet. Falls back to
   * `onFailure` when not provided.
   */
  onPending?: (message: string) => void;
}

/**
 * Single entry point for Razorpay Checkout across the app.
 *
 * Opens the in-page Checkout modal for an order created by the backend and
 * resolves every outcome — handler, dismissal and gateway failure — against
 * the server, so a payment confirmed only by the webhook is never lost.
 */
export const useRazorpayCheckout = () => {
  const [isOpening, setIsOpening] = useState(false);
  const instanceRef = useRef<RazorpayInstance | null>(null);

  const openCheckout = useCallback(async (args: OpenCheckoutArgs) => {
    const {
      razorpay,
      transactionId,
      description,
      prefill,
      notes,
      role = "customer",
      verify = true,
      pollStatus = razorpayService.getStatus,
      onSuccess,
      onFailure,
      onDismiss,
      onPending,
    } = args;

    // Guards against the handler and ondismiss both resolving the same attempt.
    let settled = false;
    // Set by the `payment.failed` event; the modal stays open so the user can
    // retry, so the description is surfaced when they finally close it.
    let gatewayError: string | null = null;

    const reportPending = (message: string) =>
      onPending ? onPending(message) : onFailure(message);

    /** Ask the server whether the webhook already confirmed this transaction. */
    const resolveFromStatus = async (fallbackMessage: string) => {
      try {
        const status = await pollStatus(transactionId);
        if (status.status === "Success") {
          await onSuccess(null);
          return;
        }
        if (status.status === "Pending") {
          reportPending(status.message ?? fallbackMessage);
          return;
        }
        onFailure(status.message ?? fallbackMessage);
      } catch {
        onFailure(fallbackMessage);
      }
    };

    setIsOpening(true);
    let Razorpay: NonNullable<Window["Razorpay"]>;
    try {
      Razorpay = await loadRazorpayCheckout();
    } catch (err) {
      setIsOpening(false);
      onFailure(
        err instanceof RazorpayLoadError
          ? err.message
          : "Could not open the payment window. Please try again.",
      );
      return;
    }

    const instance = new Razorpay({
      key: razorpay.keyId,
      order_id: razorpay.orderId,
      amount: razorpay.amount,
      currency: razorpay.currency,
      name: MERCHANT_NAME,
      ...(description ? { description } : {}),
      theme: { color: THEME_COLOR },
      ...(prefill ? { prefill } : {}),
      ...(notes ? { notes } : {}),

      handler: (response) => {
        settled = true;
        void (async () => {
          // Flows the shared verify handler cannot resolve go straight to
          // their own status endpoint, which finalizes the record for them.
          if (!verify) {
            await resolveFromStatus("Payment could not be confirmed.");
            return;
          }
          try {
            const result = await razorpayService.verify(
              {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
              role,
            );
            if (result.status !== "Success") {
              // Verification did not confirm — the webhook still might have.
              await resolveFromStatus("Payment could not be confirmed.");
              return;
            }
            await onSuccess(response);
          } catch (err) {
            const refusal = axios.isAxiosError(err) && err.response?.status === 409
              ? (err.response.data as { message?: string } | undefined)?.message
              : undefined;
            if (refusal) {
              // 409 is terminal: the server deliberately refused to confirm and
              // wrote nothing, so no webhook can rescue it and polling would
              // only soften a definite failure into "still processing". The
              // message says a refund is coming, so it must reach the user
              // verbatim rather than be replaced by a poll's wording.
              onFailure(refusal);
              return;
            }
            await resolveFromStatus("Payment could not be confirmed.");
          }
        })();
      },

      modal: {
        ondismiss: () => {
          if (settled) return;
          settled = true;
          void (async () => {
            // The user may have paid and closed the modal before the handler
            // fired, so confirm with the server before calling it cancelled.
            try {
              const status = await pollStatus(transactionId);
              if (status.status === "Success") {
                await onSuccess(null);
                return;
              }
              if (status.status === "Pending" && gatewayError === null) {
                reportPending(
                  status.message ?? "Your payment is still being processed.",
                );
                return;
              }
              if (status.status === "Failed" && status.message) {
                // A settled failure explains itself better than "cancelled",
                // and may carry a refund notice. Prefer it over both the
                // gateway's wording and the dismissal path.
                onFailure(status.message);
                return;
              }
            } catch {
              // fall through to the cancelled / failed path below
            }
            if (gatewayError) onFailure(gatewayError);
            else onDismiss?.();
          })();
        },
      },
    });

    instance.on("payment.failed", (response: RazorpayFailureResponse) => {
      gatewayError =
        response.error?.description ??
        response.error?.reason ??
        "Payment failed. Please try again.";
    });

    instanceRef.current = instance;
    instance.open();
    setIsOpening(false);
  }, []);

  /** Force-close the modal — e.g. when a booking hold expires underneath it. */
  const closeCheckout = useCallback(() => {
    instanceRef.current?.close();
    instanceRef.current = null;
  }, []);

  return { openCheckout, closeCheckout, isOpening };
};
