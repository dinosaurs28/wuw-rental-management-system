import type { PaymentSession, LedgerEntry } from "@/services/paymentSession.service";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface LedgerSummaryCardProps {
  session: PaymentSession;
  className?: string;
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

export function LedgerSummaryCard({ session, className }: LedgerSummaryCardProps) {
  const charges = session.entries.filter(
    (e) => e.classification === "TAXABLE" || e.classification === "NON_TAXABLE",
  );
  const discounts = session.entries.filter((e) => e.classification === "DISCOUNT");
  const payments = session.entries.filter((e) => e.classification === "PAYMENT");

  const netPayable = parseFloat(session.netPayable);
  const isRefund = netPayable < 0;

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
            <span className="text-muted-foreground">{entryLabel(e)}</span>
            <span>{formatAmount(e.amount)}</span>
          </div>
        ))}

        {session.gstAmount !== "0.00" && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">GST</span>
            <span>₹{parseFloat(session.gstAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        {discounts.length > 0 && (
          <>
            <Separator className="my-1" />
            {discounts.map((e) => (
              <div key={e.publicId} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{entryLabel(e)}</span>
                <span className={amountColor(e)}>{formatAmount(e.amount)}</span>
              </div>
            ))}
          </>
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
