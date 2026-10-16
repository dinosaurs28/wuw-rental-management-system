import { useState } from "react";
import { Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/counterPayment";

/**
 * Manual pickup discount: a flat ₹ off the rent payable at pickup (GST included,
 * never the safety deposit). Shows Total charges, Discount and Final payable once
 * given. The server checks the amount again (400 PICKUP_DISCOUNT_EXCEEDS).
 */

/** Typed amount → the problem with it, or null. `max` null = the server decides. */
export function pickupDiscountInputError(text: string, max: number | null): string | null {
  const t = text.trim();
  if (!t) return "Enter the discount amount.";
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Enter the discount in ₹ with up to 2 decimals.";
  const amount = Number(t);
  if (!(amount > 0)) return "The discount must be more than ₹0.";
  if (max != null && amount > max + 1e-9) {
    return `The discount can't be more than the rental balance payable at pickup (${formatRupees(max)}).`;
  }
  return null;
}

/** Keeps digits and one decimal point with at most 2 decimals. */
export function cleanDiscountInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

interface PickupDiscountPanelProps {
  /** The discount given (null = none) */
  applied: { amount: number; reason: string | null } | null;
  /** The most it may be (rent payable at pickup, after a coupon); null = unknown */
  max: number | null;
  /** What the customer pays with the discount taken off */
  finalPayable: number;
  /** Shown under the summary, e.g. "Applied when you start the payment" */
  note?: string;
  busy?: boolean;
  applying?: boolean;
  removing?: boolean;
  /** Server refusal to show */
  error?: string | null;
  disabled?: boolean;
  onApply: (amount: number, reason: string | null) => void | Promise<unknown>;
  onRemove: () => void;
}

export function PickupDiscountPanel({
  applied,
  max,
  finalPayable,
  note,
  busy,
  applying,
  removing,
  error,
  disabled,
  onApply,
  onRemove,
}: PickupDiscountPanelProps) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Nothing payable for the rent: nothing to discount
  if (!applied && max != null && max <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No rent is payable at this pickup, so there is nothing to discount.
      </p>
    );
  }

  const startEdit = () => {
    setAmount(applied ? String(applied.amount) : "");
    setReason(applied?.reason ?? "");
    setLocalError(null);
    setEditing(true);
  };
  const apply = async () => {
    const problem = pickupDiscountInputError(amount, max);
    if (problem) {
      setLocalError(problem);
      return;
    }
    try {
      await onApply(Number(amount.trim()), reason.trim() || null);
      setEditing(false);
    } catch {
      // The caller shows the server's message
    }
  };
  const shownError = localError ?? error ?? null;

  if (applied && !editing) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border divide-y text-sm">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-muted-foreground">Total charges</span>
            <span className="font-medium">{formatRupees(finalPayable + applied.amount)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-green-700">
            <span className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Discount
              {applied.reason && <span className="text-xs text-muted-foreground">· {applied.reason}</span>}
            </span>
            <span className="font-medium">−{formatRupees(applied.amount)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
            <span className="font-semibold">Final payable</span>
            <span className="font-bold text-base">{formatRupees(Math.max(0, finalPayable))}</span>
          </div>
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={startEdit}>
            Edit discount
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            disabled={busy || disabled}
            onClick={onRemove}
          >
            {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remove"}
          </Button>
        </div>
        {shownError && <p className="text-xs text-red-600">{shownError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs text-neutral-600">Discount (₹)</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₹</span>
          <Input
            inputMode="decimal"
            className="pl-7 h-10"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setAmount(cleanDiscountInput(e.target.value));
              setLocalError(null);
            }}
            disabled={busy || disabled}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          A flat amount off the rent (GST included){max != null ? `, up to ${formatRupees(max)}` : ""}. It never comes
          off the safety deposit.
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-neutral-600">Reason (optional)</Label>
        <Input
          className="h-10"
          placeholder="Why is the customer getting a discount?"
          maxLength={200}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setLocalError(null);
          }}
          disabled={busy || disabled}
        />
      </div>
      {shownError && <p className="text-xs text-red-600">{shownError}</p>}
      <div className="flex gap-2">
        {editing && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="bg-[#FF5F00] hover:bg-[#e65600]"
          disabled={busy || disabled || !amount.trim()}
          onClick={apply}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply discount"}
        </Button>
      </div>
    </div>
  );
}
