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
 * Extension charge as the server priced it. Rent is GST-inclusive (item 17):
 * the total is the extension rent incl. GST, shown with the rent without GST
 * and the GST (CGST/SGST) inside it — GST is not added on top. Any discount
 * was taken before the split (stored in taxable terms).
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
          <div className="flex justify-between text-neutral-600">
            <span>Extension rent (incl. GST)</span>
            <span>{formatInrExact(total)}</span>
          </div>
          <div className="space-y-0.5 rounded-md bg-neutral-50 px-2.5 py-2 text-xs text-neutral-500">
            <div className="flex justify-between">
              <span>Rent without GST</span>
              <span>{formatInrExact(taxable)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST{rate !== null ? ` (${Number(rate.toFixed(2))}%)` : ""} included</span>
              <span>{formatInrExact(tax)}</span>
            </div>
            {(gstNumber(split.cgstAmount) !== null || gstNumber(split.sgstAmount) !== null) && (
              <p className="text-right text-neutral-400">
                {gstSplitText(split.cgstAmount, split.sgstAmount)}
              </p>
            )}
            {hasDiscount && (
              <p className="text-green-600">
                Discount of {formatInrExact(discount)} (before GST) already taken off
                {base !== null ? ` the ${formatInrExact(base)} rent without GST` : ""}
              </p>
            )}
          </div>
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
