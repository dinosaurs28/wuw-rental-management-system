// react-native-razorpay@3.0.0 ships no declaration file (its `main` is plain JS
// and package.json has no `types` field), so `strict` mode cannot resolve it.
// These mirror the shapes in the package's own src/types.ts.
declare module 'react-native-razorpay' {
  export interface RazorpayOptions {
    key: string;
    /** In the smallest currency unit — paise for INR. */
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string; hide_topbar?: boolean };
    modal?: {
      backdropclose?: boolean;
      escape?: boolean;
      handleback?: boolean;
      confirm_close?: boolean;
      ondismiss?: () => void;
      animation?: boolean;
    };
    timeout?: number;
    readonly?: { email?: boolean; contact?: boolean; name?: boolean };
    hidden?: { email?: boolean; contact?: boolean };
    [key: string]: any;
  }

  export interface RazorpaySuccess {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
    [key: string]: any;
  }

  /** Rejection shape — also used for user cancellation (code 0 / BAD_REQUEST_ERROR). */
  export interface RazorpayError {
    code: number;
    description: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: { order_id?: string; payment_id?: string; [key: string]: any };
  }

  export interface ExternalWalletData {
    external_wallet: string;
    [key: string]: any;
  }

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccess>;
    onExternalWalletSelection(cb: (data: ExternalWalletData) => void): void;
  };

  export default RazorpayCheckout;
}
