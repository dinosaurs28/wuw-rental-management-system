import type { ReactNode } from "react";
import { Banknote, HandCoins, Smartphone, Split } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  COLLATERAL_HELPER,
  COLLATERAL_LABEL,
  COLLATERAL_MAX_LENGTH,
  COUNTER_PAYMENT_METHODS,
  COUNTER_PAYMENT_METHOD_LABELS,
  counterPaymentParts,
  formatRupees,
  type CounterFieldErrors,
  type CounterPaymentMethod,
  type CounterPaymentValue,
  type CounterProof,
  type CounterRefundMethod,
} from "@/lib/counterPayment";
import type { PaymentProofRole } from "@/services/paymentProof.service";
import { PaymentProofField } from "./PaymentProofField";

const METHOD_ICONS: Record<CounterPaymentMethod, ReactNode> = {
  CASH: <Banknote className="h-4 w-4" />,
  UPI: <Smartphone className="h-4 w-4" />,
  SPLIT: <Split className="h-4 w-4" />,
  CREDIT: <HandCoins className="h-4 w-4" />,
};

/** Short chip labels — "Split (cash + UPI)" is spelled out in the split box. */
const CHIP_LABELS: Record<CounterPaymentMethod, string> = {
  CASH: COUNTER_PAYMENT_METHOD_LABELS.CASH,
  UPI: COUNTER_PAYMENT_METHOD_LABELS.UPI,
  SPLIT: "Split",
  CREDIT: COUNTER_PAYMENT_METHOD_LABELS.CREDIT,
};

interface CounterPaymentFieldsProps {
  value: CounterPaymentValue;
  onChange: (next: CounterPaymentValue) => void;
  /** Amount being settled; null when only the server knows the exact total. */
  amount: number | null;
  /** Upload route for the UPI photo. */
  proofRole: PaymentProofRole;
  /** Methods offered here (default Cash / UPI / Split / Credit). */
  methods?: readonly CounterPaymentMethod[];
  /** Server errors shown at their field. */
  errors?: CounterFieldErrors;
  /** Staff changed something — clear server errors that referred to the old input. */
  onEdit?: () => void;
  /** Shown under the chips when Cash is picked. */
  cashNote?: ReactNode;
  /** Shown when Credit is picked (e.g. why it can't be used on this bill). */
  creditNote?: ReactNode;
  disabled?: boolean;
  idPrefix?: string;
  label?: string;
  /**
   * One more chip outside the counter methods (walk-in: "Online" = Razorpay
   * checkout). While it is selected no counter method is, and no fields show.
   */
  extraChip?: { label: string; icon?: ReactNode; selected: boolean; onSelect: () => void };
  className?: string;
}

/**
 * The payment step every Fleet counter flow shares (#3 / #11 / #12): method
 * chips, then the UPI photo, the split's cash part (the UPI part is the rest),
 * or the collateral note for Credit. No UTR box — UPI is backed by the photo.
 */
