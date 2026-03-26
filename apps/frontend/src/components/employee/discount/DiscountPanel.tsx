import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  Tag,
  PercentCircle,
  Plus,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  employeeDiscountService,
  type DiscountSummary,
} from "@/services/discount.service";

const fmt = (v: string | number) =>
  `₹ ${parseFloat(String(v)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

interface DiscountPanelProps {
  bookingPublicId: string;
  bookingTotal?: number;
}

function ManualDiscountStatusBadge({ status }: { status: string }) {
  if (status === "PENDING_APPROVAL")
    return (
      <Badge variant="outline" className="border-yellow-400 text-yellow-700 bg-yellow-50 gap-1 text-xs">
        <Clock className="w-3 h-3" /> Pending Approval
      </Badge>
    );
  if (status === "APPROVED")
    return (
      <Badge variant="outline" className="border-green-400 text-green-700 bg-green-50 gap-1 text-xs">
        <CheckCircle2 className="w-3 h-3" /> Approved
      </Badge>
    );
  if (status === "REJECTED")
    return (
      <Badge variant="outline" className="border-red-400 text-red-700 bg-red-50 gap-1 text-xs">
        <X className="w-3 h-3" /> Rejected
      </Badge>
    );
  return null;
}

// ── Coupon Tab ────────────────────────────────────────────────────────────────

function CouponTab({
  bookingPublicId,
  currentTotal,
  onSuccess,
}: {
  bookingPublicId: string;
  currentTotal?: number;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    const upper = code.trim().toUpperCase();
    if (!upper) return;
    setError(null);
    setLoading(true);
    try {
      const res = await employeeDiscountService.applyCoupon(bookingPublicId, upper);
      toast.success(res.message || "Coupon applied.");
      onSuccess();
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Failed to apply coupon.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="coupon-code">Coupon Code</Label>
        <div className="flex gap-2">
          <Input
            id="coupon-code"
            placeholder="e.g. SUMMER25"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            className={`font-mono uppercase h-11 ${error ? "border-red-400" : ""}`}
          />
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white h-11 px-5"
            onClick={handleApply}
            disabled={!code.trim() || loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply →"}
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {currentTotal !== undefined && (
        <div className="bg-neutral-50 rounded-lg px-4 py-3 text-sm text-neutral-600">
          Current booking total: <span className="font-semibold text-neutral-900">{fmt(currentTotal)}</span>
        </div>
      )}
    </div>
  );
}

// ── Manual Discount Tab ───────────────────────────────────────────────────────

function ManualDiscountTab({
  bookingPublicId,
  bookingTotal,
  onSuccess,
  onClose,
}: {
  bookingPublicId: string;
  bookingTotal?: number;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<{ requiresApproval: boolean; amount: string } | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const needsApproval = amountNum > 500; // threshold — ideally fetched from config

  const handleSubmit = async () => {
    if (amountNum <= 0) {
      toast.error("Enter a valid discount amount.");
      return;
    }
    if (bookingTotal && amountNum > bookingTotal) {
      toast.error("Discount cannot exceed the booking total.");
      return;
    }
    if (reason.trim().length < 10) {
      toast.error("Reason must be at least 10 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await employeeDiscountService.applyManualDiscount(bookingPublicId, {
        amount: amountNum,
        reason: reason.trim(),
      });

      setSubmitted({
        requiresApproval: res.data.requiresApproval,
        amount: res.data.amount,
      });

      if (res.data.requiresApproval) {
        toast.info(`Discount of ${fmt(res.data.amount)} submitted for manager approval.`);
      } else {
        toast.success(`Discount of ${fmt(res.data.amount)} applied.`);
        onSuccess();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to submit discount.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="py-4 space-y-4">
        {submitted.requiresApproval ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-yellow-800 font-medium">
              <Clock className="w-4 h-4 text-yellow-500" />
              Submitted for approval
            </div>
            <p className="text-sm text-yellow-700">
              Discount of {fmt(submitted.amount)} has been submitted and is awaiting manager approval.
              The booking total won't change until it's approved.
            </p>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-800 font-medium">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Discount applied
            </div>
            <p className="text-sm text-green-700">Discount of {fmt(submitted.amount)} has been applied.</p>
          </div>
        )}
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="manual-amount">
          Discount Amount <span className="text-red-500">*</span>
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
          <Input
            id="manual-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className="pl-8 h-11"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {bookingTotal && amountNum > 0 && amountNum <= bookingTotal && (
          <p className="text-xs text-neutral-500">
            New total: {fmt(bookingTotal - amountNum)}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-reason">
          Reason <span className="text-red-500">*</span>
        </Label>
        <Textarea
          id="manual-reason"
          placeholder="Explain the reason for this discount (min 10 characters)…"
          rows={3}
          className="resize-none"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {reason.length > 0 && reason.length < 10 && (
          <p className="text-xs text-red-500">Reason must be at least 10 characters</p>
        )}
      </div>

      {amountNum > 500 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex gap-2 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span>Amounts over ₹500 require manager approval before the discount is applied.</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onClose} className="flex-1" disabled={loading}>
          Cancel
        </Button>
        <Button
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleSubmit}
          disabled={loading || amountNum <= 0 || reason.trim().length < 10}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {needsApproval ? "Submit for Approval →" : "Apply Discount →"}
        </Button>
      </div>
    </div>
  );
}

// ── Main Discount Panel ───────────────────────────────────────────────────────

export function DiscountPanel({ bookingPublicId, bookingTotal }: DiscountPanelProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["discount-summary", bookingPublicId],
    queryFn: () => employeeDiscountService.getDiscountSummary(bookingPublicId),
    retry: false,
  });

  const summary: DiscountSummary | null = data?.data ?? null;
  const hasDiscount =
    summary &&
    (parseFloat(summary.totalDiscountAmount) > 0 || summary.manualDiscount);

  const handleSuccess = () => {
    setModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["discount-summary", bookingPublicId] });
  };

  return (
    <>
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PercentCircle className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-neutral-900">Discounts</h3>
          </div>
          <div className="flex items-center gap-2">
            {hasDiscount && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {expanded ? "Hide" : "Details"}
              </button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-orange-200 text-orange-700 hover:bg-orange-50"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="w-3 h-3" />
              {hasDiscount ? "Change" : "Apply"}
            </Button>
          </div>
        </div>

        <div className="px-5 py-4">
          {isLoading ? (
            <div className="h-4 w-40 bg-neutral-100 rounded animate-pulse" />
          ) : !hasDiscount ? (
            <p className="text-sm text-neutral-400">No discounts applied.</p>
          ) : (
            <div className="space-y-2">
              {/* Summary row */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600">Total discount</span>
                <span className="font-semibold text-green-700">
                  −{fmt(summary!.totalDiscountAmount)}
                </span>
              </div>

              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-2 space-y-2 border-t border-dashed border-neutral-100">
                      {parseFloat(summary!.durationDiscountAmount) > 0 && (
                        <div className="flex justify-between text-xs text-neutral-500">
                          <span>Duration discount</span>
                          <span>−{fmt(summary!.durationDiscountAmount)}</span>
                        </div>
                      )}
                      {summary!.couponCode && (
                        <div className="flex justify-between text-xs text-neutral-500">
                          <span className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            Coupon: <span className="font-mono uppercase ml-1">{summary!.couponCode}</span>
                          </span>
                          <span>−{fmt(summary!.couponDiscountAmount)}</span>
                        </div>
                      )}
                      {summary!.manualDiscount && (
                        <div className="flex justify-between text-xs text-neutral-500 items-center">
                          <span className="flex items-center gap-1.5">
                            Manual discount
                            <ManualDiscountStatusBadge status={summary!.manualDiscount.status} />
                          </span>
                          <span>−{fmt(summary!.manualDiscount.amount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-semibold text-neutral-900 pt-1 border-t border-neutral-100">
                        <span>Final total</span>
                        <span>{fmt(summary!.finalTotal)}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Apply Discount Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Discount</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="coupon">
            <TabsList className="w-full">
              <TabsTrigger value="coupon" className="flex-1 gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Coupon Code
              </TabsTrigger>
              <TabsTrigger value="manual" className="flex-1 gap-1.5">
                <PercentCircle className="w-3.5 h-3.5" /> Manual Discount
              </TabsTrigger>
            </TabsList>
            <TabsContent value="coupon">
              <CouponTab
                bookingPublicId={bookingPublicId}
                currentTotal={bookingTotal}
                onSuccess={handleSuccess}
              />
            </TabsContent>
            <TabsContent value="manual">
              <ManualDiscountTab
                bookingPublicId={bookingPublicId}
                bookingTotal={bookingTotal}
                onSuccess={handleSuccess}
                onClose={() => setModalOpen(false)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
