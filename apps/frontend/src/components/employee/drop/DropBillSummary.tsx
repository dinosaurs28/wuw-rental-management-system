import { Receipt } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { DropBill, DropBillGstRates, LegacyReturnCharges } from "@/types/drop";
import { formatRate, inr } from "./dropFormat";

function Row({
  label,
  value,
  muted,
  strong,
  credit,
}: {
  label: React.ReactNode;
  value: string;
  muted?: boolean;
  strong?: boolean;
  /** A reduction (shown green). */
  credit?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span
        className={cn(
          credit ? "text-green-700" : muted ? "text-muted-foreground" : "text-gray-700",
          strong && "font-semibold text-gray-900",
        )}
      >
        {label}
      </span>
      <span className={cn("shrink-0 tabular-nums", credit && "text-green-700", strong && "font-semibold text-gray-900")}>
        {value}
      </span>
    </div>
  );
}

function GstTag({ taxable, rates }: { taxable: boolean; rates: DropBillGstRates | null }) {
  return (
    <span
      className={cn(
        "ml-1.5 rounded border px-1 py-px text-[10px] font-medium uppercase",
        taxable ? "border-orange-200 bg-orange-50 text-orange-700" : "border-gray-200 bg-gray-50 text-gray-500",
      )}
    >
      {taxable ? (rates ? `GST ${formatRate(rates.rate)}` : "GST") : "No GST"}
    </span>
  );
}

/**
 * The drop bill (server figures). Drop / recovery charges carry no GST (item 8):
 * each charge at face value, the subtotal, the discount and the total. A bill
 * computed before that (still carrying GST) shows its GST rows until it is
 * recomputed — the server refuses payment on it meanwhile. The safety-deposit
 * credit and payments are in the payment breakdown.
 */
export function DropBillSummary({ bill, className }: { bill: DropBill; className?: string }) {
  if (bill.lines.length === 0) {
    return (
      <div className={cn("rounded-lg border bg-white px-4 py-3 text-sm text-muted-foreground", className)}>
        No drop charges.
      </div>
    );
  }
  const rates = bill.gstRates;
  const hasGst = Number(bill.gst) !== 0 || bill.lines.some((l) => l.taxable && Number(l.gst) !== 0);
  const nonTaxable = Number(bill.nonTaxableValue);

  return (
    <div className={cn("rounded-lg border bg-white", className)}>
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Receipt className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Drop charges</span>
      </div>

      <div className="px-4 py-3 space-y-2">
        {bill.lines.map((line, i) => (
          <div key={`${line.referenceType}:${line.referenceId ?? i}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-800 min-w-0 break-words">
                {line.label}
                {hasGst && <GstTag taxable={line.taxable} rates={rates} />}
              </span>
              <span className="shrink-0 tabular-nums">{inr(line.amount)}</span>
            </div>
            {line.taxable && Number(line.gst) > 0 && (
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                + GST {inr(line.gst)} = {inr(line.total)}
              </p>
            )}
          </div>
        ))}

        <Separator className="my-1" />
        <Row label={hasGst ? "Subtotal (before GST)" : "Subtotal"} value={inr(bill.subtotal)} />
        {bill.discount && (
          <>
            <Row
              label={hasGst ? "Discount (before GST)" : "Discount"}
              value={`−${inr(bill.discount.amount)}`}
              credit
            />
            {Number(bill.discount.gst) > 0 && (
              <p className="text-xs text-green-700">
                Takes {inr(bill.discount.taxableShare)} off the taxable charges, so the customer also saves{" "}
                {inr(bill.discount.gst)} GST.
              </p>
            )}
          </>
        )}
        {hasGst && (
          <>
            <Row label="Taxable value" value={inr(bill.taxableValue)} muted />
            <Row label={`CGST${rates ? ` (${formatRate(rates.cgstRate)})` : ""}`} value={inr(bill.cgst)} muted />
            <Row label={`SGST${rates ? ` (${formatRate(rates.sgstRate)})` : ""}`} value={inr(bill.sgst)} muted />
          </>
        )}
        {hasGst && nonTaxable > 0 && <Row label="Charges without GST" value={inr(bill.nonTaxableValue)} muted />}
      </div>

      <div className="px-4 py-3 border-t">
        <Row label="Total drop charges" value={inr(bill.total)} strong />
        <p className="mt-1 text-xs text-muted-foreground">
          {hasGst
            ? "This bill was computed with GST on drop charges — compute it again to remove it. "
            : "Drop charges carry no GST. "}
          The safety deposit credit and payments are in the payment breakdown.
        </p>
      </div>
    </div>
  );
}

/** Legacy drop (no drop bill): extra km / late return / swap difference recorded for the branch manager to collect. */
export function LegacyReturnChargesSummary({ charges }: { charges: LegacyReturnCharges }) {
  if (charges.lines.length === 0) return null;
  // No GST on drop charges (item 8); an older server's response may still carry it
  const hasGst = charges.lines.some((l) => Number(l.gst) > 0);
  return (
    <div className="rounded-lg border bg-white text-left">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Receipt className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Return charges</span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {charges.lines.map((line, i) => (
          <div key={`${line.type}:${line.referenceId ?? i}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-800 min-w-0 break-words">
                {line.label}
                {hasGst && <GstTag taxable={line.taxable} rates={charges.gstRates} />}
              </span>
              <span className="shrink-0 tabular-nums">{inr(line.amount)}</span>
            </div>
            {Number(line.gst) > 0 && (
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                + CGST {inr(line.cgst)} + SGST {inr(line.sgst)} = {inr(line.total)}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t">
        <Row label={hasGst ? "Total (incl. GST)" : "Total"} value={inr(charges.total)} strong />
        <p className="mt-1 text-xs text-muted-foreground">
          {hasGst ? "" : "No GST on drop charges. "}
          The branch manager collects this from the customer at settlement.
        </p>
      </div>
    </div>
  );
}
