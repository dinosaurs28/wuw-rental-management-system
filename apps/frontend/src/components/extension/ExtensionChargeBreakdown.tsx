import { cn } from "@/lib/utils";
import { formatInrExact, gstNumber, gstSplitText } from "@/lib/gst";
import type { ExtensionGstSplit } from "@/services/extension.service";

interface ExtensionChargeBreakdownProps {
  /** The stored split from the server (evaluate pricing, commit result or extension row). */
  split: ExtensionGstSplit;
  /** GST-inclusive amount to collect (`additionalAmount`). */
  total: string | number;
  totalLabel?: string;
  className?: string;
  totalClassName?: string;
}

/**
 * Extension charge as the server priced it: charge before GST (after any
 * discount), GST with its CGST/SGST parts, then the GST-inclusive total.
 * Nothing is computed here — a response without the split shows only the total.
 */
export function ExtensionChargeBreakdown({
  split,
  total,
  totalLabel = "Total payable",
  className,
  totalClassName,
}: ExtensionChargeBreakdownProps) {
  const base = gstNumber(split.baseAmount);
  const discount = gstNumber(split.discountAmount);
  const taxable = gstNumber(split.taxableAmount);
  const tax = gstNumber(split.taxAmount);
  const rate = gstNumber(split.taxRate);
  const hasSplit = taxable !== null && tax !== null;
  const hasDiscount = base !== null && discount !== null && discount > 0;

  return (
    <div className={cn("space-y-1.5 text-sm", className)}>
      {hasSplit && (
        <>
          {hasDiscount && (
            <>
              <div className="flex justify-between text-neutral-600">
                <span>Extension charge</span>
                <span>{formatInrExact(base)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>−{formatInrExact(discount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-neutral-600">
            <span>Extension charge (excl. GST)</span>
            <span>{formatInrExact(taxable)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>GST{rate !== null ? ` (${Number(rate.toFixed(2))}%)` : ""}</span>
            <span>+{formatInrExact(tax)}</span>
          </div>
          {(gstNumber(split.cgstAmount) !== null || gstNumber(split.sgstAmount) !== null) && (
            <p className="text-xs text-neutral-400 text-right">
              {gstSplitText(split.cgstAmount, split.sgstAmount)}
            </p>
          )}
        </>
      )}
      <div
        className={cn(
          "flex justify-between font-semibold text-neutral-900",
          hasSplit && "pt-1.5 border-t border-neutral-200",
        )}
      >
        <span>{totalLabel}</span>
        <span className={cn("text-orange-600", totalClassName)}>{formatInrExact(total)}</span>
      </div>
    </div>
  );
}
