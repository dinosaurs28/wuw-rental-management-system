import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Tag, X, Loader2, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  discountPublicService,
  discountCustomerService,
  type CouponValidationResult,
} from "@/services/discount.service";
import type { PaymentFlow } from "@/lib/paymentPlan";
import { useAuthStore } from "@/store/auth.store";

interface CouponInputProps {
  vehiclePublicId?: string;
  groupKey?: string;
  startAt?: string;
  endAt?: string;
  /** Plan the customer picked — the coupon is checked for it, and re-checked when it changes. */
  paymentFlow?: PaymentFlow;
  appliedCode: string | null;
  /** Coupon layer (pre-GST) of the applied coupon. */
  appliedAmount?: number;
  /** The applied coupon has no server breakdown yet (restored from an older session) — re-check it. */
  needsRecheck?: boolean;
  /** The server accepted the coupon: its breakdown and post-coupon plan options. */
  onApply: (code: string, result: CouponValidationResult) => void;
  onRemove: () => void;
  /** True while an applied coupon is being re-checked (totals may still change). */
  onCheckingChange?: (checking: boolean) => void;
}

// Fallback text per server code — the server's own `reason` is shown first.
const ERROR_MESSAGES: Record<string, string> = {
  COUPON_NOT_FOUND: "Invalid coupon code. Please check and try again.",
  COUPON_EXPIRED: "This coupon has expired.",
  COUPON_NOT_YET_VALID: "This coupon is not valid yet.",
  COUPON_INACTIVE: "This coupon is no longer active.",
  COUPON_BRANCH_SCOPE_MISMATCH: "This coupon is not valid at this branch.",
  COUPON_USER_SCOPE_MISMATCH: "This coupon is not available for your account.",
  COUPON_USER_RESTRICTED: "This coupon is not available for your account.",
  COUPON_NEW_CUSTOMERS_ONLY: "This coupon is only for first-time customers.",
  COUPON_MIN_BOOKING_COUNT: "You need more completed bookings to use this coupon.",
  COUPON_MAX_BOOKING_COUNT: "You are not eligible for this coupon based on your booking history.",
  COUPON_MIN_DAYS: "This coupon requires a longer rental period.",
  COUPON_MAX_DAYS: "This coupon is only valid for shorter rentals.",
  COUPON_MIN_AMOUNT: "This coupon requires a higher booking amount.",
  COUPON_MAX_AMOUNT: "This coupon is only valid for smaller bookings.",
  COUPON_VEHICLE_CATEGORY_MISMATCH: "This coupon is not valid for this vehicle category.",
  COUPON_PAYMENT_PLAN_MISMATCH: "This coupon is not valid for the payment plan you picked.",
  COUPON_USAGE_LIMIT_EXCEEDED: "This coupon has reached its total usage limit.",
  COUPON_PER_USER_LIMIT_EXCEEDED: "You have already used this coupon the maximum number of times.",
  COUPON_BRANCH_LIMIT_EXCEEDED: "This coupon has reached its limit at this branch.",
  COUPON_DAILY_LIMIT_EXCEEDED: "This coupon has reached today's limit. Try again tomorrow.",
  COUPON_STACKING_NOT_ALLOWED: "This coupon can't be combined with the duration discount.",
  COUPON_INVALID: "This coupon is not valid.",
};

type CheckOutcome =
  | { ok: true; result: CouponValidationResult }
  | { ok: false; rejected: boolean; message: string };

