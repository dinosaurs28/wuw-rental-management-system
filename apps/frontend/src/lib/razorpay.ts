const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Order details handed back by any endpoint that initiates an online payment.
 * `keyId` is the public Razorpay key — safe to use in the browser.
 */
export interface RazorpayOrder {
  orderId: string;
  keyId: string;
  amount: number; // paise
  amountInRupees: number;
  currency: string;
}

/** Payload Razorpay Checkout hands to `handler` on a successful payment. */
export interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** Payload Razorpay Checkout emits on the `payment.failed` event. */
export interface RazorpayFailureResponse {
  error: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: { order_id?: string; payment_id?: string };
  };
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  theme?: { color?: string };
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void; escape?: boolean };
}

export interface RazorpayInstance {
  open: () => void;
  close: () => void;
  on: (
    event: "payment.failed",
    handler: (response: RazorpayFailureResponse) => void,
  ) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export class RazorpayLoadError extends Error {
  constructor() {
    super(
      "Could not load the secure payment window. Please disable any ad blocker or privacy extension and try again.",
    );
    this.name = "RazorpayLoadError";
  }
}

let loaderPromise: Promise<NonNullable<Window["Razorpay"]>> | null = null;

/**
 * Inject the Razorpay Checkout script once and resolve with the constructor.
 * The promise is cached, so concurrent callers share a single script tag.
 * Rejects with a RazorpayLoadError if the script is blocked or fails to load
 * (ad blockers do block this domain), so callers can surface a real message.
 */
export const loadRazorpayCheckout = (): Promise<
  NonNullable<Window["Razorpay"]>
> => {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const fail = () => {
      // Drop the cached promise so a later attempt can retry the injection.
      loaderPromise = null;
      reject(new RazorpayLoadError());
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else fail();
    });
    script.addEventListener("error", fail);

    if (!existing) {
      script.src = CHECKOUT_SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return loaderPromise;
};