export function CounterPaymentFields({
  value,
  onChange,
  amount,
  proofRole,
  methods = COUNTER_PAYMENT_METHODS,
  errors,
  onEdit,
  cashNote,
  creditNote,
  disabled = false,
  idPrefix = "counter-pay",
  label = "Payment method",
  extraChip,
  className,
}: CounterPaymentFieldsProps) {
  const update = (patch: Partial<CounterPaymentValue>) => {
    onEdit?.();
    onChange({ ...value, ...patch });
  };
  const { upi: splitUpi } = counterPaymentParts(value, amount);
  // The counter method in use (none while the extra chip is selected)
  const active: CounterPaymentMethod | null = extraChip?.selected ? null : value.method;
  const chipCount = methods.length + (extraChip ? 1 : 0);
  const chipClass = (selected: boolean) =>
    cn(
      "flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all disabled:opacity-50",
      selected
        ? "border-orange-500 bg-orange-50 text-orange-700"
        : "border-neutral-200 text-neutral-600 hover:border-neutral-300",
    );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <Label className="text-sm text-neutral-600">{label}</Label>
        <div
          className={cn(
            "grid gap-2",
            chipCount >= 5
              ? "grid-cols-2 sm:grid-cols-3"
              : chipCount === 4
                ? "grid-cols-2 sm:grid-cols-4"
                : chipCount === 3
                  ? "grid-cols-3"
                  : "grid-cols-2",
          )}
          role="radiogroup"
          aria-label={label}
        >
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active === m}
              disabled={disabled}
              onClick={() => update({ method: m })}
              className={chipClass(active === m)}
            >
              {METHOD_ICONS[m]}
              {CHIP_LABELS[m]}
            </button>
          ))}
          {extraChip && (
            <button
              type="button"
              role="radio"
              aria-checked={extraChip.selected}
              disabled={disabled}
              onClick={() => {
                onEdit?.();
                extraChip.onSelect();
              }}
              className={chipClass(extraChip.selected)}
            >
              {extraChip.icon}
              {extraChip.label}
            </button>
          )}
        </div>
      </div>

      {active === "CASH" && cashNote}

      {active === "UPI" && (
        <PaymentProofField
          id={`${idPrefix}-proof`}
          role={proofRole}
          value={value.proof}
          onChange={(proof) => update({ proof })}
          error={errors?.proof}
          disabled={disabled}
        />
      )}

      {active === "SPLIT" && (
        <div className="space-y-3 rounded-lg border bg-neutral-50 p-3">
          <p className="text-xs font-medium text-neutral-500">
            {COUNTER_PAYMENT_METHOD_LABELS.SPLIT}
            {amount != null ? ` — total ${formatRupees(amount)}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-split-cash`} className="text-xs">
                Cash part (₹) <span className="text-red-500">*</span>
              </Label>
              <Input
                id={`${idPrefix}-split-cash`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                max={amount ?? undefined}
                placeholder="0"
                value={value.splitCash}
                onChange={(e) => update({ splitCash: e.target.value })}
                disabled={disabled}
                aria-invalid={!!errors?.split}
                className="h-10 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-neutral-500">UPI part (the rest)</Label>
              <div className="flex h-10 items-center rounded-md border bg-neutral-100 px-3 text-sm text-neutral-700">
                {amount != null ? formatRupees(splitUpi) : "Total − cash"}
              </div>
            </div>
          </div>
          {errors?.split && <p className="text-xs text-red-600">{errors.split}</p>}
          <PaymentProofField
            id={`${idPrefix}-proof`}
            role={proofRole}
            value={value.proof}
            onChange={(proof) => update({ proof })}
            error={errors?.proof}
            label="Photo of the UPI payment screen"
            disabled={disabled}
          />
        </div>
      )}

      {active === "CREDIT" && (
        <div className="space-y-2">
          {creditNote}
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-collateral`} className="text-sm">
              {COLLATERAL_LABEL} <span className="text-red-500">*</span>
            </Label>
            <Input
              id={`${idPrefix}-collateral`}
              placeholder="e.g. Original Aadhaar card"
              maxLength={COLLATERAL_MAX_LENGTH}
              value={value.collateral}
              onChange={(e) => update({ collateral: e.target.value })}
              disabled={disabled}
              aria-invalid={!!errors?.collateral}
              className="h-10"
            />
            {errors?.collateral ? (
              <p className="text-xs text-red-600">{errors.collateral}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{COLLATERAL_HELPER}</p>
            )}
          </div>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {amount != null ? `${formatRupees(amount)} stays` : "The amount stays"} owed by the customer. The branch
            manager clears it on the Customer Credit page when they pay.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Refunds (deposit refund at drop, refund of a drop remainder) ─────────────

interface RefundMethodFieldsProps {
  method: CounterRefundMethod;
  onMethodChange: (method: CounterRefundMethod) => void;
  proof: CounterProof | null;
  onProofChange: (proof: CounterProof | null) => void;
  proofRole: PaymentProofRole;
  proofError?: string | null;
  label?: string;
  disabled?: boolean;
  idPrefix?: string;
  className?: string;
}

/**
 * Cash or UPI back to the customer. A UPI refund may carry a photo of the
 * transfer (optional). A cash refund comes out of the drawer and the branch
 * manager acknowledges it.
 */
export function RefundMethodFields({
  method,
  onMethodChange,
  proof,
  onProofChange,
  proofRole,
  proofError,
  label = "Refund by",
  disabled = false,
  idPrefix = "refund",
  className,
}: RefundMethodFieldsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <Label className="text-sm text-neutral-600">{label}</Label>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
          {(["CASH", "UPI"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              disabled={disabled}
              onClick={() => onMethodChange(m)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all disabled:opacity-50",
                method === m
                  ? "border-orange-500 bg-orange-50 text-orange-700"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300",
              )}
            >
              {METHOD_ICONS[m]}
              {m === "CASH" ? "Cash" : "UPI"}
            </button>
          ))}
        </div>
      </div>
      {method === "CASH" ? (
        <p className="text-xs text-neutral-500">
          Paid from the cash drawer. The branch manager acknowledges cash refunds.
        </p>
      ) : (
        <PaymentProofField
          id={`${idPrefix}-proof`}
          role={proofRole}
          value={proof}
          onChange={onProofChange}
          error={proofError}
          required={false}
          label="Photo of the UPI transfer"
          helper="After sending the refund by UPI, photograph the transfer screen."
          disabled={disabled}
        />
      )}
    </div>
  );
}
