import { Loader2, ShieldCheck } from "lucide-react";
import { SAFETY_DEPOSIT_HANDLING_LABELS } from "@repo/schemas";

import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/counterPayment";
import type { DropDepositSummary, SafetyDepositHandling } from "@/services/paymentSession.service";

const DESCRIPTIONS: Record<SafetyDepositHandling, string> = {
  SET_OFF: "The deposit pays the drop charges first. Anything left over is refunded; any shortfall is collected.",
  REFUND_IN_FULL: "Give the whole deposit back now and collect the drop charges separately.",
};

interface SafetyDepositChoiceProps {
  /** Deposit held from pickup (₹). */
  held: number;
  value: SafetyDepositHandling;
  onChange: (value: SafetyDepositHandling) => void;
  /** The computed drop bill's deposit block, when there is one. */
  deposit?: DropDepositSummary | null;
  /** Bill already settled / payment recorded — the choice is fixed. */
  readOnly?: boolean;
  isPending?: boolean;
  /** Legacy branches: the branch manager settles it — no amounts are shown here. */
  settledByManager?: boolean;
  className?: string;
}

/**
 * Safety deposit at drop (#6): set off against the charges (default) or
 * refunded in full. On a drop bill the server works out the amounts; the
 * breakdown below is the bill's own `deposit` block.
 */
export function SafetyDepositChoice({
  held,
  value,
  onChange,
  deposit,
  readOnly = false,
  isPending = false,
  settledByManager = false,
  className,
}: SafetyDepositChoiceProps) {
  const options: SafetyDepositHandling[] = ["SET_OFF", "REFUND_IN_FULL"];
  const toCollect = deposit ? parseFloat(deposit.toCollect) || 0 : 0;
  const refund = deposit ? parseFloat(deposit.refund) || 0 : 0;
  const setOff = deposit ? parseFloat(deposit.setOff) || 0 : 0;

  return (
    <div className={cn("space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          Safety deposit held
        </span>
        <span className="flex items-center gap-2 text-sm font-bold text-blue-900">
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {formatRupees(held)}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Safety deposit at drop">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={readOnly || isPending}
              onClick={() => !selected && onChange(option)}
              className={cn(
                "rounded-lg border-2 bg-white px-3 py-2.5 text-left transition-all disabled:cursor-default",
                selected ? "border-orange-500" : "border-neutral-200 hover:border-neutral-300",
                readOnly && !selected && "opacity-50",
              )}
            >
              <span className={cn("block text-sm font-semibold", selected ? "text-orange-700" : "text-neutral-800")}>
                {SAFETY_DEPOSIT_HANDLING_LABELS[option]}
              </span>
              <span className="mt-0.5 block text-xs text-neutral-500">{DESCRIPTIONS[option]}</span>
            </button>
          );
        })}
      </div>

      {deposit ? (
        <div className="space-y-1 rounded-md bg-white px-3 py-2 text-xs text-neutral-700">
          <div className="flex justify-between">
            <span>Drop charges</span>
            <span className="font-medium">{formatRupees(parseFloat(deposit.charges) || 0)}</span>
          </div>
          {deposit.handling === "SET_OFF" && (
            <div className="flex justify-between">
              <span>Deposit used against charges</span>
              <span className="font-medium">− {formatRupees(setOff)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1">
            <span className="font-semibold">Customer pays</span>
            <span className="font-semibold">{formatRupees(toCollect)}</span>
          </div>
          <div className="flex justify-between text-blue-800">
            <span className="font-semibold">Deposit refunded to customer</span>
            <span className="font-semibold">{formatRupees(refund)}</span>
          </div>
        </div>
      ) : settledByManager ? (
        <p className="text-xs text-blue-800">
          Recorded with the return. The branch manager settles the deposit and the charges.
        </p>
      ) : (
        <p className="text-xs text-blue-800">Compute the charges to see what is collected and refunded.</p>
      )}
    </div>
  );
}
