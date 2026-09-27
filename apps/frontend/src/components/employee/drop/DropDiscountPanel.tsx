import { useState } from "react";
import { BadgePercent, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

export interface DropDiscountInput {
  amount: number;
  reason: string;
}

interface DropDiscountPanelProps {
  /** Discount the last compute applied (server figures). */
  applied: { amount: string; reason: string } | null;
  error: string | null;
  isPending: boolean;
  onApply: (discount: DropDiscountInput) => void;
  onRemove: () => void;
}

export function DropDiscountPanel({ applied, error, isPending, onApply, onRemove }: DropDiscountPanelProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const amountNum = Number(amount);
  const valid = amount.trim() !== "" && amountNum > 0 && reason.trim().length >= 3;

  if (applied) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">
        <div className="flex items-start gap-2 min-w-0">
          <BadgePercent className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Discount {formatCurrency(parseFloat(applied.amount) || 0)} applied</p>
            <p className="text-xs break-words">{applied.reason}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-green-800 hover:text-green-900 hover:bg-green-100 shrink-0"
          disabled={isPending}
          onClick={onRemove}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5 mr-1" />}
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 rounded-lg border bg-neutral-50/60 border-neutral-200">
      <p className="text-sm font-semibold flex items-center gap-2">
        <BadgePercent className="h-4 w-4 text-muted-foreground" /> Discount
        <span className="text-xs font-normal text-muted-foreground">(optional)</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-neutral-600">Amount (₹)</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
            <Input
              type="number"
              min="0"
              className="pl-7 h-10"
              placeholder="e.g. 200"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-neutral-600">Reason</Label>
          <Input
            className="h-10"
            placeholder="Why is the customer getting a discount?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        size="sm"
        variant="outline"
        className="text-orange-600 border-orange-300 hover:bg-orange-50"
        disabled={!valid || isPending}
        onClick={() => onApply({ amount: amountNum, reason: reason.trim() })}
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
        Apply Discount
      </Button>
    </div>
  );
}
