import { useState, useRef } from "react";
import { toast } from "sonner";
import { Tag, X, Loader2, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { discountPublicService, discountCustomerService } from "@/services/discount.service";
import { useAuthStore } from "@/store/auth.store";

interface CouponInputProps {
  vehiclePublicId?: string;
  groupKey?: string;
  startAt?: string;
  endAt?: string;
  appliedCode: string | null;
  appliedAmount?: number;
  onApply: (code: string, amount?: number) => void;
  onRemove: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  COUPON_NOT_FOUND: "Invalid coupon code. Please check and try again.",
  COUPON_EXPIRED: "This coupon has expired.",
  COUPON_INACTIVE: "This coupon is no longer active.",
  COUPON_BRANCH_MISMATCH: "This coupon is not valid at this branch.",
  COUPON_MIN_DURATION: "This coupon requires a longer rental period.",
  COUPON_MIN_AMOUNT: "This coupon requires a higher booking amount.",
  COUPON_USAGE_LIMIT: "This coupon has reached its total usage limit.",
  COUPON_ALREADY_USED: "You have already used this coupon.",
  COUPON_PER_USER_LIMIT_EXCEEDED: "You have already used this coupon the maximum number of times.",
  COUPON_USER_RESTRICTED: "This coupon is not available for your account.",
  COUPON_CATEGORY_MISMATCH: "This coupon is not valid for this vehicle category.",
  COUPON_INVALID: "This coupon is not valid.",
};

export function CouponInput({
  vehiclePublicId,
  groupKey,
  startAt,
  endAt,
  appliedCode,
  appliedAmount = 0,
  onApply,
  onRemove,
}: CouponInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleApply = async () => {
    const code = inputValue.trim().toUpperCase();
    if (!code) return;

    setError(null);
    setLoading(true);

    try {
      const hasContext = (vehiclePublicId || groupKey) && startAt && endAt;
      if (hasContext) {
        const params = {
          couponCode: code,
          ...(vehiclePublicId ? { vehiclePublicId } : { groupKey }),
          startAt: startAt!,
          endAt: endAt!,
        };

        // Use authenticated endpoint when logged in — enforces per-user limits
        const res = isAuthenticated
          ? await discountCustomerService.validateCoupon(params)
          : await discountPublicService.validateCoupon(params);

        if (!res.data.valid) {
          const msg = ERROR_MESSAGES[(res.data as any).code] || (res.data as any).reason || "Invalid coupon code.";
          setError(msg);
          return;
        }

        onApply(code, parseFloat(res.data.discountAmount));
        setInputValue("");
        toast.success(`Coupon ${code} applied! Saved ₹${res.data.discountAmount}`);
      } else {
        setError("Please select rental dates before applying a coupon.");
      }
    } catch {
      setError("Couldn't validate coupon. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (appliedCode) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <span className="text-sm font-medium text-green-800 flex-1">
          Coupon applied: <span className="font-mono uppercase">{appliedCode}</span>
          {appliedAmount > 0 && <span className="ml-1 text-green-600 font-semibold">(Saved ₹{appliedAmount.toFixed(2)})</span>}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-green-600 hover:text-green-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
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