export function CouponInput({
  vehiclePublicId,
  groupKey,
  startAt,
  endAt,
  paymentFlow,
  appliedCode,
  appliedAmount = 0,
  needsRecheck = false,
  onApply,
  onRemove,
  onCheckingChange,
}: CouponInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Server preview of the coupon for this vehicle, dates and plan (nothing is recorded)
  const checkCoupon = async (code: string): Promise<CheckOutcome> => {
    if (!((vehiclePublicId || groupKey) && startAt && endAt)) {
      return { ok: false, rejected: false, message: "Please select rental dates before applying a coupon." };
    }
    const params = {
      couponCode: code,
      ...(vehiclePublicId ? { vehiclePublicId } : { groupKey }),
      startAt,
      endAt,
      ...(paymentFlow ? { paymentFlow } : {}),
    };
    try {
      // Signed in: the customer endpoint enforces per-customer coupons and limits
      const res = isAuthenticated
        ? await discountCustomerService.validateCoupon(params)
        : await discountPublicService.validateCoupon(params);
      if (!res.data.valid) {
        return {
          ok: false,
          rejected: true,
          message: res.data.reason || ERROR_MESSAGES[res.data.code] || "Invalid coupon code.",
        };
      }
      return { ok: true, result: res.data };
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      return {
        ok: false,
        rejected: false,
        message: message || "Couldn't validate coupon. Please try again.",
      };
    }
  };

  const handleApply = async () => {
    const code = inputValue.trim().toUpperCase();
    if (!code) return;

    setError(null);
    setLoading(true);
    try {
      const outcome = await checkCoupon(code);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      onApply(code, outcome.result);
      setInputValue("");
      const saved = outcome.result.pricing?.couponDiscountAmount ?? Number(outcome.result.discountAmount);
      toast.success(`Coupon ${code} applied! ₹${saved.toFixed(2)} off`);
    } finally {
      setLoading(false);
    }
  };

  // Re-check an applied coupon when the plan changes (a coupon can be limited
  // to one plan, and the plan options depend on the post-coupon total) or when
  // it was restored without the server's breakdown.
  const lastChecked = useRef<{ flow?: PaymentFlow; code: string | null }>({ flow: paymentFlow, code: appliedCode });
  useEffect(() => {
    const prev = lastChecked.current;
    lastChecked.current = { flow: paymentFlow, code: appliedCode };
    if (!appliedCode) return;
    const flowChanged = prev.code === appliedCode && prev.flow !== paymentFlow;
    if (!flowChanged && !needsRecheck) return;

    let cancelled = false;
    setRechecking(true);
    onCheckingChange?.(true);
    void checkCoupon(appliedCode).then((outcome) => {
      if (cancelled) return;
      setRechecking(false);
      onCheckingChange?.(false);
      if (outcome.ok) {
        onApply(appliedCode, outcome.result);
      } else if (outcome.rejected) {
        onRemove();
        setError(outcome.message);
        toast.error(`Coupon ${appliedCode} was removed: ${outcome.message}`);
      } else {
        // Network trouble: keep the coupon — the booking re-checks it before payment
        setError(outcome.message);
      }
    });
    return () => {
      cancelled = true;
      setRechecking(false);
      onCheckingChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentFlow, appliedCode, needsRecheck]);

  if (appliedCode) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          {rechecking ? (
            <Loader2 className="w-4 h-4 text-green-600 shrink-0 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          )}
          <span className="text-sm font-medium text-green-800 flex-1">
            Coupon applied: <span className="font-mono uppercase">{appliedCode}</span>
            {rechecking ? (
              <span className="ml-1 text-green-600 font-normal">(re-checking…)</span>
            ) : (
              appliedAmount > 0 && (
                <span className="ml-1 text-green-600 font-semibold">(₹{appliedAmount.toFixed(2)} off)</span>
              )
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              onRemove();
            }}
            className="text-green-600 hover:text-green-800 transition-colors"
            aria-label="Remove coupon"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="text-xs text-amber-600 pl-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <Input
            ref={inputRef}
            placeholder="Enter coupon code"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            className={`pl-9 h-10 font-mono text-sm uppercase ${error ? "border-red-400 focus-visible:ring-red-400" : ""}`}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 px-4 text-sm border-orange-200 text-orange-700 hover:bg-orange-50"
          onClick={handleApply}
          disabled={!inputValue.trim() || loading}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-500 pl-1">{error}</p>
      )}
    </div>
  );
}
