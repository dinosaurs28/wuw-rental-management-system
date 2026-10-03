import type { PaymentSession, LedgerEntry } from "@/services/paymentSession.service";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { round2 } from "@repo/schemas";
import { X } from "lucide-react";

interface LedgerSummaryCardProps {
  session: PaymentSession;
  className?: string;
  onRemoveDiscount?: () => void;
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  BOOKING_BASE: "Booking base",
  EXTENSION: "Extension charge",
  DEPOSIT: "Safety deposit",
  EXTRA_KM: "Extra kilometres",
  EXTRA_TIME: "Extra time",
  FUEL: "Fuel deficit",
  FASTAG: "FASTag charges",
  DAMAGE: "Damage",
  GRACE_ADJUSTMENT: "Grace adjustment",
  DISCOUNT: "Discount",
  PAYMENT: "Payment",
  REFUND: "Refund",
};

function entryLabel(e: LedgerEntry) {
  return e.description || ENTRY_TYPE_LABELS[e.entryType] || e.entryType;
}

function formatAmount(amount: string) {
  const n = parseFloat(amount);
  const abs = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−₹${abs}` : `₹${abs}`;
}

function amountColor(entry: LedgerEntry) {
  const n = parseFloat(entry.amount);
  if (entry.classification === "DISCOUNT" || entry.classification === "PAYMENT") return "text-green-600";
  if (n < 0) return "text-green-600";
  return "text-foreground";
}

/** A stored per-entry figure ("0.00" when the serializer didn't send it). */
const num = (v: string | undefined | null) => (v == null || v === "" ? 0 : parseFloat(v));

/** The pickup remaining balance is already GST-inclusive (its GST is on the booking). */
const isGstInclusiveCharge = (e: LedgerEntry) => e.referenceType === "BOOKING_REMAINING";

export function LedgerSummaryCard({ session, className, onRemoveDiscount }: LedgerSummaryCardProps) {
  const live = session.entries.filter((e) => !e.isVoided);
  const charges = live.filter(
    (e) => e.classification === "TAXABLE" || e.classification === "NON_TAXABLE",
  );
  const discounts = live.filter((e) => e.classification === "DISCOUNT");
  const payments = live.filter((e) => e.classification === "PAYMENT");

  const netPayable = parseFloat(session.netPayable);
  const isRefund = netPayable < 0;

  // Rent is GST-inclusive (item 17) and drop / recovery charges carry no GST
  // (item 8), so every line is shown at what it adds to the bill: a taxable line
  // (extension rent) as its amount + its GST, a discount as its full credit
  // (amount — its GST reversal is a part of it). The lines then add up to the
  // net payable, and the GST row below only says how much GST is inside them.
  // Every figure is the server's stored value; nothing is taxed here.
  const discountGst = round2(discounts.reduce((s, e) => s + num(e.gstAmount), 0));
  const netGst = round2(num(session.gstAmount) + discountGst);
  const hasGstInclusiveCharge = charges.some(isGstInclusiveCharge);
  const chargeShown = (e: LedgerEntry) =>
    e.classification === "TAXABLE" && !isGstInclusiveCharge(e) ? round2(num(e.amount) + num(e.gstAmount)) : num(e.amount);
  const gstRowLabel =
    netGst < 0
      ? "GST taken off by the discount"
      : hasGstInclusiveCharge
        ? discountGst !== 0
          ? "GST included in the other lines (net of discount)"
          : "GST included in the other lines"
        : discountGst !== 0
          ? "GST included above (net of discount)"
          : "GST included above";
  // CGST / SGST from the per-line split, only when it adds up to the GST shown.
  const cgstSum = round2(live.reduce((s, e) => s + num(e.cgst), 0));
  const sgstSum = round2(live.reduce((s, e) => s + num(e.sgst), 0));
  const showSplit =
    (cgstSum !== 0 || sgstSum !== 0) && Math.abs(round2(cgstSum + sgstSum) - netGst) < 0.005;

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}>
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Payment breakdown</span>
        <Badge variant={session.status === "COMPLETED" ? "default" : "secondary"}>
          {session.status}
        </Badge>
      </div>

      <div className="px-4 py-3 space-y-1">
        {charges.map((e) => (
          <div key={e.publicId} className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {entryLabel(e)}
              {isGstInclusiveCharge(e) && <span className="text-xs"> (GST already included)</span>}
              {e.classification === "TAXABLE" && !isGstInclusiveCharge(e) && num(e.gstAmount) !== 0 && (
                <span className="text-xs">
                  {" "}
                  (rent without GST {formatAmount(e.amount)} + GST {formatAmount(e.gstAmount ?? "0")})
                </span>
              )}
            </span>
            <span>{formatAmount(chargeShown(e).toFixed(2))}</span>
          </div>
        ))}

        {discounts.length > 0 && (
          <>
            <Separator className="my-1" />
            {discounts.map((e) => (
              <div key={e.publicId} className="flex items-center justify-between text-sm">
                <span className={cn("flex-1", amountColor(e))}>
                  {entryLabel(e)}
                  {/* The full credit: its GST reversal is part of it */}
                  {num(e.gstAmount) !== 0 && (
                    <span className="text-xs"> · GST part {formatAmount(e.gstAmount ?? "0")}</span>
                  )}
                  {/* Pickup entries come without their GST part: a counter coupon there carries its GST reversal. */}
                  {e.gstAmount === undefined && session.sessionType === "PICKUP" && (
                    <span className="text-xs"> (incl. GST)</span>
                  )}
                </span>
                <span className={cn("font-medium", amountColor(e))}>
                  {formatAmount(e.amount)}
                </span>
                {onRemoveDiscount && session.status === "AWAITING_PAYMENT" && (
                  <button
                    type="button"
                    onClick={onRemoveDiscount}
                    className="ml-2 text-muted-foreground hover:text-red-500 transition-colors"
                    title="Remove discount"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {netGst !== 0 && <Separator className="my-1" />}
        {netGst !== 0 && (
          <div className="text-sm">
            <div className="flex justify-between text-muted-foreground">
              {/* Informational: this GST is already inside the lines above (not added again). */}
              <span>{gstRowLabel}</span>
              <span>{formatAmount(netGst.toFixed(2))}</span>
            </div>
            {showSplit && (
              <p className="text-xs text-muted-foreground text-right">
                CGST {formatAmount(cgstSum.toFixed(2))} · SGST {formatAmount(sgstSum.toFixed(2))}
              </p>
            )}
          </div>
        )}

        {payments.length > 0 && (
          <>
            <Separator className="my-1" />
            {payments.map((e) => (
              <div key={e.publicId} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{entryLabel(e)}</span>
                <span className={amountColor(e)}>{formatAmount(e.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t flex items-center justify-between">
        <span className="font-semibold text-sm">{isRefund ? "Refund to customer" : "Net payable"}</span>
        <span className={cn("text-lg font-bold", isRefund ? "text-green-600" : "text-foreground")}>
          {isRefund
            ? `₹${Math.abs(netPayable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
            : `₹${netPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
        </span>
      </div>
    </div>
  );
}
